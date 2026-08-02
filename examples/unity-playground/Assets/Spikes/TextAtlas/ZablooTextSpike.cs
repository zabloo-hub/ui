using System.Linq;
using UnityEngine;
using UnityEngine.UIElements;

namespace Zabloo.Spikes
{
    /// <summary>
    /// SPIKE bootstrap — attach next to a UIDocument (or use the
    /// "Zabloo → Set Up Text Spike Scene" menu). On play: builds the glyph atlas,
    /// renders the text with our own geometry, and shows the raw atlas for debugging.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public class ZablooTextSpike : MonoBehaviour
    {
        [SerializeField] string _text = "Comprar";
        [SerializeField] int _pointSize = 48;
        [SerializeField] Color _color = Color.white;
        [SerializeField] bool _showAtlasDebug = true;

        void OnEnable()
        {
            // Unity's built-in fallback font (Arial-metric). Spike-only — real content
            // will ship its own fonts.
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

            var atlas = new ZablooGlyphAtlas();
            string charset = new string(_text.Distinct().ToArray());
            if (!atlas.Build(font, _pointSize, charset))
                return;

            var root = GetComponent<UIDocument>().rootVisualElement;
            root.style.flexGrow = 1;
            root.style.justifyContent = Justify.Center;
            root.style.alignItems = Align.Center;
            root.style.backgroundColor = new Color(0.10f, 0.11f, 0.15f);

            root.Add(new ZablooTextSpikeElement(atlas, _text, _color));

            if (_showAtlasDebug)
            {
                // Raw atlas in the corner — verifies rasterization/packing visually.
                var debug = new Image
                {
                    image = atlas.Texture,
                    style =
                    {
                        position = Position.Absolute,
                        left = 8, bottom = 8, width = 256, height = 256,
                        borderTopWidth = 1, borderBottomWidth = 1,
                        borderLeftWidth = 1, borderRightWidth = 1,
                        borderTopColor = Color.gray, borderBottomColor = Color.gray,
                        borderLeftColor = Color.gray, borderRightColor = Color.gray,
                    },
                };
                root.Add(debug);
            }

            Debug.Log($"[zabloo spike] Atlas built: {charset.Length} glyphs @ {_pointSize}px. " +
                      $"Measure(\"{_text}\") = {atlas.Measure(_text)}");
        }
    }
}
