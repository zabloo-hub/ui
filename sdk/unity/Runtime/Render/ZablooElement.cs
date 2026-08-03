using UnityEngine;
using UnityEngine.UIElements;

namespace Zabloo.Rendering
{
    /// <summary>
    /// The VisualElement for one IR node. UI Toolkit provides the canvas (draw call +
    /// input plumbing); WE provide the geometry: implicit paint (background rounded
    /// rect derived from style) and text quads from our glyph atlas.
    ///
    /// Positioned absolutely by the SDK's own layout pass — UI Toolkit's flexbox is
    /// never used (the core owns layout, cross-engine).
    /// </summary>
    public sealed class ZablooElement : VisualElement
    {
        bool _hasBackground;
        Color _background;
        float _radius;

        string _text;
        Color _textColor;
        GlyphAtlas _atlas;

        public ZablooElement()
        {
            style.position = Position.Absolute;
            generateVisualContent += OnGenerateVisualContent;
        }

        public void SetBackground(Color color, float radius)
        {
            _hasBackground = true;
            _background = color;
            _radius = radius;
            MarkDirtyRepaint();
        }

        public void ClearBackground()
        {
            _hasBackground = false;
            MarkDirtyRepaint();
        }

        public void SetText(string text, Color color, GlyphAtlas atlas)
        {
            _text = text;
            _textColor = color;
            _atlas = atlas;
            MarkDirtyRepaint();
        }

        public void SetRect(Rect local)
        {
            style.left = local.x;
            style.top = local.y;
            style.width = local.width;
            style.height = local.height;
        }

        void OnGenerateVisualContent(MeshGenerationContext mgc)
        {
            var rect = new Rect(0, 0, resolvedStyle.width, resolvedStyle.height);
            if (_hasBackground)
            {
                Tessellation.RoundedRect(mgc, rect, _radius, _background);
            }
            if (!string.IsNullOrEmpty(_text) && _atlas != null)
            {
                Tessellation.Text(mgc, _text, _atlas, _textColor);
            }
        }
    }
}
