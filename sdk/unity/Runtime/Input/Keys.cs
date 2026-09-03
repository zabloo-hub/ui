using System.Text;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
using Zabloo.Sdk.Interop;

namespace Zabloo
{
    /// <summary>
    /// The keyboard's vocabulary, as the core hears it (UN5, ZAB-198).
    ///
    /// Three things the Input System does not say and the adapter has to:
    /// which physical keys the cascade reads and what intention each one is
    /// (<see cref="Slot"/>, <see cref="Intent"/>); what "the shortcut modifier"
    /// means on this platform (<see cref="Shortcut"/>); and when a HELD key
    /// repeats (<see cref="Repeat"/>) — Godot's <c>is_echo</c> is the OS repeating
    /// the key, and the Input System has no such event for anything but text.
    /// </summary>
    static class Keys
    {
        /// <summary>
        /// The keys the cascade reads, and nothing else. Every other key is the
        /// game's.
        /// </summary>
        public enum Slot
        {
            None = -1,
            Left,
            Right,
            Up,
            Down,
            Home,
            End,
            Backspace,
            Delete,
            Enter,
            Tab,
            Space,
            Escape,
            /// <summary>Only ever read with the shortcut held: select all.</summary>
            A,
            /// <summary>Only ever read with the shortcut held: copy, cut, paste.</summary>
            C,
            X,
            V,
            Count,
        }

        /// <summary>Keys the cascade hands to a focused field first (`edit_key`), in order.</summary>
        public static readonly Slot[] EditSlots =
        {
            Slot.Left, Slot.Right, Slot.Home, Slot.End, Slot.Backspace, Slot.Delete,
            Slot.Enter, Slot.Tab, Slot.Space, Slot.A,
        };

        /// <summary>
        /// Keys that repeat while held: the caret and navigation keys a player
        /// leans on. Enter, Space, Tab and Escape do not — a held Enter is not a
        /// second submission, and the core is told <c>repeat</c> so it can say the
        /// same.
        /// </summary>
        static readonly bool[] Repeats =
        {
            true, true, true, true, true, true, // arrows, Home, End
            true, true, // Backspace, Delete
            false, false, false, false, // Enter, Tab, Space, Escape
            false, false, false, false, // A, C, X, V
        };

        /// <summary>
        /// The hold-to-repeat clock, with the pad's constants (<c>PAD_REPEAT_DELAY_MS</c>
        /// and <c>PAD_REPEAT_RATE_MS</c> in <c>core/src/gamepad.h</c>): a pause,
        /// then a step every so often. The same feel from a d-pad and an arrow key
        /// is the point — the two go through the same handlers (ZAB-47).
        /// </summary>
        public const double RepeatDelayMs = 400.0;

        public const double RepeatRateMs = 90.0;

        /// <summary>The physical key behind a slot. Enter has a second one on the numpad.</summary>
        public static KeyControl Control(Keyboard keyboard, Slot slot)
        {
            switch (slot)
            {
                case Slot.Left: return keyboard.leftArrowKey;
                case Slot.Right: return keyboard.rightArrowKey;
                case Slot.Up: return keyboard.upArrowKey;
                case Slot.Down: return keyboard.downArrowKey;
                case Slot.Home: return keyboard.homeKey;
                case Slot.End: return keyboard.endKey;
                case Slot.Backspace: return keyboard.backspaceKey;
                case Slot.Delete: return keyboard.deleteKey;
                case Slot.Enter: return keyboard.enterKey;
                case Slot.Tab: return keyboard.tabKey;
                case Slot.Space: return keyboard.spaceKey;
                case Slot.Escape: return keyboard.escapeKey;
                case Slot.A: return keyboard.aKey;
                case Slot.C: return keyboard.cKey;
                case Slot.X: return keyboard.xKey;
                case Slot.V: return keyboard.vKey;
                default: return null;
            }
        }

        public static bool WasPressed(Keyboard keyboard, Slot slot)
        {
            var control = Control(keyboard, slot);
            if (control != null && control.wasPressedThisFrame) return true;
            return slot == Slot.Enter && keyboard.numpadEnterKey.wasPressedThisFrame;
        }

        public static bool WasReleased(Keyboard keyboard, Slot slot)
        {
            var control = Control(keyboard, slot);
            if (control != null && control.wasReleasedThisFrame) return true;
            return slot == Slot.Enter && keyboard.numpadEnterKey.wasReleasedThisFrame;
        }

        public static bool IsPressed(Keyboard keyboard, Slot slot)
        {
            var control = Control(keyboard, slot);
            if (control != null && control.isPressed) return true;
            return slot == Slot.Enter && keyboard.numpadEnterKey.isPressed;
        }

        /// <summary>
        /// A slot as the intention a focused field reads — the same table as
        /// <c>intent_of</c> in the Godot adapter. Up, Down and Escape are never a
        /// field's; they come back as <c>Other</c>, which a field cannot use.
        /// </summary>
        public static ZbEditKey Intent(Slot slot)
        {
            switch (slot)
            {
                case Slot.Left: return ZbEditKey.Left;
                case Slot.Right: return ZbEditKey.Right;
                case Slot.Home: return ZbEditKey.Home;
                case Slot.End: return ZbEditKey.End;
                case Slot.Backspace: return ZbEditKey.Backspace;
                case Slot.Delete: return ZbEditKey.Delete;
                case Slot.Enter: return ZbEditKey.Submit;
                case Slot.Tab: return ZbEditKey.Tab;
                case Slot.Space: return ZbEditKey.Space;
                case Slot.A: return ZbEditKey.SelectAll;
                default: return ZbEditKey.Other;
            }
        }

        /// <summary>
        /// The shortcut modifier: Cmd on macOS, Ctrl everywhere else — what Godot
        /// answers with <c>is_command_or_control_pressed</c>. The core takes the
        /// answer and never the question.
        /// </summary>
        public static bool Shortcut(Keyboard keyboard)
        {
#if UNITY_STANDALONE_OSX || UNITY_EDITOR_OSX
            return keyboard.leftCommandKey.isPressed || keyboard.rightCommandKey.isPressed;
#else
            return keyboard.ctrlKey.isPressed;
#endif
        }

        /// <summary>
        /// The hold-to-repeat clock. One key at a time — the last repeatable one
        /// pressed — and at most one repeat per frame after a stall, which is the
        /// pad's rule too.
        /// </summary>
        public struct Repeat
        {
            /// <summary>A default struct holds nothing: the flag, not the slot, says so.</summary>
            bool holding;
            Slot held;
            double dueAt;

            /// <summary>
            /// Reads this frame's keys and answers which slot, if any, repeats now.
            /// A slot pressed this frame is NOT a repeat — the caller sees that on
            /// its own — but it restarts the clock.
            /// </summary>
            public Slot Step(Keyboard keyboard, double nowMs)
            {
                if (holding && !IsPressed(keyboard, held)) holding = false;
                for (var slot = Slot.Left; slot < Slot.Count; slot++)
                {
                    if (!Repeats[(int)slot] || !WasPressed(keyboard, slot)) continue;
                    holding = true;
                    held = slot;
                    dueAt = nowMs + RepeatDelayMs;
                }
                if (!holding || nowMs < dueAt) return Slot.None;
                // Measured from now, not from the missed instant: a stalled frame
                // yields one step, never a burst.
                dueAt = nowMs + RepeatRateMs;
                return held;
            }

            public void Clear()
            {
                holding = false;
            }
        }

        /// <summary>
        /// Where typed text and IME compositions land between frames.
        ///
        /// The Input System delivers text as EVENTS (<c>onTextInput</c>,
        /// <c>onIMECompositionChange</c>) and the view reads its input once per
        /// frame, so something has to hold them in between — and it is static,
        /// subscribed once per process, because the keyboard IS the process's:
        /// one view owns it at a time (UN6), a view is disposable, and a
        /// subscription per instance would outlive the instance (a <c>partial</c>
        /// cannot add an <c>OnDisable</c> to unsubscribe from). Whoever owns the
        /// keyboard drains it; with no owner it is discarded.
        /// </summary>
        public static class TextSink
        {
            static Keyboard attached;
            static readonly StringBuilder typed = new StringBuilder();
            static string composition = "";
            static bool compositionChanged;

            /// <summary>Follows the current keyboard: a device swap re-subscribes.</summary>
            public static void Attach(Keyboard keyboard)
            {
                if (ReferenceEquals(attached, keyboard)) return;
                if (attached != null)
                {
                    attached.onTextInput -= OnText;
                    attached.onIMECompositionChange -= OnComposition;
                }
                attached = keyboard;
                typed.Clear();
                composition = "";
                compositionChanged = false;
                if (keyboard == null) return;
                keyboard.onTextInput += OnText;
                keyboard.onIMECompositionChange += OnComposition;
            }

            static void OnText(char c)
            {
                typed.Append(c);
            }

            static void OnComposition(IMECompositionString text)
            {
                composition = text.ToString();
                compositionChanged = true;
            }

            /// <summary>The characters typed since the last drain, in order; empty when none.</summary>
            public static string DrainText()
            {
                if (typed.Length == 0) return "";
                var text = typed.ToString();
                typed.Clear();
                return text;
            }

            /// <summary>The composition, if it changed since the last drain.</summary>
            public static bool DrainComposition(out string text)
            {
                text = composition;
                if (!compositionChanged) return false;
                compositionChanged = false;
                return true;
            }

            /// <summary>Nobody is listening: what arrived is not owed to anyone.</summary>
            public static void Discard()
            {
                typed.Clear();
                compositionChanged = false;
            }
        }

        /// <summary>
        /// The length of the text element at <c>index</c>: two chars for a
        /// surrogate pair (an emoji arrives as two <c>onTextInput</c> calls and has
        /// to be inserted as one), one otherwise.
        /// </summary>
        public static int ElementLength(string text, int index)
        {
            return index + 1 < text.Length && char.IsHighSurrogate(text[index]) && char.IsLowSurrogate(text[index + 1])
                ? 2
                : 1;
        }

        /// <summary>
        /// Whether a typed unit is text worth inserting. Control codes are not —
        /// Backspace, Tab and Enter all arrive here too, and inserting them would
        /// type the key the cascade has already handled — and nothing typed with
        /// the shortcut held is, because that is a command. A plain Alt IS text:
        /// on many layouts it is how a character is reached at all.
        /// </summary>
        public static bool IsTypeable(char c, bool shortcut)
        {
            return !shortcut && c >= ' ' && c != '\x7f';
        }
    }
}
