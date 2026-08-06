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
        float _borderWidth;
        Color _borderColor;
        float _opacity = 1f;

        string _text;
        Color _textColor;
        GlyphAtlas _atlas;

        public ZablooElement()
        {
            style.position = Position.Absolute;
            generateVisualContent += OnGenerateVisualContent;
        }

        /// <summary>
        /// The node's implicit paint in one call: background fill, inset border, and
        /// the subtree-inherited opacity product (multiplied into every vertex alpha).
        /// </summary>
        public void SetPaint(
            bool hasBackground, Color background, float radius,
            float borderWidth, Color borderColor, float opacity)
        {
            _hasBackground = hasBackground;
            _background = background;
            _radius = radius;
            _borderWidth = borderWidth;
            _borderColor = borderColor;
            _opacity = opacity;
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
            if (_opacity <= 0f) return; // invisible — but still occupies layout
            var rect = new Rect(0, 0, resolvedStyle.width, resolvedStyle.height);
            if (_hasBackground)
            {
                Tessellation.RoundedRect(mgc, rect, _radius, Fade(_background));
            }
            if (_borderWidth > 0f)
            {
                Tessellation.RoundedRectBorder(mgc, rect, _radius, _borderWidth, Fade(_borderColor));
            }
            if (!string.IsNullOrEmpty(_text) && _atlas != null)
            {
                Tessellation.Text(mgc, _text, _atlas, Fade(_textColor));
            }
        }

        Color Fade(Color color) =>
            _opacity >= 1f ? color : new Color(color.r, color.g, color.b, color.a * _opacity);
    }
}
