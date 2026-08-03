using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Zabloo.Format
{
    /// <summary>
    /// Resolves style/layout values against the envelope's flat token dictionary
    /// (decision 2026-08-01: nodes reference "{color.primary}", the SDK does one flat
    /// lookup — buys theming + theme hot-update without re-emitting the tree).
    /// </summary>
    public sealed class TokenResolver
    {
        readonly Dictionary<string, JToken> _tokens;

        public TokenResolver(Dictionary<string, JToken> tokens)
        {
            _tokens = tokens ?? new Dictionary<string, JToken>();
        }

        /// <summary>Dimension in px: a number literal or a token reference to one.</summary>
        public float Dim(JToken value, float fallback = 0f)
        {
            var resolved = Resolve(value);
            if (resolved == null) return fallback;
            if (resolved.Type == JTokenType.Integer || resolved.Type == JTokenType.Float)
            {
                return (float)resolved;
            }
            Debug.LogWarning($"[zabloo] Expected a number, got {resolved.Type} ({resolved})");
            return fallback;
        }

        /// <summary>Color: an html literal ("#4f46e5") or a token reference to one.</summary>
        public Color Color(JToken value, Color fallback)
        {
            var resolved = Resolve(value);
            if (resolved != null && resolved.Type == JTokenType.String
                && ColorUtility.TryParseHtmlString((string)resolved, out var color))
            {
                return color;
            }
            if (resolved != null)
            {
                Debug.LogWarning($"[zabloo] Could not parse color ({resolved})");
            }
            return fallback;
        }

        /// <summary>Follows a "{token.name}" reference; passes literals through.</summary>
        JToken Resolve(JToken value)
        {
            if (value == null || value.Type != JTokenType.String) return value;
            var s = (string)value;
            if (s.Length < 3 || s[0] != '{' || s[s.Length - 1] != '}') return value;

            var key = s.Substring(1, s.Length - 2);
            if (_tokens.TryGetValue(key, out var token)) return token;
            Debug.LogWarning($"[zabloo] Unknown design token {s}");
            return null;
        }
    }
}
