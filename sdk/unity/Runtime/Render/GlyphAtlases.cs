using System;
using System.Collections.Generic;
using Unity.Collections;
using Unity.Collections.LowLevel.Unsafe;
using UnityEngine;
using Zabloo.Sdk.Interop;

namespace Zabloo.Render
{
    /// <summary>
    /// The core's glyph atlases as Unity textures — the translation of the Godot
    /// adapter's <c>sync_atlases()</c>.
    ///
    /// The core rasterizes every glyph itself (stb_truetype over the embedded
    /// font) into LA8 atlases: luminance always 255, alpha the coverage. Only the
    /// coverage is uploaded, into a one-channel texture — <c>R8</c>, or
    /// <c>Alpha8</c> where the GPU has no <c>R8</c> — and the shader reads it
    /// back through <c>_ZablooCoverage</c>, a global vector set once here that
    /// names the channel. Tinting is a plain multiply by the vertex color, which
    /// is how a <c>Text</c> gets its <c>style.color</c> and its inherited opacity
    /// in one go.
    ///
    /// Keyed by the core's atlas handle plus its <c>version</c>: a version that
    /// moved is new pixels, a size that grew is a new texture (an atlas that
    /// fills up doubles its side). Swept against the core's live list every
    /// frame — what is missing from it was evicted by the core's LRU, and
    /// dropping the texture here is what frees it. No callback: the core has
    /// none, on purpose (UN2).
    /// </summary>
    internal sealed class GlyphAtlases : IDisposable
    {
        struct Entry
        {
            public Texture2D Texture;
            public uint Version;
            public int Size;
            public int Stamp;
        }

        /// <summary>The one-channel format this GPU takes, decided once.</summary>
        public static readonly TextureFormat Format =
            SystemInfo.SupportsTextureFormat(TextureFormat.R8) ? TextureFormat.R8 : TextureFormat.Alpha8;

        static readonly int CoverageId = Shader.PropertyToID("_ZablooCoverage");
        static bool coverageSet;

        readonly Dictionary<IntPtr, Entry> entries = new Dictionary<IntPtr, Entry>();
        readonly List<IntPtr> stale = new List<IntPtr>();

        /// <summary>The coverage bytes of the atlas being uploaded, `size * size` of them. Grows, never shrinks.</summary>
        NativeArray<byte> scratch;
        int stamp;

        public GlyphAtlases()
        {
            if (coverageSet) return;
            coverageSet = true;
            // R8 samples as (r, 0, 0, 1); Alpha8 as (0, 0, 0, a). The shader takes
            // dot(sample, coverage), so this is the whole difference between them.
            Shader.SetGlobalVector(CoverageId, Format == TextureFormat.R8
                ? new Vector4(1f, 0f, 0f, 0f)
                : new Vector4(0f, 0f, 0f, 1f));
        }

        /// <summary>The texture a batch of kind <c>Glyphs</c> names, or null if the core knows no such atlas.</summary>
        public Texture2D Get(IntPtr handle)
        {
            return entries.TryGetValue(handle, out var entry) ? entry.Texture : null;
        }

        /// <summary>How many atlases are alive right now.</summary>
        public int Count => entries.Count;

        /// <summary>
        /// The sweep. Call AFTER <c>zb_view_paint</c>: a text field rasterizes its
        /// glyphs while painting, and uploading before that leaves them a frame
        /// behind — forever, on a screen that then sits still (ZAB-144).
        /// </summary>
        public void Sync(IntPtr view)
        {
            stamp++;
            uint count = NativeMethods.zb_view_atlas_count(view);
            for (uint i = 0; i < count; i++)
            {
                if (NativeMethods.zb_view_atlas_info(view, i, out ZbAtlasInfo info) == 0) continue;
                entries.TryGetValue(info.Handle, out Entry entry);
                if (entry.Texture == null || entry.Version != info.Version)
                {
                    Upload(ref entry, in info);
                }
                entry.Stamp = stamp;
                entries[info.Handle] = entry;
            }

            // What the loop did not touch is what the core evicted.
            stale.Clear();
            foreach (var pair in entries)
            {
                if (pair.Value.Stamp != stamp) stale.Add(pair.Key);
            }
            for (int i = 0; i < stale.Count; i++)
            {
                Release(entries[stale[i]].Texture);
                entries.Remove(stale[i]);
            }
        }

        unsafe void Upload(ref Entry entry, in ZbAtlasInfo info)
        {
            int size = info.Size;
            if (entry.Texture == null || entry.Size != size)
            {
                Release(entry.Texture);
                entry.Texture = new Texture2D(size, size, Format, false, true)
                {
                    name = "zabloo glyph atlas",
                    filterMode = FilterMode.Bilinear,
                    wrapMode = TextureWrapMode.Clamp,
                    hideFlags = HideFlags.HideAndDontSave,
                };
                entry.Size = size;
            }

            int pixels = size * size;
            if (!scratch.IsCreated || scratch.Length < pixels)
            {
                if (scratch.IsCreated) scratch.Dispose();
                scratch = new NativeArray<byte>(pixels, Allocator.Persistent, NativeArrayOptions.UninitializedMemory);
            }
            // LA8 is L, A, L, A…; the L is always 255, so the alpha is every second
            // byte. A strided copy and no conversion — the bytes go up as they are.
            byte* source = info.Pixels + 1;
            byte* target = (byte*)scratch.GetUnsafePtr();
            for (int i = 0; i < pixels; i++) target[i] = source[i * 2];

            entry.Texture.LoadRawTextureData(scratch.GetSubArray(0, pixels));
            entry.Texture.Apply(false, false);
            entry.Version = info.Version;
        }

        static void Release(Texture2D texture)
        {
            RenderSurface.Free(texture);
        }

        public void Dispose()
        {
            foreach (var pair in entries) Release(pair.Value.Texture);
            entries.Clear();
            if (scratch.IsCreated) scratch.Dispose();
        }
    }
}
