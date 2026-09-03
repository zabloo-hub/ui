using UnityEngine;
using UnityEngine.InputSystem;

namespace Zabloo
{
    /// <summary>
    /// The button slots the runtime asks for. What fills each one — a
    /// <see cref="GamepadButton"/> or an <see cref="InputAction"/> — is the game's
    /// to decide (<see cref="ZablooView.SetPadButton"/>); the slot is the vocabulary.
    /// </summary>
    public enum PadButtonSlot
    {
        A,
        B,
        DpadUp,
        DpadDown,
        DpadLeft,
        DpadRight,
    }

    /// <summary>
    /// The axis slots: the left stick navigates, the right one scrolls. Each reads
    /// an axis of the standard mapping (<see cref="ZablooView.SetPadAxis"/>).
    /// </summary>
    public enum PadAxisSlot
    {
        NavX,
        NavY,
        ScrollX,
        ScrollY,
    }

    /// <summary>
    /// The translation table between the Input System and the core's gamepad.
    ///
    /// The core speaks the STANDARD MAPPING (https://w3c.github.io/gamepad/#remapping)
    /// — A = 0, B = 1, d-pad = 12..15, left stick = axes 0/1, right stick = 2/3 — and
    /// so does the corpus's <c>pad</c> script, so a script written there means the
    /// same thing on every target. An engine numbers its buttons its own way; the
    /// adapter translates on the way in. That is the whole of this file: which
    /// index each slot lands on, which control it reads by default, and the one sign
    /// that differs.
    ///
    /// <b>Y is flipped.</b> The standard mapping (and Godot with it) reports a stick
    /// pushed UP as a negative Y; the Input System reports it as +1. Every Y axis is
    /// negated here, once, or the focus would walk the wrong way and the right stick
    /// would scroll against the player.
    ///
    /// Pure on purpose — no view, no native call — so it is testable without a
    /// plugin, the way <c>gamepad.h</c> is testable without an engine.
    /// </summary>
    public static class PadMapping
    {
        /// <summary>How many button slots there are.</summary>
        public const int ButtonSlotCount = 6;

        /// <summary>How many axis slots there are.</summary>
        public const int AxisSlotCount = 4;

        /// <summary>
        /// The snapshot is shaped the way a standard-mapping pad reports itself — 17
        /// buttons, 4 axes — and then never resized: polling once a frame allocates
        /// nothing.
        /// </summary>
        public const int SnapshotButtons = 17;

        public const int SnapshotAxes = 4;

        /// <summary>An axis slot that reads nothing: it reports "at rest" forever.</summary>
        public const int AxisOff = -1;

        /// <summary>The standard mapping's axes, by name — what <see cref="ZablooView.SetPadAxis"/> takes.</summary>
        public const int AxisLeftX = 0;

        public const int AxisLeftY = 1;
        public const int AxisRightX = 2;
        public const int AxisRightY = 3;

        static readonly string[] ButtonSlotNames =
        {
            "a", "b", "dpad_up", "dpad_down", "dpad_left", "dpad_right",
        };

        static readonly string[] AxisSlotNames =
        {
            "nav_x", "nav_y", "scroll_x", "scroll_y",
        };

        /// <summary>Where each button slot lands in the snapshot the core reads.</summary>
        static readonly int[] ButtonSlotIndex = { 0, 1, 12, 13, 14, 15 };

        /// <summary>
        /// The control each slot reads until a game says otherwise. South and East
        /// rather than A and B: the Input System names positions, and A/B are the
        /// Xbox spelling of those positions — on a DualShock the same slots are
        /// Cross and Circle, and they should be, without anyone configuring it.
        /// </summary>
        static readonly GamepadButton[] ButtonSlotDefault =
        {
            GamepadButton.South,
            GamepadButton.East,
            GamepadButton.DpadUp,
            GamepadButton.DpadDown,
            GamepadButton.DpadLeft,
            GamepadButton.DpadRight,
        };

        /// <summary>Axis slot i IS axis i of the standard mapping, until remapped.</summary>
        static readonly int[] AxisSlotDefault = { AxisLeftX, AxisLeftY, AxisRightX, AxisRightY };

        /// <summary>The slot that name spells, if any — a typo is answered, not fatal.</summary>
        public static bool TryButtonSlot(string name, out PadButtonSlot slot)
        {
            for (var i = 0; i < ButtonSlotNames.Length; i++)
            {
                if (ButtonSlotNames[i] != name) continue;
                slot = (PadButtonSlot)i;
                return true;
            }
            slot = default;
            return false;
        }

        public static bool TryAxisSlot(string name, out PadAxisSlot slot)
        {
            for (var i = 0; i < AxisSlotNames.Length; i++)
            {
                if (AxisSlotNames[i] != name) continue;
                slot = (PadAxisSlot)i;
                return true;
            }
            slot = default;
            return false;
        }

        /// <summary>The name a slot is spelled with from the game side.</summary>
        public static string Name(PadButtonSlot slot)
        {
            return ButtonSlotNames[(int)slot];
        }

        public static string Name(PadAxisSlot slot)
        {
            return AxisSlotNames[(int)slot];
        }

        /// <summary>The standard-mapping index this button slot writes in the snapshot.</summary>
        public static int SnapshotIndex(PadButtonSlot slot)
        {
            return ButtonSlotIndex[(int)slot];
        }

        /// <summary>The factory layout of the button slots — a fresh copy, since a view remaps its own.</summary>
        public static GamepadButton[] DefaultButtons()
        {
            return (GamepadButton[])ButtonSlotDefault.Clone();
        }

        /// <summary>The factory layout of the axis slots — a fresh copy.</summary>
        public static int[] DefaultAxes()
        {
            return (int[])AxisSlotDefault.Clone();
        }

        /// <summary>
        /// One axis of the standard mapping, read from the two sticks in the SIGN the
        /// core expects. <paramref name="left"/> and <paramref name="right"/> are the
        /// sticks as the Input System reports them (up = +1); the core reads down as
        /// positive, so Y comes back negated. An axis that is switched off, or that
        /// no standard-mapping pad has, is at rest.
        /// </summary>
        public static double Axis(int axis, Vector2 left, Vector2 right)
        {
            switch (axis)
            {
                case AxisLeftX: return left.x;
                case AxisLeftY: return -left.y;
                case AxisRightX: return right.x;
                case AxisRightY: return -right.y;
                default: return 0.0;
            }
        }
    }
}
