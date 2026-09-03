using Zabloo.Sdk.Interop;

namespace Zabloo
{
    /// <summary>
    /// What the last painted frame cost — the core's <c>FrameStats</c>
    /// (<c>zb_frame_stats</c>) plus what only the adapter knows. Telemetry, not
    /// contract: the cross-target contract is the snapshot, and none of this is
    /// in it.
    /// </summary>
    public struct FrameStats
    {
        /// <summary>Batches the core emitted — one draw each, before the Canvas merges any.</summary>
        public uint DrawCalls;

        public uint Vertices;

        public uint Indices;

        /// <summary>Glyph atlases alive.</summary>
        public uint Atlases;

        /// <summary>Their pixels, in bytes, as the core holds them (LA8).</summary>
        public ulong AtlasBytes;

        /// <summary>Nodes the resolve pass visited. Zero on a repaint.</summary>
        public uint Resolved;

        /// <summary>Texts re-broken into lines. Zero in a steady frame.</summary>
        public uint TextLayouts;

        /// <summary>Geometry buffers that had to grow. Zero in a steady frame.</summary>
        public uint BufferGrowths;

        /// <summary>The frame was a paint without a layout — what a blinking caret costs.</summary>
        public bool RepaintOnly;

        /// <summary>
        /// Clip groups that painted something this frame: one <c>CanvasRenderer</c>
        /// each. The Unity spelling of the Godot adapter's <c>used_clip_items</c>.
        /// </summary>
        public int ClipGroups;

        internal static FrameStats From(in ZbFrameStats stats, int clipGroups)
        {
            return new FrameStats
            {
                DrawCalls = stats.DrawCalls,
                Vertices = stats.Vertices,
                Indices = stats.Indices,
                Atlases = stats.Atlases,
                AtlasBytes = stats.AtlasBytes,
                Resolved = stats.Resolved,
                TextLayouts = stats.TextLayouts,
                BufferGrowths = stats.BufferGrowths,
                RepaintOnly = stats.RepaintOnly != 0,
                ClipGroups = clipGroups,
            };
        }
    }
}
