using System;
using System.Collections.Generic;
using UnityEngine;
using Zabloo.Format;

namespace Zabloo.Layouting
{
    /// <summary>
    /// A layout-ready tree node (built by ZablooView from IR nodes).
    /// </summary>
    public sealed class LayoutNode
    {
        public Node Ir;
        public readonly List<LayoutNode> Children = new List<LayoutNode>();
        /// <summary>Preferred size from the measure pass.</summary>
        public Vector2 Measured;
        /// <summary>Final rect in view space from the arrange pass.</summary>
        public Rect Rect;
        /// <summary>Opaque slot for the renderer (the node's VisualElement).</summary>
        public object Element;
        /// <summary>Runtime interaction state owned by the SDK (Button: pressed).</summary>
        public bool Pressed;
    }

    /// <summary>
    /// The SDK's own flexbox engine — the v1 Yoga subset (direction, justify, align,
    /// gap, padding, width/height, grow), computed at runtime (decision 2026-08-01:
    /// no baked rects; the core owns layout, never the engine's layout system).
    ///
    /// Two classic passes: bottom-up measure (leaves report intrinsic size — Text
    /// measures via the glyph atlas), top-down arrange (parents place children).
    /// </summary>
    public static class FlexLayout
    {
        /// <summary>Bottom-up measure. `measureLeaf` sizes childless nodes (Text).</summary>
        public static Vector2 Measure(LayoutNode node, TokenResolver tokens, Func<Node, Vector2> measureLeaf)
        {
            var l = node.Ir.layout;
            float padding = tokens.Dim(l?.padding);
            Vector2 size;

            if (node.Children.Count == 0)
            {
                size = measureLeaf(node.Ir) + new Vector2(padding * 2, padding * 2);
            }
            else
            {
                bool row = l?.direction == "row";
                float gap = tokens.Dim(l?.gap);
                float main = 0, cross = 0;
                foreach (var child in node.Children)
                {
                    var cs = Measure(child, tokens, measureLeaf);
                    main += row ? cs.x : cs.y;
                    cross = Mathf.Max(cross, row ? cs.y : cs.x);
                }
                main += gap * (node.Children.Count - 1) + padding * 2;
                cross += padding * 2;
                size = row ? new Vector2(main, cross) : new Vector2(cross, main);
            }

            if (l?.width != null) size.x = tokens.Dim(l.width, size.x);
            if (l?.height != null) size.y = tokens.Dim(l.height, size.y);
            node.Measured = size;
            return size;
        }

        /// <summary>Top-down arrange into `rect` (view space).</summary>
        public static void Arrange(LayoutNode node, Rect rect, TokenResolver tokens)
        {
            node.Rect = rect;
            int count = node.Children.Count;
            if (count == 0) return;

            var l = node.Ir.layout;
            bool row = l?.direction == "row";
            float padding = tokens.Dim(l?.padding);
            float gap = tokens.Dim(l?.gap);
            var content = new Rect(
                rect.x + padding, rect.y + padding,
                Mathf.Max(0, rect.width - padding * 2), Mathf.Max(0, rect.height - padding * 2));

            float contentMain = row ? content.width : content.height;
            float contentCross = row ? content.height : content.width;

            // Main sizes: measured + grow share of the remaining space.
            var mains = new float[count];
            float totalMain = gap * (count - 1);
            float totalGrow = 0;
            for (int i = 0; i < count; i++)
            {
                var child = node.Children[i];
                mains[i] = row ? child.Measured.x : child.Measured.y;
                totalMain += mains[i];
                totalGrow += child.Ir.layout?.grow ?? 0;
            }
            float remaining = contentMain - totalMain;
            if (remaining > 0 && totalGrow > 0)
            {
                for (int i = 0; i < count; i++)
                {
                    float grow = node.Children[i].Ir.layout?.grow ?? 0;
                    mains[i] += remaining * (grow / totalGrow);
                }
                remaining = 0;
            }

            // Justify: distribute leftover main-axis space.
            float lead = 0, between = gap;
            float leftover = Mathf.Max(0, remaining);
            switch (l?.justify)
            {
                case "center": lead = leftover * 0.5f; break;
                case "end": lead = leftover; break;
                case "space-between":
                    if (count > 1) between = gap + leftover / (count - 1);
                    break;
            }

            float cursor = (row ? content.x : content.y) + lead;
            for (int i = 0; i < count; i++)
            {
                var child = node.Children[i];
                float crossSize = row ? child.Measured.y : child.Measured.x;
                float crossOffset = 0;
                switch (l?.align)
                {
                    case "center": crossOffset = (contentCross - crossSize) * 0.5f; break;
                    case "end": crossOffset = contentCross - crossSize; break;
                    case "stretch": crossSize = contentCross; break;
                }
                float crossPos = (row ? content.y : content.x) + crossOffset;

                var childRect = row
                    ? new Rect(cursor, crossPos, mains[i], crossSize)
                    : new Rect(crossPos, cursor, crossSize, mains[i]);
                Arrange(child, childRect, tokens);
                cursor += mains[i] + between;
            }
        }
    }
}
