using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using Zabloo.Json;
using Zabloo.Sdk.Interop;

namespace Zabloo
{
    /// <summary>
    /// The host channel: the whole game↔UI coupling surface of v1
    /// (<c>docs/format/host-channel.md</c>), spelled the way a C# game expects it —
    /// <c>PascalCase</c> methods for the operations, C# <c>event</c>s for the
    /// callbacks. Named actions out, data in, plus the by-id operations that ARE
    /// the player's gesture. Same contract as the web renderer and the Godot node;
    /// only the spelling changes, and that table is written in the docs.
    ///
    /// This file also owns the native handles: the document
    /// (<c>zb_document</c>, the game's stable handle — the data store lives in it,
    /// so what the game pushed survives a content swap) and the view
    /// (<c>zb_view</c>, stable for the document's life; a load or a show swaps
    /// the view underneath it). Everything here goes through
    /// <c>Runtime/Interop/NativeMethods.cs</c> and nothing else does.
    ///
    /// Three rules a reader should know before adding to it:
    ///
    /// <list type="bullet">
    ///   <item><b>Nothing throws.</b> A payload the core refuses leaves what was on screen exactly where it was and says why through <see cref="OnDiagnostic"/> and <see cref="Diagnostics"/>; an operation on a missing id answers <c>false</c> and warns.</item>
    ///   <item><b>Events are drained, never raised from inside.</b> The core produces no callbacks; <see cref="Flush"/> reads what the frame produced AFTER it, so a handler never runs mid-layout and a game that re-enters from one (a <c>SetData</c> in response to an action) finds the view settled.</item>
    ///   <item><b>The adapter caches nothing.</b> Data goes straight into the core's store; diagnostics are read back from it; the view id is the one thing kept, and only so a reload can put the same view back.</item>
    /// </list>
    /// </summary>
    public sealed unsafe partial class ZablooView
    {
        /// <summary>A named action declared in the envelope (<c>onClick: "buy"</c>) fired, with the item it fired from.</summary>
        public event Action<string, ActionContext> OnAction;

        /// <summary>
        /// A control wrote its own value back into a bound path — a Toggle checked, a
        /// Slider dropped, a TextInput typed in. Fires whether the player moved it or
        /// the game did (<see cref="SetChecked"/>…), and NEVER for a <see cref="SetData"/>:
        /// that value came from the game, and echoing it would make every write a
        /// round trip. The value arrives typed as <see cref="JsonReader"/> reads it:
        /// <c>bool</c>, <c>long</c>/<c>double</c>, <c>string</c>, list, dictionary.
        /// </summary>
        public event Action<string, object> OnDataChanged;

        /// <summary>The loader had something to say about a payload, on a load and on a reload alike.</summary>
        public event Action<Diagnostic> OnDiagnostic;

        /// <summary>The native document (<c>zb_document*</c>), alive between OnEnable and OnDisable.</summary>
        IntPtr document;

        /// <summary>The native view (<c>zb_view*</c>): null until the first successful load, stable afterwards.</summary>
        IntPtr native;

        /// <summary>The diagnostics of the last load, worst first — what <see cref="Diagnostics"/> exposes.</summary>
        readonly List<Diagnostic> diagnostics = new List<Diagnostic>();

        /// <summary>
        /// A load took and its diagnostics have not been reported yet: they go out
        /// after the next layout frame, not before it. Some of what the view finds
        /// about the payload only turns up once it has been resolved — an overlay
        /// anchored to a node that cannot take input needs the focusability the
        /// resolve pass settles (G9).
        /// </summary>
        bool diagnosticsPending;

        // Scratch for Flush: what a frame produced is copied out of the core's
        // arrays BEFORE any handler runs, because a handler may reload the document
        // and a reload invalidates the drained array.
        readonly List<KeyValuePair<string, ActionContext>> pendingActions = new List<KeyValuePair<string, ActionContext>>();
        readonly List<KeyValuePair<string, object>> pendingChanges = new List<KeyValuePair<string, object>>();

        // --- Loading ----------------------------------------------------------------

        /// <summary>Whether a view is loaded and on screen. A refused load does not count.</summary>
        public bool IsLoaded => document != IntPtr.Zero && NativeMethods.zb_document_loaded(document) != 0;

        /// <summary>
        /// The diagnostics of the last load, fatal or not, worst first. Warnings the
        /// view's runtime adds (an anchor that cannot take input) join the list once
        /// the view has laid out for the first time.
        /// </summary>
        public IReadOnlyList<Diagnostic> Diagnostics => diagnostics;

        /// <summary>
        /// Loads an envelope and shows the view named in the inspector (or, with
        /// none, the envelope's first). Never throws: a payload the core refuses
        /// leaves whatever is on screen exactly where it was, answers <c>false</c>
        /// and says why through <see cref="OnDiagnostic"/> and <see cref="Diagnostics"/>.
        /// The one loading path: a manual import, a dev push and a platform
        /// hot-update all arrive here.
        /// </summary>
        public bool LoadEnvelope(string json)
        {
            return LoadEnvelope(json, viewId);
        }

        /// <summary>
        /// <see cref="LoadEnvelope(string)"/>, showing <paramref name="view"/>. A view
        /// id the envelope does not have is warned about and the first view shows —
        /// the load still took, and answers <c>true</c>.
        /// </summary>
        public bool LoadEnvelope(string json, string view)
        {
            if (!HasDocument("LoadEnvelope")) return false;

            // A load that never reached its frame (two loads in one frame) still
            // gets its diagnostics out, minus the ones only a layout can add.
            if (diagnosticsPending)
            {
                diagnosticsPending = false;
                ReportDiagnostics();
            }

            var bytes = Utf8(json);
            int ok;
            fixed (byte* p = bytes)
            {
                ok = NativeMethods.zb_document_load(document, p, (nuint)bytes.Length);
            }

            diagnostics.Clear();
            CollectDocumentDiagnostics();
            if (ok == 0)
            {
                // Refused: nothing changed on screen, and there is no frame to wait for.
                ReportDiagnostics();
                return false;
            }

            native = NativeMethods.zb_document_view(document);
            if (!string.IsNullOrEmpty(view) && !ShowNative(view))
            {
                Debug.LogWarning("[zabloo] LoadEnvelope: no view with id \"" + view + "\" in this envelope; showing its first view");
            }
            diagnosticsPending = true;
            MarkDirty();
            return true;
        }

        /// <summary>Loads an imported envelope asset — <c>dist/zabloo.ir.json</c> as a <c>TextAsset</c>.</summary>
        public bool Load(TextAsset asset)
        {
            if (asset == null)
            {
                Debug.LogWarning("[zabloo] Load: no envelope asset");
                return false;
            }
            return LoadEnvelope(asset.text, viewId);
        }

        /// <summary>
        /// Swaps the content, keeping the view on screen and everything the game
        /// pushed — the hot-update path, and exactly what a dev push does. Never
        /// throws; a refused payload costs the update, not the session.
        /// </summary>
        public bool Reload(string json)
        {
            return LoadEnvelope(json, viewId);
        }

        /// <summary>Shows another view of the loaded envelope by id. <c>false</c>, and a warning, when there is no such view; nothing changes then.</summary>
        public bool ShowView(string id)
        {
            if (!HasDocument("ShowView")) return false;
            if (!ShowNative(id))
            {
                Debug.LogWarning("[zabloo] ShowView: no view with id \"" + id + "\"");
                return false;
            }
            MarkDirty();
            return true;
        }

        /// <summary>The inspector's shortcut: load the assigned asset again, as a dev push would.</summary>
        [ContextMenu("Reload from asset")]
        void ReloadFromAsset()
        {
            Load(envelope);
        }

        bool ShowNative(string id)
        {
            var bytes = Utf8(id);
            int ok;
            fixed (byte* p = bytes)
            {
                ok = NativeMethods.zb_document_show(document, p, (nuint)bytes.Length);
            }
            if (ok == 0) return false;
            viewId = id;
            native = NativeMethods.zb_document_view(document);
            return true;
        }

        // --- Data -------------------------------------------------------------------

        /// <summary>
        /// Pushes a value into a data path. Every binding reading that path updates,
        /// and the layout re-runs where it must. The store lives in the core's
        /// document, so pushing before a bound node exists applies as soon as it
        /// does, and it survives a content swap.
        ///
        /// A bound path is an ADDRESS into what was pushed:
        /// <c>SetData("shop.items", list)</c> is what makes <c>{"bind": "shop.items.1.name"}</c>
        /// resolve. Takes what <see cref="JsonWriter"/> takes — <c>null</c>, bools,
        /// numbers, strings, lists, arrays, and dictionaries keyed by string; anything
        /// else is warned about and nothing is written.
        /// </summary>
        public void SetData(string path, object value)
        {
            if (!HasDocument("SetData")) return;
            string json;
            try
            {
                json = JsonWriter.Write(value);
            }
            catch (ArgumentException e)
            {
                Debug.LogWarning("[zabloo] SetData(\"" + path + "\"): " + e.Message + " — nothing was written");
                return;
            }
            var pathBytes = Utf8(path);
            var valueBytes = Utf8(json);
            int ok;
            fixed (byte* p = pathBytes)
            fixed (byte* v = valueBytes)
            {
                ok = NativeMethods.zb_document_set_data_json(document, p, (nuint)pathBytes.Length, v, (nuint)valueBytes.Length);
            }
            if (ok == 0)
            {
                Debug.LogWarning("[zabloo] SetData(\"" + path + "\"): the core refused the value as JSON — nothing was written");
                return;
            }
            MarkDirty();
        }

        // --- Operations by id --------------------------------------------------------
        //
        // Each answers whether it FOUND the control: `false` means no node of that
        // type carries that id and nothing was applied — a typo, a view hot-updated
        // out from under the caller — and it is a warning, never an exception: a
        // game looping over ids must not die because one screen changed. They are
        // the player's gesture, hooks included: `SetValue` fires `onChange` and
        // then `onCommit`; a control with a read/write binding writes the value
        // back and the game hears it on `OnDataChanged`.

        /// <summary>Opens or closes a <c>Collapse</c> by id.</summary>
        public bool SetOpen(string id, bool open)
        {
            if (!HasView("SetOpen")) return false;
            var bytes = Utf8(id);
            int found;
            fixed (byte* p = bytes)
            {
                found = NativeMethods.zb_view_set_open(native, p, (nuint)bytes.Length, open ? 1 : 0);
            }
            return Applied("SetOpen", "Collapse", id, found);
        }

        /// <summary>Selects a tab of an <c>exclusive-select</c> group, by the group container's id.</summary>
        public bool SetSelectedTab(string id, int index)
        {
            if (!HasView("SetSelectedTab")) return false;
            var bytes = Utf8(id);
            int found;
            fixed (byte* p = bytes)
            {
                found = NativeMethods.zb_view_set_selected_tab(native, p, (nuint)bytes.Length, index);
            }
            return Applied("SetSelectedTab", "exclusive-select group", id, found);
        }

        /// <summary>Checks or unchecks a <c>Toggle</c> by id — the player's tap, given by the game.</summary>
        public bool SetChecked(string id, bool isChecked)
        {
            if (!HasView("SetChecked")) return false;
            var bytes = Utf8(id);
            int found;
            fixed (byte* p = bytes)
            {
                found = NativeMethods.zb_view_set_checked(native, p, (nuint)bytes.Length, isChecked ? 1 : 0);
            }
            return Applied("SetChecked", "Toggle", id, found);
        }

        /// <summary>Moves a <c>Slider</c> by id — clamped and quantized, <c>onChange</c> then <c>onCommit</c>.</summary>
        public bool SetValue(string id, double value)
        {
            if (!HasView("SetValue")) return false;
            var bytes = Utf8(id);
            int found;
            fixed (byte* p = bytes)
            {
                found = NativeMethods.zb_view_set_value(native, p, (nuint)bytes.Length, value);
            }
            return Applied("SetValue", "Slider", id, found);
        }

        /// <summary>Replaces a <c>TextInput</c>'s text by id, as if typed, with the caret at the end.</summary>
        public bool SetText(string id, string text)
        {
            if (!HasView("SetText")) return false;
            var idBytes = Utf8(id);
            var textBytes = Utf8(text);
            int found;
            fixed (byte* p = idBytes)
            fixed (byte* t = textBytes)
            {
                found = NativeMethods.zb_view_set_text(native, p, (nuint)idBytes.Length, t, (nuint)textBytes.Length);
            }
            return Applied("SetText", "TextInput", id, found);
        }

        /// <summary>Scrolls a <c>ScrollView</c> by id, clamped to the last layout's bounds.</summary>
        public bool SetScroll(string id, float x, float y)
        {
            if (!HasView("SetScroll")) return false;
            var bytes = Utf8(id);
            int found;
            fixed (byte* p = bytes)
            {
                found = NativeMethods.zb_view_set_scroll(native, p, (nuint)bytes.Length, x, y);
            }
            return Applied("SetScroll", "ScrollView", id, found);
        }

        bool Applied(string operation, string type, string id, int found)
        {
            if (found == 0)
            {
                Debug.LogWarning("[zabloo] " + operation + ": no " + type + " with id \"" + id + "\"");
                return false;
            }
            MarkDirty();
            return true;
        }

        // --- Introspection -----------------------------------------------------------

        /// <summary>
        /// The <c>ViewSnapshot</c> of the frame on screen, as the JSON a golden file
        /// holds — the cross-target contract, and what the corpus test compares
        /// against <c>golden/metrics/</c>. Null before a view is loaded.
        /// </summary>
        public string Snapshot()
        {
            if (native == IntPtr.Zero) return null;
            NativeMethods.zb_view_snapshot_json(native, out var json);
            return Text(json);
        }

        /// <summary>What the last paint cost. Telemetry, not contract; zeros before a paint or without a view.</summary>
        public ZbFrameStats Stats
        {
            get
            {
                NativeMethods.zb_view_stats(native, out var stats);
                return stats;
            }
        }

        // --- The native lifecycle (hooks declared in ZablooView.cs) ------------------

        partial void CreateNative()
        {
            document = NativeMethods.zb_document_create();
            native = IntPtr.Zero;
            diagnostics.Clear();
            diagnosticsPending = false;
            if (envelope != null) Load(envelope);
        }

        partial void DestroyNative()
        {
            if (document == IntPtr.Zero) return;
            NativeMethods.zb_document_destroy(document);
            document = IntPtr.Zero;
            native = IntPtr.Zero;
            diagnosticsPending = false;
            pendingActions.Clear();
            pendingChanges.Clear();
        }

        partial void Step(double nowMs)
        {
            if (native == IntPtr.Zero) return;
            NativeMethods.zb_view_set_size(native, size.x, size.y);
            NativeMethods.zb_view_set_now(native, nowMs);
            NativeMethods.zb_view_layout_frame(native);
            animating = NativeMethods.zb_view_animating(native) != 0;
            if (diagnosticsPending)
            {
                diagnosticsPending = false;
                CollectViewWarnings();
                ReportDiagnostics();
            }
        }

        /// <summary>
        /// Drains what the frame produced into the C# events, after the frame.
        /// <c>Update</c> calls it after every frame it runs — one driven by input
        /// AND one of pure motion, because an <c>autoCloseMs</c> fires from inside
        /// the layout pass, and without this drain a toast's signals would only
        /// reach the game with the player's next input (G9).
        /// </summary>
        partial void Flush()
        {
            if (native == IntPtr.Zero) return;

            var actionCount = NativeMethods.zb_view_drain_actions(native, out var actions);
            for (uint i = 0; i < actionCount; i++)
            {
                var action = actions[i];
                pendingActions.Add(new KeyValuePair<string, ActionContext>(Text(action.Name), ContextOf(action)));
            }

            var changeCount = NativeMethods.zb_view_drain_data_changes(native, out var changes);
            for (uint i = 0; i < changeCount; i++)
            {
                var change = changes[i];
                var path = Text(change.Path);
                var json = Text(change.ValueJson);
                if (!JsonReader.TryParse(json, out var value))
                {
                    Debug.LogWarning("[zabloo] OnDataChanged(\"" + path + "\"): the core wrote a value that is not JSON: " + json);
                    continue;
                }
                pendingChanges.Add(new KeyValuePair<string, object>(path, value));
            }

            // Handlers run with nothing of the core's in hand, and in the order the
            // frame produced them: an action before the value it wrote.
            for (var i = 0; i < pendingActions.Count; i++)
            {
                OnAction?.Invoke(pendingActions[i].Key, pendingActions[i].Value);
            }
            pendingActions.Clear();
            for (var i = 0; i < pendingChanges.Count; i++)
            {
                OnDataChanged?.Invoke(pendingChanges[i].Key, pendingChanges[i].Value);
            }
            pendingChanges.Clear();
        }

        // --- Diagnostics -------------------------------------------------------------

        void CollectDocumentDiagnostics()
        {
            var count = NativeMethods.zb_document_diagnostic_count(document);
            for (uint i = 0; i < count; i++)
            {
                if (NativeMethods.zb_document_diagnostic(document, i, out var diagnostic) != 0) diagnostics.Add(DiagnosticOf(diagnostic));
            }
        }

        /// <summary>What building the view's RUNTIME found. It belongs with the load's own: both are properties of the payload.</summary>
        void CollectViewWarnings()
        {
            if (native == IntPtr.Zero) return;
            var count = NativeMethods.zb_view_warning_count(native);
            for (uint i = 0; i < count; i++)
            {
                if (NativeMethods.zb_view_warning(native, i, out var diagnostic) != 0) diagnostics.Add(DiagnosticOf(diagnostic));
            }
        }

        /// <summary>To the console and to <see cref="OnDiagnostic"/>, once per load — never per frame.</summary>
        void ReportDiagnostics()
        {
            for (var i = 0; i < diagnostics.Count; i++)
            {
                var diagnostic = diagnostics[i];
                if (diagnostic.Fatal) Debug.LogError(diagnostic.ToString(), this);
                else Debug.LogWarning(diagnostic.ToString(), this);
                OnDiagnostic?.Invoke(diagnostic);
            }
        }

        static Diagnostic DiagnosticOf(in ZbDiagnostic diagnostic)
        {
            return new Diagnostic(
                Text(diagnostic.CodeName),
                diagnostic.Path.Len == 0 ? null : Text(diagnostic.Path),
                Text(diagnostic.Message),
                diagnostic.Level == ZbDiagnosticLevel.Fatal);
        }

        static ActionContext ContextOf(in ZbAction action)
        {
            if (action.ItemPath.Len == 0) return default;
            object key = null;
            if (action.HasKey != 0)
            {
                key = action.KeyIsNumber != 0 ? NumberOf(action.KeyNumber) : Text(action.KeyText);
            }
            return new ActionContext(Text(action.ItemPath), key, action.Index);
        }

        /// <summary>A number from the core, typed the way <see cref="JsonReader"/> types one: <c>long</c> when integral, <c>double</c> otherwise.</summary>
        static object NumberOf(double number)
        {
            if (number == Math.Floor(number) && number >= long.MinValue && number <= long.MaxValue && !double.IsInfinity(number))
            {
                return (long)number;
            }
            return number;
        }

        // --- Guards and strings --------------------------------------------------------

        bool HasDocument(string operation)
        {
            if (document != IntPtr.Zero) return true;
            Debug.LogWarning("[zabloo] " + operation + ": the view is not enabled", this);
            return false;
        }

        bool HasView(string operation)
        {
            if (native != IntPtr.Zero) return true;
            Debug.LogWarning("[zabloo] " + operation + ": nothing is loaded", this);
            return false;
        }

        /// <summary>UTF-8 bytes for the core, no NUL: the length is the contract. Null reads as empty.</summary>
        static byte[] Utf8(string text)
        {
            return text == null ? Array.Empty<byte>() : Encoding.UTF8.GetBytes(text);
        }

        /// <summary>A <c>zb_str</c> as a C# string.</summary>
        static string Text(in ZbStr str)
        {
            return str.Len == 0 || str.Data == IntPtr.Zero ? "" : Encoding.UTF8.GetString((byte*)str.Data, (int)str.Len);
        }
    }
}
