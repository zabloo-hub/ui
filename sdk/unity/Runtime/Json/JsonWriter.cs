using System;
using System.Collections;
using System.Globalization;
using System.Text;

namespace Zabloo.Json
{
    /// <summary>
    /// Writes a C# value as JSON text — the shape the core's data channel speaks
    /// (<c>zb_document_set_data_json</c>). Two hundred lines instead of a
    /// dependency: <c>JsonUtility</c> cannot serialize <c>object</c> or a
    /// dictionary, and Newtonsoft is a package for what fits in a file.
    ///
    /// What it takes: <c>null</c>, <c>bool</c>, every integer primitive,
    /// <c>float</c>/<c>double</c>/<c>decimal</c>, <c>string</c>, <c>char</c>, any
    /// <c>IDictionary</c> whose keys are strings (<c>Dictionary&lt;string, object&gt;</c>,
    /// <c>Dictionary&lt;string, int&gt;</c>, a <c>Hashtable</c>…) and any
    /// <c>IEnumerable</c> (arrays, <c>List&lt;T&gt;</c>…). Anything else is an
    /// <see cref="ArgumentException"/> — a game object is not a value, and
    /// guessing at one would push the wrong thing in silence.
    ///
    /// Numbers are written with <see cref="CultureInfo.InvariantCulture"/>,
    /// ALWAYS. It is the <c>printf</c>-under-a-locale hole the core plugged
    /// twice (G2, G3) in its C# spelling: a game running on a Spanish machine
    /// would otherwise write <c>0,5</c>, the core would refuse the payload, and
    /// nothing downstream would say why. Doubles use the shortest round-trip
    /// form, so <c>1200</c> stays <c>1200</c> and <c>0.1f</c> stays <c>0.1</c>.
    /// </summary>
    public static class JsonWriter
    {
        /// <summary>Nested containers deeper than this are refused: a cycle is not a value either.</summary>
        const int MaxDepth = 256;

        /// <summary>The JSON text for <paramref name="value"/>. Throws <see cref="ArgumentException"/> for a value JSON cannot carry.</summary>
        public static string Write(object value)
        {
            var sb = new StringBuilder();
            Append(sb, value, 0);
            return sb.ToString();
        }

        static void Append(StringBuilder sb, object value, int depth)
        {
            switch (value)
            {
                case null:
                    sb.Append("null");
                    return;
                case bool b:
                    sb.Append(b ? "true" : "false");
                    return;
                case string s:
                    AppendString(sb, s);
                    return;
                case char c:
                    AppendString(sb, c.ToString());
                    return;
                case double d:
                    AppendDouble(sb, d);
                    return;
                case float f:
                    // Through the float's own shortest form: widening 0.1f to double
                    // would write 0.10000000149011612, which is true and useless.
                    if (float.IsNaN(f) || float.IsInfinity(f)) throw NotJson("a NaN or infinite float");
                    sb.Append(f.ToString("R", CultureInfo.InvariantCulture));
                    return;
                case decimal m:
                    sb.Append(m.ToString(CultureInfo.InvariantCulture));
                    return;
                case int i:
                    sb.Append(i.ToString(CultureInfo.InvariantCulture));
                    return;
                case long l:
                    sb.Append(l.ToString(CultureInfo.InvariantCulture));
                    return;
                case short sh:
                    sb.Append(sh.ToString(CultureInfo.InvariantCulture));
                    return;
                case byte by:
                    sb.Append(by.ToString(CultureInfo.InvariantCulture));
                    return;
                case sbyte sb8:
                    sb.Append(sb8.ToString(CultureInfo.InvariantCulture));
                    return;
                case ushort us:
                    sb.Append(us.ToString(CultureInfo.InvariantCulture));
                    return;
                case uint ui:
                    sb.Append(ui.ToString(CultureInfo.InvariantCulture));
                    return;
                case ulong ul:
                    sb.Append(ul.ToString(CultureInfo.InvariantCulture));
                    return;
                case IDictionary dictionary:
                    AppendObject(sb, dictionary, depth);
                    return;
                case IEnumerable enumerable:
                    AppendArray(sb, enumerable, depth);
                    return;
                default:
                    throw NotJson("a " + value.GetType().FullName);
            }
        }

        static void AppendDouble(StringBuilder sb, double d)
        {
            // JSON has no spelling for these, and writing `null` would turn a bug
            // in the game into a value the UI quietly shows as empty.
            if (double.IsNaN(d) || double.IsInfinity(d)) throw NotJson("a NaN or infinite double");
            sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
        }

        static void AppendObject(StringBuilder sb, IDictionary dictionary, int depth)
        {
            if (depth >= MaxDepth) throw NotJson("a value nested deeper than " + MaxDepth + " levels");
            sb.Append('{');
            var first = true;
            foreach (DictionaryEntry entry in dictionary)
            {
                if (!(entry.Key is string key))
                {
                    throw NotJson("a dictionary keyed by " + (entry.Key == null ? "null" : entry.Key.GetType().FullName) + " (keys must be strings)");
                }
                if (!first) sb.Append(',');
                first = false;
                AppendString(sb, key);
                sb.Append(':');
                Append(sb, entry.Value, depth + 1);
            }
            sb.Append('}');
        }

        static void AppendArray(StringBuilder sb, IEnumerable enumerable, int depth)
        {
            if (depth >= MaxDepth) throw NotJson("a value nested deeper than " + MaxDepth + " levels");
            sb.Append('[');
            var first = true;
            foreach (var item in enumerable)
            {
                if (!first) sb.Append(',');
                first = false;
                Append(sb, item, depth + 1);
            }
            sb.Append(']');
        }

        /// <summary>
        /// A JSON string literal. Only what the grammar requires is escaped — the
        /// quote, the backslash and the control characters — and everything else,
        /// emoji included, goes through as UTF-8, which is what the core reads.
        /// </summary>
        static void AppendString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20)
                        {
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
        }

        static ArgumentException NotJson(string what)
        {
            return new ArgumentException("JSON cannot carry " + what);
        }
    }
}
