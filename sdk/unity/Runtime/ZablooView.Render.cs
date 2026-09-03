using System;
using UnityEngine;
using Zabloo.Render;
using Zabloo.Sdk.Interop;

namespace Zabloo
{
    /// <summary>
    /// The half of the adapter that uploads triangles — the translation of the
    /// Godot adapter's <c>_draw()</c> to UGUI. Everything in this file is
    /// translation: if anything else ends up here it has fallen out of the golden
    /// corpus's net.
    /// </summary>
    public sealed partial class ZablooView
    {
        /// <summary>The child everything painted hangs from. Created on the first paint, dies with the view.</summary>
        RenderSurface surface;

        FrameStats stats;

        /// <summary>What the last painted frame cost. Zeros before one.</summary>
        public FrameStats GetStats()
        {
            return stats;
        }

        /// <summary>
        /// Tessellate FIRST, then sweep the textures, then upload. A <c>Text</c> puts
        /// its glyphs in the atlas when it is measured, so sweeping before this used
        /// to be enough; a <c>TextInput</c> is the first node whose glyphs are only
        /// known at paint time — nothing measures a placeholder — and sweeping first
        /// left them a frame behind, which on a screen that then sits still is a
        /// field whose text simply never appears (ZAB-144).
        /// </summary>
        partial void Paint()
        {
            if (view == IntPtr.Zero)
            {
                // Emptied and not freed: last frame's triangles would otherwise stay
                // on screen with nothing behind them.
                if (surface != null) surface.Clear();
                stats = default;
                return;
            }
            if (surface == null) surface = RenderSurface.Create(transform);

            NativeMethods.zb_view_paint(view, out ZbFrame frame);
            surface.Atlases.Sync(view);
            if (surface.Images.Sync(view))
            {
                // A box that was zero wide until this frame changes what the whole
                // tree measures, so the geometry about to be drawn has to be laid
                // out again first — and a motion this second pass starts (a bar
                // whose fill finally has a track to sit in) arms the frame loop
                // like any other.
                NativeMethods.zb_view_layout_frame(view);
                NativeMethods.zb_view_paint(view, out frame);
                surface.Atlases.Sync(view);
                animating = NativeMethods.zb_view_animating(view) != 0;
            }

            surface.Upload(in frame, size);

            NativeMethods.zb_view_stats(view, out ZbFrameStats native);
            stats = FrameStats.From(in native, surface.UsedGroups);
        }
    }
}
