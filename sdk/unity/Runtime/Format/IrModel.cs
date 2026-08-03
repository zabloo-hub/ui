using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace Zabloo.Format
{
    /// <summary>
    /// C# model of the zabloo IR envelope (see @zabloo/format). Deserialized with
    /// Newtonsoft.Json, which ignores unknown properties by default — that IS the
    /// forward-tolerance rule (SDKs ignore unknown props).
    ///
    /// Values that can be a literal OR a token reference ("{color.primary}") OR a
    /// binding ({"bind": "player.gold"}) are kept as <see cref="JToken"/> and
    /// resolved at use site via <see cref="TokenResolver"/>.
    /// </summary>
    public sealed class Envelope
    {
        public int v;
        public Dictionary<string, JToken> tokens = new Dictionary<string, JToken>();
        public Dictionary<string, Node> views = new Dictionary<string, Node>();
    }

    public sealed class Node
    {
        public string type;
        public string id;

        /// <summary>Single hiding mechanism — display:none semantics (bool or binding).</summary>
        public JToken visible;

        public LayoutProps layout;
        public StyleProps style;

        /// <summary>Per-state style overrides; the SDK owns runtime state, keyed by type.</summary>
        public Dictionary<string, StateOverride> states;

        public List<Node> children;

        // Button
        /// <summary>Named action, exposed as a C# event by the SDK.</summary>
        public string onClick;

        // Text
        /// <summary>Static string or a data-path binding.</summary>
        public JToken text;
    }

    /// <summary>v1 Yoga subset: direction, justify, align, gap, padding, width/height, grow.</summary>
    public sealed class LayoutProps
    {
        public string direction; // "row" | "column"
        public string justify; // "start" | "center" | "end" | "space-between"
        public string align; // "start" | "center" | "end" | "stretch"
        public JToken gap;
        public JToken padding;
        public JToken width;
        public JToken height;
        public float? grow;
    }

    /// <summary>
    /// Resolved per-node style. Paint is implicit: background/radius/borderWidth imply
    /// the rounded-rect fill/stroke the tessellator derives (decision 2026-08-01).
    /// </summary>
    public sealed class StyleProps
    {
        public JToken background;
        public JToken radius;
        public JToken borderWidth;
        public JToken borderColor;
        public JToken color;
        public JToken fontSize;
        public float? opacity;
    }

    public sealed class StateOverride
    {
        public StyleProps style;
    }
}
