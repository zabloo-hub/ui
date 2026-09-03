using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Zabloo.Json
{
    /// <summary>
    /// Reads JSON text into plain C# values — the other half of
    /// <see cref="JsonWriter"/>, for what the core hands back
    /// (<c>zb_data_change.value_json</c>). It never throws: a text that is not
    /// JSON answers <c>false</c>, and the caller decides what a malformed value
    /// costs.
    ///
    /// What comes out: <c>null</c>, <c>bool</c>, <c>string</c>,
    /// <c>List&lt;object&gt;</c> for an array, <c>Dictionary&lt;string, object&gt;</c>
    /// for an object, and for a number a <c>long</c> when the literal is an
    /// integer that fits one (<c>1200</c>) and a <c>double</c> otherwise
    /// (<c>0.35</c>, <c>1e21</c>). JSON has one number type and C# has many; the
    /// split is the one a game reaches for first — <c>(long)value</c> for a count,
    /// <c>(double)value</c> for a fraction — and <c>Convert.ToInt32(value)</c>
    /// works on either.
    ///
    /// Strings are unescaped fully, <c>\uXXXX</c> included: a surrogate pair
    /// (<c>😀</c>) lands as the two UTF-16 units C# already uses for
    /// that emoji, so nothing is lost on the way through.
    /// </summary>
    public static class JsonReader
    {
        /// <summary>Nesting deeper than this is refused, the same cap the core's own reader applies.</summary>
        const int MaxDepth = 256;

        /// <summary>Parses <paramref name="json"/>. <c>true</c> with the value, or <c>false</c> with <c>null</c> when it is not JSON.</summary>
        public static bool TryParse(string json, out object value)
        {
            value = null;
            if (json == null) return false;
            var reader = new Reader(json);
            reader.SkipWhitespace();
            if (!reader.ReadValue(0, out value)) return Fail(out value);
            reader.SkipWhitespace();
            // Trailing content is not "the value and some more": it is not JSON.
            return reader.AtEnd || Fail(out value);
        }

        static bool Fail(out object value)
        {
            value = null;
            return false;
        }

        struct Reader
        {
            readonly string text;
            int at;

            public Reader(string text)
            {
                this.text = text;
                at = 0;
            }

            public bool AtEnd => at >= text.Length;

            public void SkipWhitespace()
            {
                while (at < text.Length)
                {
                    var c = text[at];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') at++;
                    else break;
                }
            }

            public bool ReadValue(int depth, out object value)
            {
                value = null;
                if (AtEnd) return false;
                switch (text[at])
                {
                    case '{': return ReadObject(depth, out value);
                    case '[': return ReadArray(depth, out value);
                    case '"':
                        if (!ReadString(out var s)) return false;
                        value = s;
                        return true;
                    case 't':
                        if (!ReadLiteral("true")) return false;
                        value = true;
                        return true;
                    case 'f':
                        if (!ReadLiteral("false")) return false;
                        value = false;
                        return true;
                    case 'n':
                        return ReadLiteral("null");
                    default:
                        return ReadNumber(out value);
                }
            }

            bool ReadLiteral(string literal)
            {
                if (string.CompareOrdinal(text, at, literal, 0, literal.Length) != 0) return false;
                at += literal.Length;
                return true;
            }

            bool ReadObject(int depth, out object value)
            {
                value = null;
                if (depth >= MaxDepth) return false;
                at++; // {
                var result = new Dictionary<string, object>();
                SkipWhitespace();
                if (Peek('}'))
                {
                    at++;
                    value = result;
                    return true;
                }
                while (true)
                {
                    SkipWhitespace();
                    if (!Peek('"') || !ReadString(out var key)) return false;
                    SkipWhitespace();
                    if (!Peek(':')) return false;
                    at++;
                    SkipWhitespace();
                    if (!ReadValue(depth + 1, out var item)) return false;
                    result[key] = item;
                    SkipWhitespace();
                    if (Peek(','))
                    {
                        at++;
                        continue;
                    }
                    if (Peek('}'))
                    {
                        at++;
                        value = result;
                        return true;
                    }
                    return false;
                }
            }

            bool ReadArray(int depth, out object value)
            {
                value = null;
                if (depth >= MaxDepth) return false;
                at++; // [
                var result = new List<object>();
                SkipWhitespace();
                if (Peek(']'))
                {
                    at++;
                    value = result;
                    return true;
                }
                while (true)
                {
                    SkipWhitespace();
                    if (!ReadValue(depth + 1, out var item)) return false;
                    result.Add(item);
                    SkipWhitespace();
                    if (Peek(','))
                    {
                        at++;
                        continue;
                    }
                    if (Peek(']'))
                    {
                        at++;
                        value = result;
                        return true;
                    }
                    return false;
                }
            }

            bool Peek(char c)
            {
                return at < text.Length && text[at] == c;
            }

            bool ReadString(out string value)
            {
                value = null;
                at++; // the opening quote
                StringBuilder sb = null;
                var start = at;
                while (at < text.Length)
                {
                    var c = text[at];
                    if (c == '"')
                    {
                        value = sb == null ? text.Substring(start, at - start) : sb.Append(text, start, at - start).ToString();
                        at++;
                        return true;
                    }
                    if (c < 0x20) return false; // a raw control character is not allowed inside a string
                    if (c != '\\')
                    {
                        at++;
                        continue;
                    }
                    // An escape: flush the plain run, then decode it.
                    if (sb == null) sb = new StringBuilder();
                    sb.Append(text, start, at - start);
                    at++;
                    if (at >= text.Length) return false;
                    switch (text[at])
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (at + 4 >= text.Length) return false;
                            if (!int.TryParse(text.Substring(at + 1, 4), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out var code)) return false;
                            sb.Append((char)code);
                            at += 4;
                            break;
                        default:
                            return false;
                    }
                    at++;
                    start = at;
                }
                return false; // ran out before the closing quote
            }

            bool ReadNumber(out object value)
            {
                value = null;
                var start = at;
                var integral = true;
                if (Peek('-')) at++;
                if (at >= text.Length) return false;
                if (text[at] == '0')
                {
                    at++;
                }
                else if (text[at] >= '1' && text[at] <= '9')
                {
                    while (at < text.Length && text[at] >= '0' && text[at] <= '9') at++;
                }
                else
                {
                    return false;
                }
                if (Peek('.'))
                {
                    integral = false;
                    at++;
                    var digits = at;
                    while (at < text.Length && text[at] >= '0' && text[at] <= '9') at++;
                    if (at == digits) return false;
                }
                if (Peek('e') || Peek('E'))
                {
                    integral = false;
                    at++;
                    if (Peek('+') || Peek('-')) at++;
                    var digits = at;
                    while (at < text.Length && text[at] >= '0' && text[at] <= '9') at++;
                    if (at == digits) return false;
                }
                var literal = text.Substring(start, at - start);
                if (integral && long.TryParse(literal, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var l))
                {
                    value = l;
                    return true;
                }
                if (!double.TryParse(literal, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) return false;
                value = d;
                return true;
            }
        }
    }
}
