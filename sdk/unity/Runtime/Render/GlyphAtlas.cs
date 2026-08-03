using System.Collections.Generic;
using UnityEngine;

namespace Zabloo.Rendering
{
    /// <summary>
    /// Self-owned glyph atlas — the productized outcome of the 2026-08-02 text spike.
    ///
    /// The engine rasterizes glyphs via public API (Font.RequestCharactersInTexture)
    /// into its internal dynamic font texture; we snapshot that (GPU blit → CPU read)
    /// into an RGBA32 atlas WE own (white + coverage alpha), plus our own metrics
    /// table for the layout pass. After the snapshot, engine-side repacking cannot
    /// affect us. Rasterizer ownership long-term (core vs per-engine) is still an
    /// open decision — everything downstream (atlas, metrics, quads) is already ours.
    /// </summary>
    public sealed class GlyphAtlas
    {
        public struct GlyphInfo
        {
            public float Advance;
            /// <summary>Quad extents in px: X from the pen, Y from the baseline (MaxY = top, up+).</summary>
            public float MinX, MaxX, MinY, MaxY;
            /// <summary>UV corners in the atlas (4 corners: glyphs may be stored rotated).</summary>
            public Vector2 UvTL, UvTR, UvBL, UvBR;
            public bool HasQuad;
        }

        public Texture2D Texture { get; private set; }
        public float LineHeight { get; private set; }
        public float Ascent { get; private set; }

        readonly Dictionary<char, GlyphInfo> _glyphs = new Dictionary<char, GlyphInfo>();

        public bool Build(Font font, int pointSize, string charset)
        {
            font.RequestCharactersInTexture(charset, pointSize, FontStyle.Normal);

            float scale = font.fontSize > 0 ? (float)pointSize / font.fontSize : 1f;
            LineHeight = font.lineHeight * scale;
            Ascent = font.ascent * scale;

            foreach (char c in charset)
            {
                if (_glyphs.ContainsKey(c)) continue;
                if (!font.GetCharacterInfo(c, out CharacterInfo ci, pointSize))
                {
                    Debug.LogWarning($"[zabloo] No glyph for '{c}'.");
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

            Texture fontTex = font.material != null ? font.material.mainTexture : null;
            if (fontTex == null)
            {
                Debug.LogError("[zabloo] Font has no texture after rasterization.");
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

            // White RGB + coverage alpha so UI Toolkit's default shader (tex * tint)
            // tints correctly. Coverage = max(r, a): Alpha8 samples differ per backend.
            var pixels = cpu.GetPixels32();
            for (int i = 0; i < pixels.Length; i++)
            {
                byte coverage = System.Math.Max(pixels[i].r, pixels[i].a);
                pixels[i] = new Color32(255, 255, 255, coverage);
            }

            Texture = new Texture2D(fontTex.width, fontTex.height, TextureFormat.RGBA32, false)
            {
                name = $"zabloo-glyph-atlas-{pointSize}",
                filterMode = FilterMode.Bilinear,
            };
            Texture.SetPixels32(pixels);
            Texture.Apply(false, false);
            Object.Destroy(cpu);
            return true;
        }

        public bool TryGetGlyph(char c, out GlyphInfo info) => _glyphs.TryGetValue(c, out info);

        /// <summary>Single-line measure in px — what the layout pass calls to size a Text node.</summary>
        public Vector2 Measure(string text)
        {
            float width = 0;
            foreach (char c in text)
            {
                if (_glyphs.TryGetValue(c, out var g)) width += g.Advance;
            }
            return new Vector2(width, LineHeight);
        }
    }

    /// <summary>
    /// One atlas per requested point size. Charsets are accumulated while walking the
    /// IR, then atlases are built lazily on first use.
    /// </summary>
    public sealed class FontLibrary
    {
        readonly Dictionary<int, string> _charsets = new Dictionary<int, string>();
        readonly Dictionary<int, GlyphAtlas> _atlases = new Dictionary<int, GlyphAtlas>();
        Font _font;

        Font FontRef =>
            _font != null ? _font : _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

        public void Request(int pointSize, string chars)
        {
            _charsets.TryGetValue(pointSize, out var existing);
            _charsets[pointSize] = (existing ?? "") + chars;
        }

        public GlyphAtlas Get(int pointSize)
        {
            if (_atlases.TryGetValue(pointSize, out var atlas)) return atlas;
            atlas = new GlyphAtlas();
            _charsets.TryGetValue(pointSize, out var charset);
            atlas.Build(FontRef, pointSize, charset ?? "");
            _atlases[pointSize] = atlas;
            return atlas;
        }
    }
}
