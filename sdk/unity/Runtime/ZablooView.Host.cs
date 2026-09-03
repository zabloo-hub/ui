using System;
using System.Collections.Generic;
using UnityEngine;

// The events below are declared and never raised until UN7 drains the core.
#pragma warning disable 67

namespace Zabloo
{
    /// <summary>
    /// Where an action came from: the item of a <c>Repeat</c> it fired inside, or
    /// nothing when it fired from the document itself.
    /// </summary>
    public readonly struct ActionContext
    {
        /// <summary>The item's absolute data path (<c>shop.items.3</c>), or null.</summary>
        public readonly string Path;

        /// <summary>The item's declared key, as a string, or null when the list has none.</summary>
        public readonly string Key;

        /// <summary>The item's index in its array, or -1.</summary>
        public readonly int Index;

        public ActionContext(string path, string key, int index)
        {
            Path = path;
            Key = key;
            Index = index;
        }

        /// <summary>True for an action fired outside any <c>Repeat</c>.</summary>
        public bool IsEmpty => Path == null;
    }

    /// <summary>One line the loader had to say about a payload.</summary>
    public readonly struct Diagnostic
    {
        /// <summary>The stable code every SDK emits for the same input (<c>unsupported-version</c>…).</summary>
        public readonly string Code;

        /// <summary>Where in the envelope (<c>views["hud"].children[2].text</c>), or null.</summary>
        public readonly string Path;

        /// <summary>The human-readable reason.</summary>
        public readonly string Message;

        /// <summary>True when the payload was refused; false for a warning that degraded.</summary>
        public readonly bool Fatal;

        public Diagnostic(string code, string path, string message, bool fatal)
        {
            Code = code;
            Path = path;
            Message = message;
            Fatal = fatal;
        }
    }

    /// <summary>
    /// The host channel: the whole game↔UI coupling surface of v1, spelled the way
    /// a C# game expects it. Named actions out, data in, plus the by-id operations
    /// that ARE the player's gesture. Same surface as the Godot node; only the
    /// spelling changes.
    ///
    /// EVERYTHING IN THIS FILE IS A STUB (UN3). It exists so the playground compiles
    /// and so no other ticket creates this file: UN7 replaces the bodies with the
    /// calls through <c>Runtime/Interop/NativeMethods.cs</c> (UN2). Until then every
    /// operation warns and does nothing, and every event never fires.
    /// </summary>
    public sealed partial class ZablooView
    {
        const string NotYet = "zabloo: the Unity SDK is under construction (F12) — {0} does nothing yet.";

        /// <summary>A named action declared in the envelope (<c>onClick: "buy"</c>) fired.</summary>
        public event Action<string, ActionContext> OnAction;

        /// <summary>
        /// A control wrote its own value back into a bound path — a Toggle checked, a
        /// Slider dropped, a TextInput typed in. Fires whether the player moved it or
        /// the game did. The value arrives as JSON.
        /// </summary>
        public event Action<string, string> OnDataChanged;

        /// <summary>The loader had something to say about a payload.</summary>
        public event Action<Diagnostic> OnDiagnostic;

        /// <summary>Whether a view is loaded and on screen.</summary>
        public bool IsLoaded => false;

        /// <summary>
        /// Loads an envelope and shows one of its views. Never throws: a payload the
        /// core refuses leaves whatever is on screen exactly where it was and says why
        /// through <see cref="OnDiagnostic"/> and <see cref="GetDiagnostics"/>.
        /// </summary>
        public bool LoadEnvelope(string json, string view)
        {
            Warn("LoadEnvelope");
            return false;
        }

        /// <summary>Swaps the content, keeping the view id and everything the game pushed. The hot-update path.</summary>
        public bool Reload(string json)
        {
            Warn("Reload");
            return false;
        }

        /// <summary>The diagnostics of the last load, fatal or not.</summary>
        public IReadOnlyList<Diagnostic> GetDiagnostics()
        {
            return Array.Empty<Diagnostic>();
        }

        /// <summary>
        /// Pushes a value into a data path. Bound nodes react and re-lay out. Cached
        /// on the view, so pushing before a bound node exists applies as soon as it
        /// does, and it survives a content swap.
        /// </summary>
        public void SetData(string path, object value)
        {
            Warn("SetData");
        }

        /// <summary>Opens or closes a <c>Collapse</c> by id. False if there is no such node.</summary>
        public bool SetOpen(string id, bool open)
        {
            Warn("SetOpen");
            return false;
        }

        /// <summary>Selects a tab of an <c>exclusive-select</c> group by id.</summary>
        public bool SetSelectedTab(string id, int index)
        {
            Warn("SetSelectedTab");
            return false;
        }

        /// <summary>Checks or unchecks a <c>Toggle</c> by id — the player's tap, given by the game.</summary>
        public bool SetChecked(string id, bool isChecked)
        {
            Warn("SetChecked");
            return false;
        }

        /// <summary>Moves a <c>Slider</c> by id, commit included.</summary>
        public bool SetValue(string id, double value)
        {
            Warn("SetValue");
            return false;
        }

        /// <summary>Replaces a <c>TextInput</c>'s text by id.</summary>
        public bool SetText(string id, string text)
        {
            Warn("SetText");
            return false;
        }

        /// <summary>Scrolls a <c>ScrollView</c> by id, clamped to its content.</summary>
        public bool SetScroll(string id, float x, float y)
        {
            Warn("SetScroll");
            return false;
        }

        static void Warn(string operation)
        {
            Debug.LogWarning(string.Format(NotYet, operation));
        }

        // The lifecycle hooks below belong to this file as well (they are the ABI
        // calls that create and drive the document). Left unimplemented on purpose:
        // an unimplemented `partial void` compiles to nothing, and there is no
        // NativeMethods to call yet.
        //
        //   partial void CreateNative()  { ... zb_document_create ... }
        //   partial void DestroyNative() { ... zb_document_destroy ... }
        //   partial void Step(double nowMs) { set_size · set_now · layout_frame · animating }
        //   partial void Flush()         { drain_actions · drain_data_changes → events }
    }
}
