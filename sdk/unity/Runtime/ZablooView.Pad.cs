using System;
using UnityEngine;
using UnityEngine.InputSystem;
using Zabloo.Sdk.Interop;

namespace Zabloo
{
    /// <summary>
    /// The gamepad (2026-08-12, ZAB-47), the Unity spelling of the Godot adapter's
    /// pad block.
    ///
    /// The pad is ONE MORE SOURCE of input, not a second input model: every rule
    /// that turns a stick into a direction, a hold into a repeat and a button into
    /// an edge lives in the core (<c>gamepad.h</c>, <c>pad.h</c> — reached through
    /// <c>zb_pad_*</c>), and every intention it produces is served by the handler
    /// the equivalent key already goes through. That is what lets the golden
    /// corpus arbitrate it with a <c>pad</c> script and no engine. What is left
    /// here is exactly what an engine has to answer: <b>which device, which
    /// button, and when to look</b>.
    ///
    /// Out of the box the pad is read through the Input System's own standard
    /// layout — <c>buttonSouth</c> presses, <c>buttonEast</c> goes back, the d-pad
    /// and the left stick navigate, the right stick scrolls — so a project that
    /// plugs a controller in has a navigable UI without configuring anything. The
    /// slots below are the way out for a title whose remapping screen already
    /// exists and whose UI has to follow it.
    /// </summary>
    public sealed partial class ZablooView
    {
        // The native view (`zb_view *`) is the `view` field ZablooView.cs shares with
        // every partial: zero before the first successful load and after the document
        // is destroyed, which is exactly what tells this file not to poll.

        // --- what this view reads each slot from --------------------------------

        /// <summary>Indexed by <see cref="PadButtonSlot"/>: the button read when the slot has no action.</summary>
        readonly GamepadButton[] padButtons = PadMapping.DefaultButtons();

        /// <summary>Indexed by <see cref="PadButtonSlot"/>: an action that replaces the button, or null.</summary>
        readonly InputAction[] padActions = new InputAction[PadMapping.ButtonSlotCount];

        /// <summary>Indexed by <see cref="PadAxisSlot"/>: a standard-mapping axis, or <see cref="PadMapping.AxisOff"/>.</summary>
        readonly int[] padAxes = PadMapping.DefaultAxes();

        /// <summary>
        /// Reads a button slot from another <see cref="GamepadButton"/>, clearing any
        /// action on it: a slot reads from one source. Slots are <c>a</c>, <c>b</c>,
        /// <c>dpad_up</c>, <c>dpad_down</c>, <c>dpad_left</c>, <c>dpad_right</c>. An
        /// unknown slot answers false with a warning, like the operations by id.
        /// </summary>
        public bool SetPadButton(string slot, GamepadButton button)
        {
            if (!PadMapping.TryButtonSlot(slot, out var index))
            {
                Debug.LogWarning($"[zabloo] SetPadButton: no button slot \"{slot}\"", this);
                return false;
            }
            padButtons[(int)index] = button;
            padActions[(int)index] = null;
            return true;
        }

        /// <summary>
        /// Reads a button slot from an Input System action instead of a button — the
        /// equivalent of Godot's <c>InputMap</c>: an action the game's own remapping
        /// screen has already rebound. The action has to be enabled by the game;
        /// this only asks it whether it is pressed. Buttons only: an action here is
        /// a boolean, and an axis is bipolar (<see cref="SetPadAxis"/>). Null hands
        /// the slot back to its button.
        /// </summary>
        public bool SetPadAction(string slot, InputActionReference action)
        {
            return SetPadAction(slot, action != null ? action.action : null);
        }

        public bool SetPadAction(string slot, InputAction action)
        {
            if (!PadMapping.TryButtonSlot(slot, out var index))
            {
                Debug.LogWarning($"[zabloo] SetPadAction: no button slot \"{slot}\"", this);
                return false;
            }
            padActions[(int)index] = action;
            return true;
        }

        /// <summary>
        /// Reads an axis slot from another axis of the standard mapping —
        /// <see cref="PadMapping.AxisLeftX"/> … <see cref="PadMapping.AxisRightY"/>
        /// — or switches it off with <see cref="PadMapping.AxisOff"/>. Slots are
        /// <c>nav_x</c>, <c>nav_y</c>, <c>scroll_x</c>, <c>scroll_y</c>.
        /// </summary>
        public bool SetPadAxis(string slot, int axis)
        {
            if (!PadMapping.TryAxisSlot(slot, out var index))
            {
                Debug.LogWarning($"[zabloo] SetPadAxis: no axis slot \"{slot}\"", this);
                return false;
            }
            padAxes[(int)index] = axis;
            return true;
        }

        // --- the poll ------------------------------------------------------------

        /// <summary>
        /// Once a frame, before the layout pass, so what the player just asked for
        /// is what this very frame draws.
        ///
        /// Three things are reconciled here rather than on a signal, because
        /// <c>Update</c> runs every frame in Unity whether or not anything is
        /// plugged in (Godot needed <c>joy_connection_changed</c> because its
        /// <c>_process</c> was off without a pad): who owns input — the player may
        /// have touched another view —, whether a pad is there at all, and whether
        /// this view has a native view to hand the pad to. Any of the three going
        /// away is the same event as pulling the cable, and goes through the same
        /// door (<see cref="PadDevice.Release"/>).
        /// </summary>
        partial void PollPad()
        {
            // Lazily: the first poll is the first frame this view is alive, which is
            // as close to "enabled" as a partial without a lifecycle hook gets.
            InputOwner.Register(this);

            var handle = view;
            var pad = CurrentPad();
            var now = NowMs;
            var wants = handle != IntPtr.Zero && pad != null && InputOwner.Owns(this);
            if (wants) PadDevice.Adopt(this, now);
            else PadDevice.Release(this);

            padConnected = PadDevice.PolledBy(this);
            if (!padConnected) return;
            if (PadDevice.Poll(this, handle, pad, now)) MarkDirty();
        }

        /// <summary>
        /// The pad being read: the one the player last used, which the Input System
        /// keeps current, falling back to the first one plugged in. Exactly one
        /// device drives the UI, for the reason exactly one view does.
        /// </summary>
        static Gamepad CurrentPad()
        {
            var current = Gamepad.current;
            if (current != null) return current;
            var all = Gamepad.all;
            return all.Count > 0 ? all[0] : null;
        }

        /// <summary>
        /// Fills the process's snapshot from the device, slot by slot, in the core's
        /// vocabulary. Every other index stays at rest: the arrays are never resized
        /// and nothing else writes them.
        /// </summary>
        void ReadPad(Gamepad pad, byte[] buttons, double[] axes)
        {
            for (var slot = 0; slot < PadMapping.ButtonSlotCount; slot++)
            {
                var action = padActions[slot];
                var down = action != null ? action.IsPressed() : pad[padButtons[slot]].isPressed;
                buttons[PadMapping.SnapshotIndex((PadButtonSlot)slot)] = down ? (byte)1 : (byte)0;
            }
            // Unprocessed on purpose: the dead zone with hysteresis is the core's rule
            // (`PAD_NAV_DEADZONE` / `PAD_NAV_RELEASE`), and a stick the engine had
            // already shaped would apply it twice.
            var left = pad.leftStick.ReadUnprocessedValue();
            var right = pad.rightStick.ReadUnprocessedValue();
            for (var slot = 0; slot < PadMapping.AxisSlotCount; slot++)
            {
                axes[slot] = PadMapping.Axis(padAxes[slot], left, right);
            }
        }

        /// <summary>
        /// The process's pad: the core's <c>PadController</c> (<c>zb_pad</c>), the
        /// view currently reading it, and the snapshot it is read into.
        ///
        /// It is owned by the adapter and NOT by any view, and that is deliberate
        /// (G13): everything in the controller is DEVICE state — which way the stick
        /// is pushed, which buttons were down on the previous poll — and a view is
        /// disposable: a hot-update rebuilds it. Clearing the controller with the
        /// view would be the actual bug, because its press state is what turns a
        /// held button into an edge, so zeroing it mid-hold would make the very next
        /// poll read A as newly pressed and press whatever the new tree focused — a
        /// control the player never aimed at. Held across a reload it stays held.
        ///
        /// One handle for the life of the process, destroyed on domain unload like
        /// the views' documents are: the native plugin is never unloaded in the
        /// editor, so a handle nobody destroys is a leak on every Play.
        /// </summary>
        static class PadDevice
        {
            static IntPtr pad;

            /// <summary>The view the pad is connected to, or null while it is connected to none.</summary>
            static ZablooView poller;

            static readonly byte[] Buttons = new byte[PadMapping.SnapshotButtons];
            static readonly double[] Axes = new double[PadMapping.SnapshotAxes];

            static IntPtr Handle()
            {
                if (pad != IntPtr.Zero) return pad;
                pad = NativeMethods.zb_pad_create();
                AppDomain.CurrentDomain.DomainUnload += OnDomainUnload;
                return pad;
            }

            static void OnDomainUnload(object sender, EventArgs e)
            {
                if (pad == IntPtr.Zero) return;
                // Nothing left to tell: the views' documents go in the same unload.
                NativeMethods.zb_pad_destroy(pad);
                pad = IntPtr.Zero;
                poller = null;
            }

            public static bool PolledBy(ZablooView candidate)
            {
                return poller != null && poller == candidate;
            }

            /// <summary>
            /// This view takes the pad. The one that had it loses it FIRST — the pad is
            /// read by one view, so the loser's press cancels and its slider settles
            /// before the winner's first poll — and then the controller is told the
            /// instant, because the scroll stick moves px per SECOND and the first
            /// poll has to measure its frame against something.
            /// </summary>
            public static void Adopt(ZablooView next, double now)
            {
                if (PolledBy(next)) return;
                if (poller != null) Drop(poller);
                poller = next;
                NativeMethods.zb_pad_connect(Handle(), now);
            }

            /// <summary>
            /// This view lets the pad go, if it had it: unplugged, no native view any
            /// more, or the input handed to another view. A no-op for a view that was
            /// not reading it.
            /// </summary>
            public static void Release(ZablooView holder)
            {
                if (!PolledBy(holder)) return;
                Drop(holder);
                poller = null;
            }

            /// <summary>
            /// The pad goes away from this view. A press in flight CANCELS and a Slider
            /// being nudged SETTLES, both decided in the core and both producing
            /// something a game hears — hence the frame asked for: it is what drains
            /// them. A view whose native side is already gone gets a null: nothing
            /// left to tell.
            /// </summary>
            static void Drop(ZablooView holder)
            {
                // A destroyed component is Unity-null: nothing left to tell.
                var handle = holder != null ? holder.view : IntPtr.Zero;
                NativeMethods.zb_pad_disconnect(Handle(), handle);
                if (holder != null) holder.MarkDirty();
            }

            /// <summary>
            /// One poll: the view fills the snapshot, the core's loop runs its rules
            /// over it. The arrays are pinned for the call and nothing is allocated —
            /// reading a pad every frame must not.
            /// </summary>
            public static unsafe bool Poll(ZablooView reader, IntPtr viewHandle, Gamepad device, double now)
            {
                reader.ReadPad(device, Buttons, Axes);
                fixed (byte* buttons = Buttons)
                fixed (double* axes = Axes)
                {
                    var snapshot = new ZbPadSnapshot
                    {
                        Buttons = buttons,
                        ButtonCount = (nuint)Buttons.Length,
                        Axes = axes,
                        AxisCount = (nuint)Axes.Length,
                    };
                    return NativeMethods.zb_pad_poll(Handle(), viewHandle, in snapshot, now) != 0;
                }
            }
        }
    }
}
