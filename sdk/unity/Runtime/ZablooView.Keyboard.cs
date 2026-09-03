using System;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;
using UnityEngine.InputSystem;
using Zabloo.Sdk.Interop;

namespace Zabloo
{
    /// <summary>
    /// The keyboard — keys, text, the IME, a phone's on-screen keyboard — and
    /// the caret's blink (UN5, ZAB-198).
    ///
    /// The Unity spelling of the Godot adapter's <c>_unhandled_key_input</c>,
    /// <c>clipboard_key</c>, <c>typed_text</c>, <c>sync_ime</c> and
    /// <c>schedule_caret</c>. The cascade is Godot's, in Godot's order: the
    /// clipboard, then the text, then the keys a focused field claims, and only
    /// then navigation — each step handing back what it cannot use, which is what
    /// lets ↑/↓, and a ←/→ against the end of the text, leave the field instead of
    /// trapping the player in it (ZAB-26). What each key MEANS is the core's; this
    /// file only reads the device.
    ///
    /// Only the view that OWNS the keyboard reads it (UN6): the keyboard is the
    /// process's, so two views in a scene would otherwise each move their own
    /// focus on the same arrow (ZAB-70). The view is not a <c>Selectable</c> and
    /// takes no UGUI focus — a project navigating its own UI with the
    /// <c>EventSystem</c> must not have it send navigation events, or the arrows
    /// are eaten before this ever sees them (the phenomenon that kept the Godot
    /// view in <c>FOCUS_NONE</c>).
    ///
    /// <para>What this file expects of its siblings: <c>NativeViewHandle()</c>
    /// and <c>InputOwner</c> (UN6; the handle is answered by Host.cs, UN7), and
    /// <see cref="Paint"/> (Render.cs, UN4) for the caret's repaint.</para>
    /// </summary>
    public sealed partial class ZablooView
    {
        /// <summary>
        /// Whether this frame's Escape closed a modal of this view. An Escape the
        /// view did not use belongs to the game — its own pause menu — and Unity
        /// has no event to accept or let through, so the answer is a property:
        /// read it in <c>LateUpdate</c>, after the view's <c>Update</c> has run.
        /// </summary>
        public bool EscapeConsumedThisFrame { get; private set; }

        /// <summary>The native view this poll is talking to: read once per frame from the host.</summary>
        IntPtr keyboardView;

        /// <summary>This view read the keyboard last frame — an edge on losing it.</summary>
        bool keyboardOwned;

        Keys.Repeat keyRepeat;

        /// <summary>Per-slot: the focused field consumed this key this frame, so navigation must not.</summary>
        readonly bool[] keyConsumed = new bool[(int)Keys.Slot.Count];

        // --- editing: the IME, the on-screen keyboard and the caret ------------------

        /// <summary>The IME is armed for a focused field. An edge, not a per-frame command.</summary>
        bool imeArmed;

        /// <summary>A phone's keyboard, while one is up, and the text it last handed back.</summary>
        TouchScreenKeyboard touchKeyboard;
        string touchMirror;

        /// <summary>The blink chain: which edit it counts from, and when the next flip is due.</summary>
        bool caretArmed;
        double caretSinceArmed;
        double caretFlipAt;

        partial void PollKeyboard()
        {
            EscapeConsumedThisFrame = false;
            keyboardView = NativeViewHandle();
            if (keyboardView == IntPtr.Zero)
            {
                DisarmEditing();
                return;
            }

            // Registering is idempotent and UN6's pad poll does it too; doing it here
            // as well is what makes the first frame's keys reach the first view.
            InputOwner.Register(this);
            var keyboard = Keyboard.current;
            if (keyboard == null || !InputOwner.Owns(this))
            {
                if (keyboardOwned) LoseKeyboard();
                Keys.TextSink.Discard();
                DisarmEditing();
                return;
            }
            keyboardOwned = true;
            Keys.TextSink.Attach(keyboard);

            var now = NowMs;
            if (Cascade(keyboard, now)) MarkDirty();
            SyncEditing(now);
        }

        /// <summary>
        /// Another view took the keyboard (the player touched it), or the device
        /// went away. A held arrow's gesture SETTLES — its value is on screen and
        /// was written on every step, so the game is owed its <c>onCommit</c> — and
        /// a held Enter's press is let go WITHOUT activating: its release will land
        /// elsewhere. The pad's closing rules, for the keys (ZAB-47).
        /// </summary>
        void LoseKeyboard()
        {
            keyboardOwned = false;
            keyRepeat.Clear();
            var changed = NativeMethods.zb_view_settle_slider_keys(keyboardView) != 0;
            changed |= NativeMethods.zb_view_cancel_focused_press(keyboardView) != 0;
            if (changed) MarkDirty();
        }

        /// <summary>One frame of the cascade. Answers whether the core changed anything.</summary>
        bool Cascade(Keyboard keyboard, double now)
        {
            var shortcut = Keys.Shortcut(keyboard);
            var shift = keyboard.shiftKey.isPressed;
            var repeating = keyRepeat.Step(keyboard, now);
            Array.Clear(keyConsumed, 0, keyConsumed.Length);
            var changed = false;

            // 1. The clipboard. The selection is the core's; the clipboard is
            // Unity's. A cut deletes through the ordinary edit path and a paste goes
            // in through `insert_text`, so `maxLength`, the bound write and the
            // single-line rule all apply exactly as they do to a key.
            if (shortcut)
            {
                var copy = Keys.WasPressed(keyboard, Keys.Slot.C);
                var cut = Keys.WasPressed(keyboard, Keys.Slot.X);
                if ((copy || cut) && NativeMethods.zb_view_field_selection_text(keyboardView, out var selected) != 0)
                {
                    GUIUtility.systemCopyBuffer = Utf8Of(selected);
                    if (cut)
                    {
                        var remove = new ZbKeyIntent { Key = ZbEditKey.Backspace };
                        changed |= NativeMethods.zb_view_edit_key(keyboardView, in remove) != 0;
                    }
                }
                if (Keys.WasPressed(keyboard, Keys.Slot.V))
                {
                    var pasted = GUIUtility.systemCopyBuffer;
                    if (!string.IsNullOrEmpty(pasted)) changed |= InsertText(pasted);
                }
            }

            // 2. A composition in flight, shown and not told (ZAB-26). Each update
            // REPLACES the previous — the core keeps the base — and an empty one is
            // the composition ending: the field goes back to its base and the game
            // is told once, then the settled text arrives as ordinary text below.
            // (`onIMECompositionChange` cannot say whether it ended settled or
            // abandoned; the text that follows, or does not, is what says.)
            if (Keys.TextSink.DrainComposition(out var composition))
            {
                if (composition.Length > 0)
                {
                    changed |= SendText(composition, composition: true);
                }
                else
                {
                    changed |= SendText("", composition: true);
                    changed |= NativeMethods.zb_view_end_composition(keyboardView) != 0;
                }
            }

            // 3. Text, BEFORE the keys: a space is text. The core consumes the Space
            // key so it presses nothing, exactly as the reference does — but there
            // the hidden `<textarea>` inserts it, and here nothing else would.
            var typed = Keys.TextSink.DrainText();
            for (var i = 0; i < typed.Length;)
            {
                var length = Keys.ElementLength(typed, i);
                if (Keys.IsTypeable(typed[i], shortcut) && InsertText(typed.Substring(i, length)))
                {
                    changed = true;
                    if (typed[i] == ' ') keyConsumed[(int)Keys.Slot.Space] = true;
                }
                i += length;
            }

            // 4. The keys a focused field claims. Consumed means navigation stays
            // out of it this frame; not consumed means the field cannot use it —
            // there is no field, or the caret is already against that end.
            foreach (var slot in Keys.EditSlots)
            {
                var pressed = Keys.WasPressed(keyboard, slot);
                var repeat = repeating == slot && !pressed;
                if (!pressed && !repeat) continue;
                if (slot == Keys.Slot.A && !shortcut) continue;
                var intent = new ZbKeyIntent
                {
                    Key = Keys.Intent(slot),
                    Shift = shift ? 1 : 0,
                    Shortcut = shortcut ? 1 : 0,
                    Repeat = repeat ? 1 : 0,
                };
                if (NativeMethods.zb_view_edit_key(keyboardView, in intent) == 0) continue;
                keyConsumed[(int)slot] = true;
                changed = true;
            }

            // 5. Navigation: four directions, a press and a release, and Escape.
            changed |= Arrow(keyboard, Keys.Slot.Left, repeating, -1, 0);
            changed |= Arrow(keyboard, Keys.Slot.Right, repeating, 1, 0);
            changed |= Arrow(keyboard, Keys.Slot.Up, repeating, 0, -1);
            changed |= Arrow(keyboard, Keys.Slot.Down, repeating, 0, 1);
            changed |= Activate(keyboard, Keys.Slot.Enter);
            changed |= Activate(keyboard, Keys.Slot.Space);

            // A dismiss request for the modal that owns the input — the keyboard's
            // B button. With nothing up it is NOT ours, and `EscapeConsumedThisFrame`
            // stays false so the game's own pause menu can have it.
            if (Keys.WasPressed(keyboard, Keys.Slot.Escape) && NativeMethods.zb_view_dismiss_top_modal(keyboardView) != 0)
            {
                EscapeConsumedThisFrame = true;
                changed = true;
            }

            return changed;
        }

        /// <summary>
        /// A direction moves the focus — or, on a Slider, its own axis nudges the
        /// value — and LETTING GO of it ends that gesture. The core is told about
        /// presses, so the release is the only thing that can tell it where the
        /// nudging stopped, and <c>onCommit</c> is what a game applies the
        /// expensive thing on (ZAB-24, ZAB-143). The browser's <c>keyup</c>, here.
        /// </summary>
        bool Arrow(Keyboard keyboard, Keys.Slot slot, Keys.Slot repeating, double dx, double dy)
        {
            var changed = false;
            var fires = Keys.WasPressed(keyboard, slot) || repeating == slot;
            if (fires && !keyConsumed[(int)slot])
            {
                changed = NativeMethods.zb_view_move_focus(keyboardView, dx, dy) != 0;
            }
            if (Keys.WasReleased(keyboard, slot))
            {
                changed |= NativeMethods.zb_view_settle_slider_keys(keyboardView) != 0;
            }
            return changed;
        }

        /// <summary>
        /// Enter and Space press the focused node on the way down and activate it
        /// on the way up — the same two halves as a pointer, so a Button fires on
        /// the release. A repeat is the OS holding the key, never a second press.
        /// </summary>
        bool Activate(Keyboard keyboard, Keys.Slot slot)
        {
            var changed = false;
            if (Keys.WasPressed(keyboard, slot) && !keyConsumed[(int)slot])
            {
                changed = NativeMethods.zb_view_press_focused(keyboardView, 1) != 0;
            }
            if (Keys.WasReleased(keyboard, slot))
            {
                changed |= NativeMethods.zb_view_press_focused(keyboardView, 0) != 0;
            }
            return changed;
        }

        /// <summary>Text into the focused field, UTF-8. False when no field took it.</summary>
        bool InsertText(string text)
        {
            return SendText(text, composition: false);
        }

        /// <summary>UTF-8 across the frontier: inserted, or shown as the composition in flight.</summary>
        unsafe bool SendText(string text, bool composition)
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            fixed (byte* p = bytes)
            {
                var length = (nuint)bytes.Length;
                return (composition
                    ? NativeMethods.zb_view_set_composition(keyboardView, p, length)
                    : NativeMethods.zb_view_insert_text(keyboardView, p, length)) != 0;
            }
        }

        // --- the IME, the on-screen keyboard and the caret ----------------------------

        /// <summary>
        /// Follows the focus in and out of a text field: arms the IME where the
        /// caret is, raises the on-screen keyboard where there is one, and keeps
        /// the caret blinking. Once per frame, after the cascade, so the field that
        /// has the keyboard is settled in one place rather than from each of the
        /// half dozen paths that can move the focus (the pad's included: UN6's
        /// poll runs before this in <c>Update</c>).
        /// </summary>
        void SyncEditing(double now)
        {
            if (NativeMethods.zb_view_focused_field(keyboardView, out var field) == 0)
            {
                DisarmEditing();
                return;
            }

            var keyboard = Keyboard.current;
            if (!imeArmed)
            {
                imeArmed = true;
                if (keyboard != null) keyboard.SetIMEEnabled(true);
                // Only on the way IN: opening it every frame would fight the player
                // dismissing it, and the text it is given is what a phone's
                // autocomplete works from.
                if (TouchScreenKeyboard.isSupported)
                {
                    touchMirror = Utf8Of(field.Text);
                    touchKeyboard = TouchScreenKeyboard.Open(touchMirror, TouchScreenKeyboardType.Default);
                }
            }

            // Where the candidate list goes: just under the field, in screen pixels.
            // The field's corner and not the caret's exact x — the caret's offset is
            // behind the core's glyph metrics, and a list under the box being typed
            // into is what the player is looking at anyway.
            if (keyboard != null)
            {
                keyboard.SetIMECursorPosition(ToScreen(new Vector2((float)field.X, (float)(field.Y + field.Height))));
            }

            if (touchKeyboard != null) MirrorTouchKeyboard();

            // The blink is a closed form of the time since the last edit, so the
            // only frames it needs are the two per period on which `caret_visible`
            // changes. Re-armed only when the PHASE moved — a different edit reset
            // the clock — and asked for as a REPAINT: the clock moves and the
            // geometry is re-tessellated, with the whole pipeline before it skipped
            // (ZAB-73). Safe because every mutation of this view ends in a full
            // frame, so a repaint never reads values one should have refreshed.
            if (!caretArmed || field.CaretSince != caretSinceArmed)
            {
                caretArmed = true;
                caretSinceArmed = field.CaretSince;
                caretFlipAt = NextCaretFlip(now, field);
            }
            else if (now >= caretFlipAt)
            {
                caretFlipAt = NextCaretFlip(now, field);
                // A full frame is on its way anyway: it repaints with the clock.
                if (!dirty && !animating)
                {
                    NativeMethods.zb_view_set_now(keyboardView, now);
                    Paint();
                }
            }
        }

        /// <summary>The next instant `caret_visible` flips: the end of the current half-period.</summary>
        static double NextCaretFlip(double now, in ZbFieldInfo field)
        {
            var half = field.BlinkMs / 2.0;
            var since = Math.Max(0.0, now - field.CaretSince);
            var wait = half - since % half;
            // Never zero: a flip due "now" would spin on this very frame.
            if (!(wait > 1.0)) wait = half;
            return now + wait;
        }

        /// <summary>
        /// A phone's keyboard holds the whole value, so a change is mirrored back as
        /// a replacement — select all, then insert — which is what applies
        /// <c>maxLength</c> and the single-line rule to it. Done submits; cancelled
        /// (or closed) just goes away, and the focus decides whether it comes back.
        /// </summary>
        void MirrorTouchKeyboard()
        {
            var status = touchKeyboard.status;
            if (status == TouchScreenKeyboard.Status.Visible)
            {
                var text = touchKeyboard.text;
                if (text == touchMirror) return;
                touchMirror = text;
                var all = new ZbKeyIntent { Key = ZbEditKey.SelectAll, Shortcut = 1 };
                NativeMethods.zb_view_edit_key(keyboardView, in all);
                if (text.Length == 0)
                {
                    var remove = new ZbKeyIntent { Key = ZbEditKey.Backspace };
                    NativeMethods.zb_view_edit_key(keyboardView, in remove);
                }
                else
                {
                    InsertText(text);
                }
                MarkDirty();
                return;
            }
            if (status == TouchScreenKeyboard.Status.Done)
            {
                var submit = new ZbKeyIntent { Key = ZbEditKey.Submit };
                if (NativeMethods.zb_view_edit_key(keyboardView, in submit) != 0) MarkDirty();
            }
            touchKeyboard = null;
        }

        /// <summary>Nothing to edit: the IME, the on-screen keyboard and the blink all stand down.</summary>
        void DisarmEditing()
        {
            caretArmed = false;
            if (!imeArmed) return;
            imeArmed = false;
            var keyboard = Keyboard.current;
            if (keyboard != null) keyboard.SetIMEEnabled(false);
            if (touchKeyboard != null)
            {
                touchKeyboard.active = false;
                touchKeyboard = null;
            }
        }

        /// <summary>A point in the core's space (y down, view's top-left) as a screen point.</summary>
        Vector2 ToScreen(Vector2 at)
        {
            var rect = (RectTransform)transform;
            var box = rect.rect;
            var local = new Vector3(box.xMin + at.x, box.yMax - at.y, 0f);
            var world = rect.TransformPoint(local);
            return RectTransformUtility.WorldToScreenPoint(CanvasCamera(), world);
        }

        /// <summary>A string the core handed out, as a managed one. Empty for none.</summary>
        static string Utf8Of(ZbStr text)
        {
            return text.Data == IntPtr.Zero || text.Len == 0
                ? ""
                : Marshal.PtrToStringUTF8(text.Data, checked((int)text.Len));
        }
    }
}
