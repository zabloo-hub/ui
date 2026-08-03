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

        enum BindingKind { Text, Visible }

        struct BoundNode
        {
            public LayoutNode Node;
            public BindingKind Kind;
        }

        readonly TokenResolver _tokens;
        readonly FontLibrary _fonts = new FontLibrary();
        readonly LayoutNode _root;
        readonly System.Collections.Generic.Dictionary<string, LayoutNode> _byId =
            new System.Collections.Generic.Dictionary<string, LayoutNode>();
        readonly System.Collections.Generic.Dictionary<string, object> _data =
            new System.Collections.Generic.Dictionary<string, object>();
        readonly System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<BoundNode>> _bindings =
            new System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<BoundNode>>();
        Vector2 _lastSize;

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
            if (ir.type != "Container" && ir.type != "Text" && ir.type != "Button" && ir.type != "Collapse")
            {
                Debug.LogWarning($"[zabloo] Unknown node type \"{ir.type}\" — rendering fallback container.");
            }

            var node = new LayoutNode { Ir = ir };
            var element = new ZablooElement { name = ir.id ?? ir.type };
            node.Element = element;
            parentElement.Add(element);
            if (!string.IsNullOrEmpty(ir.id)) _byId[ir.id] = node;

            // Data-path bindings (decision 2026-08-01: the two dynamic mechanisms).
            if (ir.type == "Text" && TryGetBind(ir.text, out var textPath))
            {
                Register(textPath, node, BindingKind.Text);
            }
            if (TryGetBind(ir.visible, out var visiblePath))
            {
                Register(visiblePath, node, BindingKind.Visible);
                node.VisibleFlag = false; // bound visibility: hidden until data says so
                SyncDisplay(node);
            }

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
                    var childNode = Build(child, element);
                    childNode.Parent = node;
                    node.Children.Add(childNode);
                }
            }

            if (ir.type == "Collapse")
            {
                WireCollapse(node); // after children exist (header = children[0])
            }
            return node;
        }

        /// <summary>Static `visible: false` prunes the subtree; bindings build normally.</summary>
        static bool IsStaticallyHidden(Node ir) =>
            ir.visible != null && ir.visible.Type == JTokenType.Boolean && !(bool)ir.visible;

        // --- data bindings (the game's data API) ---

        static bool TryGetBind(JToken token, out string path)
        {
            path = null;
            if (token is JObject obj && obj["bind"] is JToken bind && bind.Type == JTokenType.String)
            {
                path = (string)bind;
                return !string.IsNullOrEmpty(path);
            }
            return false;
        }

        void Register(string path, LayoutNode node, BindingKind kind)
        {
            if (!_bindings.TryGetValue(path, out var list))
            {
                list = new System.Collections.Generic.List<BoundNode>();
                _bindings[path] = list;
            }
            list.Add(new BoundNode { Node = node, Kind = kind });
        }

        /// <summary>
        /// The game's data entry point: pushes a value at a path ("player.gold").
        /// Bound Text re-renders (and re-measures — text width changes relayout);
        /// bound `visible` toggles display:none. One relayout per call.
        /// </summary>
        public void SetData(string path, object value)
        {
            _data[path] = value;
            if (!_bindings.TryGetValue(path, out var bound)) return;

            bool dirty = false;
            foreach (var b in bound)
            {
                if (b.Kind == BindingKind.Text)
                {
                    ApplyStyle(b.Node);
                    dirty = true;
                }
                else
                {
                    bool visible = IsTruthy(value);
                    if (b.Node.VisibleFlag != visible)
                    {
                        b.Node.VisibleFlag = visible;
                        SyncDisplay(b.Node);
                        dirty = true;
                    }
                }
            }
            if (dirty) RelayoutNow();
        }

        static bool IsTruthy(object value)
        {
            switch (value)
            {
                case null: return false;
                case bool b: return b;
                case int i: return i != 0;
                case long l: return l != 0;
                case float f: return f != 0;
                case double d: return d != 0;
                case string s: return s.Length > 0;
                default: return true;
            }
        }

        static string FormatValue(object value)
        {
            switch (value)
            {
                case null: return "";
                case bool b: return b ? "true" : "false";
                case float f: return f.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
                case double d: return d.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
                default: return value.ToString();
            }
        }

        void SyncDisplay(LayoutNode node)
        {
            ((ZablooElement)node.Element).style.display =
                node.InLayout ? DisplayStyle.Flex : DisplayStyle.None;
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

        void WireCollapse(LayoutNode node)
        {
            node.Open = node.Ir.open ?? true;
            ApplyOpen(node);
            if (node.Children.Count == 0) return;

            // The header (children[0], always visible) toggles on tap — default
            // SDK behavior, keyed by type (the <details>/<summary> model).
            var headerElement = (ZablooElement)node.Children[0].Element;
            headerElement.RegisterCallback<PointerUpEvent>(_ =>
                SetCollapseOpen(node, !node.Open));
        }

        /// <summary>
        /// The single state-mutation path for Collapse (header tap, `SetOpen`, and
        /// later `open` bindings all land here). Enforces the parent's declared
        /// group behavior, then re-runs layout — runtime relayout on state change.
        /// </summary>
        void SetCollapseOpen(LayoutNode node, bool open)
        {
            if (node.Open == open) return;
            node.Open = open;
            ApplyOpen(node);
            if (open) EnforceGroup(node);
            RelayoutNow();
        }

        /// <summary>
        /// Generic group behaviors declared on the parent Container (decision
        /// 2026-08-03: composites flatten; cross-child behavior is declared, not a
        /// type). Unknown behaviors are ignored — forward tolerance.
        /// </summary>
        void EnforceGroup(LayoutNode opened)
        {
            var parent = opened.Parent;
            var group = parent?.Ir.group;
            if (group == null) return;

            if (group != "exclusive-open")
            {
                Debug.LogWarning($"[zabloo] Unknown group behavior \"{group}\" — ignoring.");
                return;
            }

            foreach (var sibling in parent.Children)
            {
                if (sibling != opened && sibling.Ir.type == "Collapse" && sibling.Open)
                {
                    sibling.Open = false;
                    ApplyOpen(sibling);
                }
            }
        }

        /// <summary>Content children (index ≥ 1) enter/leave layout — display:none semantics.</summary>
        void ApplyOpen(LayoutNode node)
        {
            for (int i = 1; i < node.Children.Count; i++)
            {
                var child = node.Children[i];
                child.SectionShown = node.Open;
                SyncDisplay(child); // composes with a bound `visible` on the same node
            }
        }

        /// <summary>
        /// Programmatic toggle for the game (the other half of the "SDK default vs
        /// game-driven" split; `open` bindings will ride this same path later).
        /// </summary>
        public bool SetOpen(string id, bool open)
        {
            if (!_byId.TryGetValue(id, out var node) || node.Ir.type != "Collapse")
            {
                Debug.LogWarning($"[zabloo] SetOpen: no Collapse with id \"{id}\".");
                return false;
            }
            SetCollapseOpen(node, open);
            return true;
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

        string ResolveText(Node ir)
        {
            if (ir.text == null) return "";
            if (ir.text.Type == JTokenType.String) return (string)ir.text;
            if (TryGetBind(ir.text, out var path))
            {
                // Absent data renders empty until the game pushes a value.
                return _data.TryGetValue(path, out var value) ? FormatValue(value) : "";
            }
            return "";
        }

        // --- layout (the SDK's own pass; never UI Toolkit's flexbox) ---

        void Relayout(Vector2 viewSize)
        {
            if (!(viewSize.x > 0) || !(viewSize.y > 0)) return;
            _lastSize = viewSize;

            FlexLayout.Measure(_root, _tokens, MeasureLeaf);
            FlexLayout.Arrange(_root, new Rect(0, 0, viewSize.x, viewSize.y), _tokens);
            SyncRects(_root, Vector2.zero);
        }

        /// <summary>Runtime relayout at the current size (state changes, not resizes).</summary>
        void RelayoutNow() => Relayout(_lastSize);

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

        /// <summary>Printable ASCII — the default charset for bound (dynamic) text.</summary>
        static readonly string AsciiCharset = BuildAscii();

        static string BuildAscii()
        {
            var sb = new StringBuilder(95);
            for (char c = ' '; c <= '~'; c++) sb.Append(c);
            return sb.ToString();
        }

        /// <summary>
        /// Accumulates per-size charsets so atlases contain what the view needs.
        /// Bound text is dynamic, so it requests printable ASCII (non-ASCII dynamic
        /// charsets are part of the open text strategy).
        /// </summary>
        void CollectCharsets(Node ir)
        {
            if (ir.type == "Text")
            {
                int size = FontSize(ir.style);
                if (TryGetBind(ir.text, out _))
                {
                    _fonts.Request(size, AsciiCharset);
                }
                else
                {
                    var text = ResolveText(ir);
                    if (text.Length > 0)
                    {
                        var unique = new StringBuilder();
                        foreach (char c in text)
                        {
                            if (unique.ToString().IndexOf(c) < 0) unique.Append(c);
                        }
                        _fonts.Request(size, unique.ToString());
                    }
                }
            }
            if (ir.children != null)
            {
                foreach (var child in ir.children) CollectCharsets(child);
            }
        }
    }
}
