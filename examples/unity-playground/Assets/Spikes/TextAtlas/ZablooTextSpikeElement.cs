using UnityEngine;
using UnityEngine.UIElements;

namespace Zabloo.Spikes
{
    /// <summary>
    /// SPIKE — a VisualElement that renders a string as textured quads from our own
    /// glyph atlas, via <c>generateVisualContent</c> (UI Toolkit's custom-geometry
    /// hook: it's called when the element is dirty, we emit vertices/indices, and
    /// UI Toolkit batches + submits the draw call — retained mode with dirty flags).
    ///
    /// The key question it answers: can we pass OUR texture to
    /// <c>MeshGenerationContext.Allocate</c> and mix our geometry with our atlas?
    /// </summary>
    public class ZablooTextSpikeElement : VisualElement
    {
        readonly ZablooGlyphAtlas _atlas;
        readonly string _text;
        readonly Color32 _color;

        public ZablooTextSpikeElement(ZablooGlyphAtlas atlas, string text, Color color)
        {
            _atlas = atlas;
            _text = text;
            _color = color;

            // Size the element from OUR metrics — this is the "measure" half of the
            // future layout integration (Yoga asks the Text node how big it is).
            Vector2 size = atlas.Measure(text);
            style.width = size.x;
            style.height = size.y;

            generateVisualContent += OnGenerateVisualContent;
        }

        void OnGenerateVisualContent(MeshGenerationContext mgc)
        {
            // Count drawable glyphs (whitespace advances the pen, emits no quad).
            int quadCount = 0;
            foreach (char c in _text)
                if (_atlas.TryGetGlyph(c, out var g) && g.HasQuad)
                    quadCount++;
            if (quadCount == 0) return;

            // Allocate with OUR texture. UI Toolkit may pack it into its internal
            // dynamic atlas, but since Unity 6 the renderer remaps UVs automatically —
            // we write plain 0..1 atlas coordinates.
            MeshWriteData mwd = mgc.Allocate(quadCount * 4, quadCount * 6, _atlas.Texture);

            float pen = 0f;
            float baseline = _atlas.Ascent; // px from the top (UITK y goes down)
            ushort vertIndex = 0;

            foreach (char c in _text)
            {
                if (!_atlas.TryGetGlyph(c, out var glyph)) continue;

                if (glyph.HasQuad)
                {
                    // Glyph quad in element space (y down). Glyph metrics are
                    // font-convention (Y positive up from the baseline) → flip.
                    float x0 = pen + glyph.MinX;
                    float x1 = pen + glyph.MaxX;
                    float y0 = baseline - glyph.MaxY; // top
                    float y1 = baseline - glyph.MinY; // bottom

                    // The 4 UV corners come straight from the glyph table (the engine
                    // may have stored the glyph rotated — corners handle that).
                    Vector2 uvTL = glyph.UvTL;
                    Vector2 uvTR = glyph.UvTR;
                    Vector2 uvBR = glyph.UvBR;
                    Vector2 uvBL = glyph.UvBL;

                    mwd.SetNextVertex(new Vertex { position = new Vector3(x0, y0, Vertex.nearZ), tint = _color, uv = uvTL }); // TL
                    mwd.SetNextVertex(new Vertex { position = new Vector3(x1, y0, Vertex.nearZ), tint = _color, uv = uvTR }); // TR
                    mwd.SetNextVertex(new Vertex { position = new Vector3(x1, y1, Vertex.nearZ), tint = _color, uv = uvBR }); // BR
                    mwd.SetNextVertex(new Vertex { position = new Vector3(x0, y1, Vertex.nearZ), tint = _color, uv = uvBL }); // BL

                    // Two clockwise triangles (UITK is y-down, clockwise winding).
                    mwd.SetNextIndex(vertIndex);
                    mwd.SetNextIndex((ushort)(vertIndex + 1));
                    mwd.SetNextIndex((ushort)(vertIndex + 2));
                    mwd.SetNextIndex((ushort)(vertIndex + 2));
                    mwd.SetNextIndex((ushort)(vertIndex + 3));
                    mwd.SetNextIndex(vertIndex);
                    vertIndex += 4;
                }

                pen += glyph.Advance;
            }
        }
    }
}
