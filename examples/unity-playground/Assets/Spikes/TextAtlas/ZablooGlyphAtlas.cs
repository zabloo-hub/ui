using System.Collections.Generic;
using UnityEngine;

namespace Zabloo.Spikes
{
    /// <summary>
    /// SPIKE — builds a self-owned glyph atlas using only PUBLIC Unity API.
    ///
    /// How: <c>Font.RequestCharactersInTexture</c> makes the engine rasterize the
    /// glyphs into its internal dynamic font texture; we then snapshot that texture
    /// (GPU blit → CPU read) into an RGBA32 atlas WE own, and keep our own metrics
    /// table from <c>Font.GetCharacterInfo</c>. After the snapshot, the engine's
    /// texture can repack/evict freely — our copy is stable.
    ///
    /// What this proves for the self-renderer model:
    ///  1. WE own the atlas texture and its lifetime (not the engine's text system).
    ///  2. WE get the metrics needed to measure text for our own layout pass.
    ///
    /// Engine note: the *rasterization source* here is Unity-specific (a spike
    /// shortcut). The cross-engine decision this spike informs is: shared rasterizer
    /// in the core (stb_truetype/FreeType) vs. per-engine rasterizer behind a common
    /// interface. Everything downstream (atlas, metrics, quads) is already ours.
    /// </summary>
    public class ZablooGlyphAtlas
    {
        public struct GlyphInfo
        {
            /// <summary>Pen advance in px.</summary>
            public float Advance;

            /// <summary>Quad extents in px: X relative to the pen, Y relative to the
            /// baseline (MaxY = top, positive up — font convention).</summary>
            public float MinX, MaxX, MinY, MaxY;

            /// <summary>UV corners in OUR atlas (4 corners because the engine may
            /// store glyphs rotated 90° in the font texture).</summary>
            public Vector2 UvTL, UvTR, UvBL, UvBR;

            /// <summary>False for whitespace — advances the pen, emits no quad.</summary>
            public bool HasQuad;
        }

        /// <summary>RGBA32 atlas (white + coverage in alpha) — what we hand to UI Toolkit.</summary>
        public Texture2D Texture { get; private set; }

        /// <summary>Line height in px at the requested point size.</summary>
        public float LineHeight { get; private set; }

        /// <summary>Baseline distance from the top of the line, in px.</summary>
        public float Ascent { get; private set; }

        readonly Dictionary<char, GlyphInfo> _glyphs = new Dictionary<char, GlyphInfo>();

        /// <summary>
        /// Rasterizes every distinct character of <paramref name="charset"/> at
        /// <paramref name="pointSize"/> px and snapshots them into our own atlas.
        /// </summary>
        public bool Build(Font font, int pointSize, string charset)
        {
            // 1. Engine rasterizes into its internal dynamic font texture.
            font.RequestCharactersInTexture(charset, pointSize, FontStyle.Normal);

            // Font-wide metrics are expressed at font.fontSize — scale to ours.
            float scale = font.fontSize > 0 ? (float)pointSize / font.fontSize : 1f;
            LineHeight = font.lineHeight * scale;
            Ascent = font.ascent * scale;

            // 2. Collect OUR metrics table (already scaled to pointSize by Unity).
            foreach (char c in charset)
            {
                if (_glyphs.ContainsKey(c)) continue;
                if (!font.GetCharacterInfo(c, out CharacterInfo ci, pointSize))
                {
                    Debug.LogWarning($"[zabloo spike] No glyph for '{c}'.");
                    continue;
                }

                _glyphs[c] = new GlyphInfo
                {
                    Advance = ci.advance,
                    MinX = ci.minX,
                    MaxX = ci.maxX,
                    MinY = ci.minY,
                    MaxY = ci.maxY,
                    UvTL = ci.uvTopLeft,
                    UvTR = ci.uvTopRight,
                    UvBL = ci.uvBottomLeft,
                    UvBR = ci.uvBottomRight,
                    HasQuad = !char.IsWhiteSpace(c),
                };
            }

            // 3. Snapshot the engine's font texture into an atlas WE own.
            Texture fontTex = font.material != null ? font.material.mainTexture : null;
            if (fontTex == null)
            {
                Debug.LogError("[zabloo spike] Font has no texture after rasterization.");
                return false;
            }

            var rt = RenderTexture.GetTemporary(fontTex.width, fontTex.height, 0, RenderTextureFormat.ARGB32);
            Graphics.Blit(fontTex, rt);

            var prev = RenderTexture.active;
            RenderTexture.active = rt;
            var cpu = new Texture2D(fontTex.width, fontTex.height, TextureFormat.RGBA32, false);
            cpu.ReadPixels(new Rect(0, 0, fontTex.width, fontTex.height), 0, 0);
            RenderTexture.active = prev;
            RenderTexture.ReleaseTemporary(rt);

            // Normalize to white RGB + coverage alpha so UI Toolkit's default shader
            // (texture * tint) tints correctly. Coverage = max(r, a): Alpha8 textures
            // sample as alpha on some backends and as red on others.
            var pixels = cpu.GetPixels32();
            for (int i = 0; i < pixels.Length; i++)
            {
                byte coverage = System.Math.Max(pixels[i].r, pixels[i].a);
                pixels[i] = new Color32(255, 255, 255, coverage);
            }

            Texture = new Texture2D(fontTex.width, fontTex.height, TextureFormat.RGBA32, false)
            {
                name = "zabloo-glyph-atlas",
                filterMode = FilterMode.Bilinear,
            };
            Texture.SetPixels32(pixels);
            Texture.Apply(false, false);

            Object.Destroy(cpu);
            return true;
        }

        public bool TryGetGlyph(char c, out GlyphInfo info) => _glyphs.TryGetValue(c, out info);

        /// <summary>
        /// Measures a single-line string in px. This is what the future Yoga pass
        /// calls to size a Text node.
        /// </summary>
        public Vector2 Measure(string text)
        {
            float width = 0;
            foreach (char c in text)
                if (_glyphs.TryGetValue(c, out var g))
                    width += g.Advance;
            return new Vector2(width, LineHeight);
        }
    }
}
