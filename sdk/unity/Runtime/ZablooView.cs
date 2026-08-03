using System;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UIElements;
using Zabloo.Format;
using Zabloo.Layouting;
using Zabloo.Rendering;

namespace Zabloo
{
    /// <summary>
    /// Renders one view of an IR envelope. Wires the whole slice together:
    /// IR tree → LayoutNode tree → SDK flexbox pass → per-node ZablooElements
    /// (absolute rects, custom geometry) → Button behavior (pressed state owned by
    /// the SDK, keyed by component type) → named actions surfaced as a C# event.
    /// </summary>
    public sealed class ZablooView : VisualElement
    {
        /// <summary>Named actions declared in the IR (e.g. onClick: "buy") fire here.</summary>
        public event Action<string> OnAction;

        const int DefaultFontSize = 16;

        readonly TokenResolver _tokens;
        readonly FontLibrary _fonts = new FontLibrary();
        readonly LayoutNode _root;

        public ZablooView(Envelope envelope, string viewId)
        {
            if (!envelope.views.TryGetValue(viewId, out var rootIr))
            {
                throw new ZablooContentException(
                    $"zabloo: view \"{viewId}\" not found (available: {string.Join(", ", envelope.views.Keys)})");
            }

            _tokens = new TokenResolver(envelope.tokens);
            style.flexGrow = 1;

            CollectCharsets(rootIr);
            _root = Build(rootIr, this);

            RegisterCallback<GeometryChangedEvent>(evt => Relayout(evt.newRect.size));
        }

        // --- build ---

        LayoutNode Build(Node ir, VisualElement parentElement)
        {
            // Forward tolerance: unknown node types render as a plain container.
            if (ir.type != "Container" && ir.type != "Text" && ir.type != "Button")
            {
                Debug.LogWarning($"[zabloo] Unknown node type \"{ir.type}\" — rendering fallback container.");
            }

            var node = new LayoutNode { Ir = ir };
            var element = new ZablooElement { name = ir.id ?? ir.type };
            node.Element = element;
            parentElement.Add(element);

            ApplyStyle(node);

            if (ir.type == "Button")
            {
                WireButton(node, element);
            }

            if (ir.children != null)
            {
                foreach (var child in ir.children)
                {
                    if (IsStaticallyHidden(child)) continue; // display:none semantics
                    node.Children.Add(Build(child, element));
                }
            }
            return node;
        }

        bool IsStaticallyHidden(Node ir)
        {
            if (ir.visible == null) return false;
            if (ir.visible.Type == JTokenType.Boolean) return !(bool)ir.visible;
            Debug.LogWarning("[zabloo] `visible` bindings are not evaluated yet — defaulting to visible.");
            return false;
        }

        // --- behavior (SDK-owned, keyed by component type) ---

        void WireButton(LayoutNode node, ZablooElement element)
        {
            element.RegisterCallback<PointerDownEvent>(e =>
            {
                node.Pressed = true;
                ApplyStyle(node);
                element.CapturePointer(e.pointerId);
            });
            element.RegisterCallback<PointerUpEvent>(e =>
            {
                if (!node.Pressed) return;
                node.Pressed = false;
                ApplyStyle(node);
                element.ReleasePointer(e.pointerId);
                bool inside = element.worldBound.Contains(new Vector2(e.position.x, e.position.y));
                if (inside && !string.IsNullOrEmpty(node.Ir.onClick))
                {
                    OnAction?.Invoke(node.Ir.onClick);
                }
            });
        }

        // --- style (base + state overrides, resolved via tokens) ---

        void ApplyStyle(LayoutNode node)
        {
            var element = (ZablooElement)node.Element;
            var style = EffectiveStyle(node);

            if (style?.background != null)
            {
                element.SetBackground(
                    _tokens.Color(style.background, Color.magenta),
                    _tokens.Dim(style.radius));
            }
            else
            {
                element.ClearBackground();
            }

            if (node.Ir.type == "Text")
            {
                int size = FontSize(style);
                element.SetText(
                    ResolveText(node.Ir),
                    _tokens.Color(style?.color, Color.white),
                    _fonts.Get(size));
            }
        }

        StyleProps EffectiveStyle(LayoutNode node)
        {
            var baseStyle = node.Ir.style;
            if (node.Pressed
                && node.Ir.states != null
                && node.Ir.states.TryGetValue("pressed", out var over)
                && over?.style != null)
            {
                return Merge(baseStyle, over.style);
            }
            return baseStyle;
        }

        static StyleProps Merge(StyleProps a, StyleProps b)
        {
            return new StyleProps
            {
                background = b?.background ?? a?.background,
                radius = b?.radius ?? a?.radius,
                borderWidth = b?.borderWidth ?? a?.borderWidth,
                borderColor = b?.borderColor ?? a?.borderColor,
                color = b?.color ?? a?.color,
                fontSize = b?.fontSize ?? a?.fontSize,
                opacity = b?.opacity ?? a?.opacity,
            };
        }

        int FontSize(StyleProps style) =>
            Mathf.Max(1, Mathf.RoundToInt(_tokens.Dim(style?.fontSize, DefaultFontSize)));

        static string ResolveText(Node ir)
        {
            if (ir.text == null) return "";
            if (ir.text.Type == JTokenType.String) return (string)ir.text;
            // {"bind": "player.gold"} — data bindings land after the slice.
            Debug.LogWarning("[zabloo] Text bindings are not evaluated yet — rendering empty.");
            return "";
        }

        // --- layout (the SDK's own pass; never UI Toolkit's flexbox) ---

        void Relayout(Vector2 viewSize)
        {
            if (!(viewSize.x > 0) || !(viewSize.y > 0)) return;

            FlexLayout.Measure(_root, _tokens, MeasureLeaf);
            FlexLayout.Arrange(_root, new Rect(0, 0, viewSize.x, viewSize.y), _tokens);
            SyncRects(_root, Vector2.zero);
        }

        Vector2 MeasureLeaf(Node ir)
        {
            if (ir.type == "Text")
            {
                return _fonts.Get(FontSize(ir.style)).Measure(ResolveText(ir));
            }
            return Vector2.zero;
        }

        void SyncRects(LayoutNode node, Vector2 parentOrigin)
        {
            var element = (ZablooElement)node.Element;
            element.SetRect(new Rect(node.Rect.position - parentOrigin, node.Rect.size));
            foreach (var child in node.Children)
            {
                SyncRects(child, node.Rect.position);
            }
        }

        // --- fonts ---

        /// <summary>Accumulates per-size charsets so atlases contain what the view needs.</summary>
        void CollectCharsets(Node ir)
        {
            if (ir.type == "Text")
            {
                var text = ResolveText(ir);
                if (text.Length > 0)
                {
                    var unique = new StringBuilder();
                    foreach (char c in text)
                    {
                        if (unique.ToString().IndexOf(c) < 0) unique.Append(c);
                    }
                    _fonts.Request(FontSize(ir.style), unique.ToString());
                }
            }
            if (ir.children != null)
            {
                foreach (var child in ir.children) CollectCharsets(child);
            }
        }
    }
}
