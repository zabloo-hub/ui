using UnityEngine;
using UnityEngine.UIElements;

namespace Zabloo.Rendering
{
    /// <summary>
    /// The tessellator: turns implicit paint (style → rounded-rect fill) and text runs
    /// into UI Toolkit geometry inside <c>generateVisualContent</c>. All coordinates
    /// are element-local, y down, clockwise winding.
    /// </summary>
    public static class Tessellation
    {
        const int CornerSegments = 6;

        /// <summary>Fills a rounded rect (fan around the centroid; radius clamped).</summary>
        public static void RoundedRect(MeshGenerationContext mgc, Rect rect, float radius, Color color)
        {
            // NaN-safe: `NaN <= 0` is false, so check the positive condition.
            if (!(rect.width > 0) || !(rect.height > 0)) return;
            radius = Mathf.Clamp(radius, 0, Mathf.Min(rect.width, rect.height) * 0.5f);

            if (radius <= 0.01f)
            {
                Quad(mgc, rect, color);
                return;
            }

            int perimeterCount = 4 * (CornerSegments + 1);
            var mwd = mgc.Allocate(perimeterCount + 1, perimeterCount * 3);
            Color32 tint = color;

            mwd.SetNextVertex(new Vertex
            {
                position = new Vector3(rect.center.x, rect.center.y, Vertex.nearZ),
                tint = tint,
            });
            EmitPerimeter(mwd, rect, radius, tint);

            for (int i = 0; i < perimeterCount; i++)
            {
                mwd.SetNextIndex(0);
                mwd.SetNextIndex((ushort)(1 + i));
                mwd.SetNextIndex((ushort)(1 + (i + 1) % perimeterCount));
            }
        }

        /// <summary>
        /// Strokes an INSET border: a ring between the rect edge and the edge inset by
        /// `width` (CSS border-box model — nothing paints outside the layout rect, so
        /// hit-testing on layout rects stays honest and clipping never cuts a border).
        /// </summary>
        public static void RoundedRectBorder(MeshGenerationContext mgc, Rect rect, float radius, float width, Color color)
        {
            if (!(rect.width > 0) || !(rect.height > 0) || !(width > 0)) return;
            radius = Mathf.Clamp(radius, 0, Mathf.Min(rect.width, rect.height) * 0.5f);

            // Border thick enough to cover the whole rect: just fill it.
            if (width * 2 >= Mathf.Min(rect.width, rect.height))
            {
                RoundedRect(mgc, rect, radius, color);
                return;
            }

            var inner = new Rect(
                rect.x + width, rect.y + width,
                rect.width - width * 2, rect.height - width * 2);
            float innerRadius = Mathf.Max(0, radius - width);

            int perimeterCount = 4 * (CornerSegments + 1);
            var mwd = mgc.Allocate(perimeterCount * 2, perimeterCount * 6);
            Color32 tint = color;

            // Outer then inner perimeter, same parametrization → stitch quads.
            // (radius 0 degenerates corner arcs to repeated points — harmless.)
            EmitPerimeter(mwd, rect, radius, tint);
            EmitPerimeter(mwd, inner, innerRadius, tint);

            for (int i = 0; i < perimeterCount; i++)
            {
                int next = (i + 1) % perimeterCount;
                mwd.SetNextIndex((ushort)i);
                mwd.SetNextIndex((ushort)next);
                mwd.SetNextIndex((ushort)(perimeterCount + next));
                mwd.SetNextIndex((ushort)(perimeterCount + next));
                mwd.SetNextIndex((ushort)(perimeterCount + i));
                mwd.SetNextIndex((ushort)i);
            }
        }

        /// <summary>
        /// Emits the rounded-rect perimeter: 4 corner arcs traversed clockwise on
        /// screen (y down), 4 × (CornerSegments + 1) vertices.
        /// </summary>
        static void EmitPerimeter(MeshWriteData mwd, Rect rect, float radius, Color32 tint)
        {
            // Corner centers + arc start angles (degrees, y-down space).
            var centers = new Vector2[]
            {
                new Vector2(rect.xMin + radius, rect.yMin + radius), // TL: 180 → 270
                new Vector2(rect.xMax - radius, rect.yMin + radius), // TR: 270 → 360
                new Vector2(rect.xMax - radius, rect.yMax - radius), // BR: 0 → 90
                new Vector2(rect.xMin + radius, rect.yMax - radius), // BL: 90 → 180
            };

            for (int corner = 0; corner < 4; corner++)
            {
                float startDeg = 180f + corner * 90f;
                for (int s = 0; s <= CornerSegments; s++)
                {
                    float rad = (startDeg + 90f * s / CornerSegments) * Mathf.Deg2Rad;
                    var p = centers[corner] + radius * new Vector2(Mathf.Cos(rad), Mathf.Sin(rad));
                    mwd.SetNextVertex(new Vertex
                    {
                        position = new Vector3(p.x, p.y, Vertex.nearZ),
                        tint = tint,
                    });
                }
            }
        }

        static void Quad(MeshGenerationContext mgc, Rect rect, Color color)
        {
            var mwd = mgc.Allocate(4, 6);
            Color32 tint = color;
            mwd.SetNextVertex(new Vertex { position = new Vector3(rect.xMin, rect.yMin, Vertex.nearZ), tint = tint });
            mwd.SetNextVertex(new Vertex { position = new Vector3(rect.xMax, rect.yMin, Vertex.nearZ), tint = tint });
            mwd.SetNextVertex(new Vertex { position = new Vector3(rect.xMax, rect.yMax, Vertex.nearZ), tint = tint });
            mwd.SetNextVertex(new Vertex { position = new Vector3(rect.xMin, rect.yMax, Vertex.nearZ), tint = tint });
            mwd.SetNextIndex(0); mwd.SetNextIndex(1); mwd.SetNextIndex(2);
            mwd.SetNextIndex(2); mwd.SetNextIndex(3); mwd.SetNextIndex(0);
        }

        /// <summary>Draws a single-line text run from our atlas, starting at (0,0).</summary>
        public static void Text(MeshGenerationContext mgc, string text, GlyphAtlas atlas, Color color)
        {
            int quadCount = 0;
            foreach (char c in text)
            {
                if (atlas.TryGetGlyph(c, out var g) && g.HasQuad) quadCount++;
            }
            if (quadCount == 0) return;

            var mwd = mgc.Allocate(quadCount * 4, quadCount * 6, atlas.Texture);
            Color32 tint = color;
            float pen = 0f;
            float baseline = atlas.Ascent;
            ushort vi = 0;

            foreach (char c in text)
            {
                if (!atlas.TryGetGlyph(c, out var glyph)) continue;
                if (glyph.HasQuad)
                {
                    float x0 = pen + glyph.MinX;
                    float x1 = pen + glyph.MaxX;
                    float y0 = baseline - glyph.MaxY;
                    float y1 = baseline - glyph.MinY;

                    mwd.SetNextVertex(new Vertex { position = new Vector3(x0, y0, Vertex.nearZ), tint = tint, uv = glyph.UvTL });
                    mwd.SetNextVertex(new Vertex { position = new Vector3(x1, y0, Vertex.nearZ), tint = tint, uv = glyph.UvTR });
                    mwd.SetNextVertex(new Vertex { position = new Vector3(x1, y1, Vertex.nearZ), tint = tint, uv = glyph.UvBR });
                    mwd.SetNextVertex(new Vertex { position = new Vector3(x0, y1, Vertex.nearZ), tint = tint, uv = glyph.UvBL });

                    mwd.SetNextIndex(vi);
                    mwd.SetNextIndex((ushort)(vi + 1));
                    mwd.SetNextIndex((ushort)(vi + 2));
                    mwd.SetNextIndex((ushort)(vi + 2));
                    mwd.SetNextIndex((ushort)(vi + 3));
                    mwd.SetNextIndex(vi);
                    vi += 4;
                }
                pen += glyph.Advance;
            }
        }
    }
}
