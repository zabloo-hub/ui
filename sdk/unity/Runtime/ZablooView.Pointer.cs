using System;
using UnityEngine;
using UnityEngine.InputSystem;
using Zabloo.Sdk.Interop;

namespace Zabloo
{
    /// <summary>
    /// The pointer — a mouse or a finger — as the core's intentions (UN5, ZAB-198).
    ///
    /// This is the Unity spelling of the Godot adapter's <c>_gui_input</c>, and it
    /// does exactly what that did: read the device, put the point into the view's
    /// space, and hand the core a move, a down, an up, a wheel, an exit or a
    /// cancel. Every rule about what those MEAN — hit-testing, hover, a press that
    /// the scroll took from under the finger, a drag that becomes a scroll, a
    /// Slider following the thumb — lives in the core and is what the golden
    /// corpus arbitrates. Nothing here decides anything about the UI.
    ///
    /// The Input System is read directly (<see cref="Pointer.current"/>), never
    /// through UGUI's <c>EventSystem</c>: the view is not a <c>Selectable</c> and
    /// raycasts nothing, the same way the Godot adapter reads <c>InputEvent</c>
    /// and never a <c>Control</c>'s focus.
    ///
    /// <para>What this file expects of its siblings: <c>view</c> (the <c>zb_view*</c>
    /// shared through ZablooView.cs, <c>IntPtr.Zero</c> until an envelope loads,
    /// written by Host.cs) and <c>InputOwner</c> (InputOwner.cs, UN6).</para>
    /// </summary>
    public sealed partial class ZablooView
    {
        /// <summary>The canvas this view is drawn by — where the pointer's camera comes from.</summary>
        Canvas pointerCanvas;

        /// <summary>
        /// The core believes the pointer is on the surface: it was inside the rect,
        /// or a gesture that began inside is still in flight. Going from true to
        /// false is what a <c>pointer_exit</c> means.
        /// </summary>
        bool pointerOnSurface;

        /// <summary>
        /// A gesture began inside the rect and has not ended: the pointer is
        /// CAPTURED, so its moves and its release reach the core even from outside
        /// the rect. The core cancels the tap if the node moved out from under it
        /// (ZAB-70); what it must never see is a gesture with no end.
        /// </summary>
        bool pointerCaptured;

        /// <summary>The last point handed to the core, so a still pointer costs no call.</summary>
        Vector2 pointerLast;
        bool pointerSeen;

        partial void PollPointer()
        {
            var native = view;
            if (native == IntPtr.Zero) return;

            var pointer = Pointer.current;
            if (pointer == null)
            {
                // No pointer at all (a console, a pad-only session): whatever the
                // core was holding is let go of, once.
                if (pointerOnSurface) Leave();
                return;
            }

            // A finger is not a cursor: hover is a mouse state, and a touch that
            // taps and lifts must not leave a control lit up (G6, ZAB-139).
            var mouse = pointer is Mouse ? 1 : 0;
            var inside = ToViewSpace(pointer.position.ReadValue(), out var at);
            var changed = false;

            // The move goes first, so a press that arrived on the same frame lands
            // where the pointer now is — the order the events had.
            if ((inside || pointerCaptured) && (!pointerSeen || at != pointerLast))
            {
                pointerSeen = true;
                pointerLast = at;
                changed |= NativeMethods.zb_view_pointer_move(native, at.x, at.y, mouse) != 0;
            }

            if (pointer.press.wasPressedThisFrame && inside)
            {
                // Touching a view is using it: among several, this one now takes the
                // keys — and the pad with them, since one device cannot drive two
                // focuses (ZAB-70, UN6).
                InputOwner.Claim(this);
                pointerCaptured = true;
                changed |= NativeMethods.zb_view_pointer_down(native, at.x, at.y, mouse) != 0;
            }

            if (pointer.press.wasReleasedThisFrame && pointerCaptured)
            {
                pointerCaptured = false;
                changed |= NativeMethods.zb_view_pointer_up(native, at.x, at.y, mouse) != 0;
            }

            if (mouse != 0 && inside)
            {
                var scroll = Mouse.current.scroll.ReadValue();
                if (scroll != Vector2.zero)
                {
                    Wheel.Pixels(scroll, out var dx, out var dy);
                    changed |= NativeMethods.zb_view_pointer_wheel(native, at.x, at.y, dx, dy) != 0;
                }
            }

            var onSurface = inside || pointerCaptured;
            if (pointerOnSurface && !onSurface)
            {
                // Left without a gesture in flight (or the gesture just ended out
                // there): the hover goes, nothing fires.
                changed |= NativeMethods.zb_view_pointer_exit(native) != 0;
                pointerSeen = false;
            }
            pointerOnSurface = onSurface;

            if (changed) MarkDirty();
        }

        /// <summary>
        /// The pointer is gone from this surface: an exit, and the capture with it.
        /// </summary>
        void Leave()
        {
            pointerOnSurface = false;
            pointerCaptured = false;
            pointerSeen = false;
            var native = view;
            if (native != IntPtr.Zero && NativeMethods.zb_view_pointer_exit(native) != 0) MarkDirty();
        }

        /// <summary>
        /// A gesture in flight when the application loses its focus — the player
        /// alt-tabbed mid-drag, a system dialog took the finger — ends WITHOUT
        /// concluding: every hold dropped, nothing fires, except the Slider that
        /// settles because its value is already on screen (ZAB-70). The pointer's
        /// release will never reach this window, so this is the only end the core
        /// can be given.
        /// </summary>
        void OnApplicationFocus(bool hasFocus)
        {
            if (hasFocus || !pointerCaptured) return;
            pointerCaptured = false;
            pointerOnSurface = false;
            pointerSeen = false;
            var native = view;
            if (native != IntPtr.Zero && NativeMethods.zb_view_pointer_cancel(native) != 0) MarkDirty();
        }

        /// <summary>The canvas can change under a reparent; the camera is read from it again.</summary>
        void OnTransformParentChanged()
        {
            pointerCanvas = null;
        }

        /// <summary>
        /// The camera that maps screen points onto this view — a camera-space
        /// canvas needs its camera to undo the projection; an overlay canvas is
        /// already in screen pixels and wants null. Cached from the root canvas.
        /// </summary>
        Camera CanvasCamera()
        {
            if (pointerCanvas == null)
            {
                var canvas = GetComponentInParent<Canvas>();
                pointerCanvas = canvas != null ? canvas.rootCanvas : null;
            }
            return pointerCanvas != null && pointerCanvas.renderMode != RenderMode.ScreenSpaceOverlay
                ? pointerCanvas.worldCamera
                : null;
        }

        /// <summary>
        /// A screen point as a point in the core's space — origin at the view's
        /// top-left, y down, in the RectTransform's units (the ones the core was
        /// given a size in, so the canvas's scale factor is already accounted for).
        /// Returns whether the point is inside the view's rect.
        /// </summary>
        bool ToViewSpace(Vector2 screen, out Vector2 at)
        {
            var rect = (RectTransform)transform;
            if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(rect, screen, CanvasCamera(), out var local))
            {
                // The view's plane is behind the camera: nowhere the pointer can be.
                at = Vector2.zero;
                return false;
            }
            var box = rect.rect;
            at = new Vector2(local.x - box.xMin, box.yMax - local.y);
            return box.Contains(local);
        }
    }
}
