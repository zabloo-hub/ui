using UnityEngine;

namespace Zabloo
{
    /// <summary>
    /// The mouse wheel, in the core's units.
    ///
    /// The core takes a wheel in view-space PIXELS — what a browser reports, and
    /// what the reference consumes as it comes. Nothing else reports pixels: Godot
    /// reports a discrete notch with a factor, and the Input System reports a
    /// delta whose range depends on the platform AND on the package version. So
    /// something has to translate, the corpus cannot arbitrate it (no case records
    /// a wheel), and the constant is the one the Godot adapter fixed (G6, ZAB-139):
    /// <b>50 px per notch</b>. The axes stay 1:1 with the reference — a vertical
    /// wheel scrolls a horizontal-only scroller not at all, which is gap (a) of
    /// ZAB-9, left the same in every target on purpose.
    /// </summary>
    static class Wheel
    {
        /// <summary>What one notch of the wheel scrolls, in view-space pixels.</summary>
        public const double PixelsPerNotch = 50.0;

        /// <summary>
        /// Windows reports a notch as ±120 (the raw <c>WHEEL_DELTA</c>) in Input
        /// System 1.7, and as ±1 in the versions that normalize scroll deltas
        /// (<c>ScrollDeltaBehavior.UniformAcrossAllPlatforms</c>, the default once it
        /// exists). Reading that setting needs a version define; a magnitude does
        /// not: no normalized frame accumulates ten notches, and no raw notch is
        /// smaller than a quarter of one (30, the finest a precision wheel sends).
        /// </summary>
        const float WindowsRawThreshold = 10f;

        const float WindowsRawNotch = 120f;

        /// <summary>The Input System's delta as notches, whatever units it arrived in.</summary>
        public static Vector2 Notches(Vector2 scroll)
        {
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN || UNITY_WSA
            var magnitude = Mathf.Max(Mathf.Abs(scroll.x), Mathf.Abs(scroll.y));
            if (magnitude > WindowsRawThreshold) return scroll / WindowsRawNotch;
#endif
            return scroll;
        }

        /// <summary>
        /// The delta the core takes at a point: <c>dx</c> positive to the right,
        /// <c>dy</c> positive DOWN — the wheel rolled towards the player scrolls the
        /// content down. The Input System's y grows the other way (up is positive),
        /// hence the flip.
        /// </summary>
        public static void Pixels(Vector2 scroll, out double dx, out double dy)
        {
            var notches = Notches(scroll);
            dx = notches.x * PixelsPerNotch;
            dy = -notches.y * PixelsPerNotch;
        }
    }
}
