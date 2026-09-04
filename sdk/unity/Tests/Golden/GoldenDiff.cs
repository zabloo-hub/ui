using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Zabloo.Json;

namespace Zabloo.Tests
{
    /// <summary>
    /// The readable half of the golden harness: what a case prints when it does
    /// not reproduce its record. A port of <c>describe</c> in
    /// <c>core/tests/test_golden.cpp</c>, so that a failure reads the same on the
    /// three targets — the path inside the snapshot, the <c>ref</c> of the node an
    /// author wrote, and both values:
    ///
    /// <code>
    /// flex-layout does not reproduce golden/metrics/flex-layout.json
    ///     tree.children[1].rect.width (ref "row-gap"): expected 128, actual 132
    /// </code>
    ///
    /// The comparison itself is of BYTES and lives in the runner; this only
    /// explains a mismatch. So when the walk finds no difference and the bytes
    /// still differ — key order, how a number was written — it says that, rather
    /// than printing nothing: it is the one case where the diff has to explain
    /// itself.
    /// </summary>
    public static class GoldenDiff
    {
        /// <summary>Differences printed before a diff starts repeating itself.</summary>
        public const int MaxDiffs = 20;

        /// <summary>The report for a case whose snapshot is not its record.</summary>
        public static string Describe(string name, string expectedText, string actualText)
        {
            var sb = new StringBuilder();
            sb.Append(name).Append(" does not reproduce golden/metrics/").Append(name).Append(".json");
            if (!JsonReader.TryParse(expectedText, out var expected))
            {
                return sb.Append("\n    the recorded file is not valid JSON").ToString();
            }
            if (!JsonReader.TryParse(actualText, out var actual))
            {
                return sb.Append("\n    the snapshot is not valid JSON").ToString();
            }

            var differences = new List<string>();
            Diff(expected, actual, "", "", differences);
            if (differences.Count == 0)
            {
                sb.Append("\n    the values match but the bytes do not — key order or number formatting");
                return sb.ToString();
            }
            foreach (var difference in differences) sb.Append("\n    ").Append(difference);
            if (differences.Count >= MaxDiffs) sb.Append("\n    … and possibly more");
            return sb.ToString();
        }

        // --- the walk --------------------------------------------------------------

        enum Kind
        {
            Null,
            Bool,
            Number,
            String,
            Array,
            Object,
        }

        static Kind KindOf(object value)
        {
            switch (value)
            {
                case null: return Kind.Null;
                case bool _: return Kind.Bool;
                case long _: return Kind.Number;
                case double _: return Kind.Number;
                case string _: return Kind.String;
                case List<object> _: return Kind.Array;
                case Dictionary<string, object> _: return Kind.Object;
                default: return Kind.Null;
            }
        }

        /// <summary>A value as a diff line prints it. <paramref name="present"/> is false for a key that is not there at all.</summary>
        static string Show(object value, bool present)
        {
            if (!present) return "(absent)";
            switch (value)
            {
                case null: return "null";
                case bool b: return b ? "true" : "false";
                case long l: return FormatNumber(l);
                case double d: return FormatNumber(d);
                case string s: return "\"" + s + "\"";
                case List<object> a: return "(array of " + a.Count + ")";
                case Dictionary<string, object> _: return "(object)";
                default: return "(?)";
            }
        }

        /// <summary><c>tree.children[0].rect</c> — the root's own members carry no leading dot.</summary>
        static string Join(string path, string key)
        {
            return path.Length == 0 ? key : path + "." + key;
        }

        /// <summary>The node this path is inside, so a difference names something an author wrote.</summary>
        static string RefSuffix(string reference)
        {
            return reference.Length == 0 ? "" : " (ref \"" + reference + "\")";
        }

        static void Diff(object expected, bool expectedPresent, object actual, bool actualPresent, string path,
            string reference, List<string> output)
        {
            if (output.Count >= MaxDiffs) return;
            if (!expectedPresent || !actualPresent || KindOf(expected) != KindOf(actual))
            {
                if (expectedPresent || actualPresent)
                {
                    output.Add(path + RefSuffix(reference) + ": expected " + Show(expected, expectedPresent) + ", actual "
                        + Show(actual, actualPresent));
                }
                return;
            }
            switch (KindOf(expected))
            {
                case Kind.Object:
                    DiffObject((Dictionary<string, object>)expected, (Dictionary<string, object>)actual, path, reference, output);
                    return;
                case Kind.Array:
                    DiffArray((List<object>)expected, (List<object>)actual, path, reference, output);
                    return;
                case Kind.Number:
                    if (FormatNumber(ToDouble(expected)) != FormatNumber(ToDouble(actual)))
                    {
                        output.Add(path + RefSuffix(reference) + ": expected " + Show(expected, true) + ", actual "
                            + Show(actual, true));
                    }
                    return;
                case Kind.String:
                    if ((string)expected != (string)actual)
                    {
                        output.Add(path + RefSuffix(reference) + ": expected " + Show(expected, true) + ", actual "
                            + Show(actual, true));
                    }
                    return;
                case Kind.Bool:
                    if ((bool)expected != (bool)actual)
                    {
                        output.Add(path + RefSuffix(reference) + ": expected " + Show(expected, true) + ", actual "
                            + Show(actual, true));
                    }
                    return;
                default:
                    return;
            }
        }

        static void Diff(object expected, object actual, string path, string reference, List<string> output)
        {
            Diff(expected, true, actual, true, path, reference, output);
        }

        static void DiffObject(Dictionary<string, object> expected, Dictionary<string, object> actual, string path,
            string reference, List<string> output)
        {
            // A node's own `ref` takes over for everything below it — that is the
            // address the corpus is read by, and the one a fix is looked up under.
            var here = expected.TryGetValue("ref", out var r) && r is string s ? s : reference;
            foreach (var entry in expected)
            {
                if (output.Count >= MaxDiffs) return;
                var present = actual.TryGetValue(entry.Key, out var other);
                Diff(entry.Value, true, other, present, Join(path, entry.Key), here, output);
            }
            foreach (var entry in actual)
            {
                if (output.Count >= MaxDiffs) return;
                if (expected.ContainsKey(entry.Key)) continue;
                output.Add(Join(path, entry.Key) + RefSuffix(here) + ": expected (absent), actual " + Show(entry.Value, true));
            }
        }

        static void DiffArray(List<object> expected, List<object> actual, string path, string reference,
            List<string> output)
        {
            if (expected.Count != actual.Count)
            {
                output.Add(path + RefSuffix(reference) + ": expected " + expected.Count + " entries, actual " + actual.Count);
            }
            var shared = Math.Min(expected.Count, actual.Count);
            for (var i = 0; i < shared && output.Count < MaxDiffs; i++)
            {
                Diff(expected[i], actual[i], path + "[" + i + "]", reference, output);
            }
        }

        static double ToDouble(object number)
        {
            return number is long l ? l : (double)number;
        }

        // --- numbers ----------------------------------------------------------------

        /// <summary>
        /// A number the way a golden file spells it — <c>snapshot_number</c> in
        /// <c>core/src/snapshot.cpp</c>: three decimals, from the quantized integer,
        /// trailing zeros dropped, <c>-0</c> as <c>0</c>, non-finite as <c>null</c>.
        /// Written by hand and never with a culture: a Spanish machine would
        /// otherwise print <c>0,5</c> where the file says <c>0.5</c>, and a diff
        /// that spells a number differently from the file sends the reader to the
        /// wrong place.
        /// </summary>
        public static string FormatNumber(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return "null";
            if (Math.Abs(value) >= 9.0e15) return value.ToString("F0", CultureInfo.InvariantCulture);

            // llround: half away from zero.
            var units = (long)Math.Round(value * 1000.0, MidpointRounding.AwayFromZero);
            if (units == 0) return "0";

            var negative = units < 0;
            var magnitude = negative ? (ulong)(-(units + 1)) + 1UL : (ulong)units;
            var text = (magnitude / 1000UL).ToString(CultureInfo.InvariantCulture);
            var fraction = magnitude % 1000UL;
            if (fraction != 0)
            {
                var digits = new StringBuilder(4);
                digits.Append((char)('0' + fraction / 100));
                digits.Append((char)('0' + (fraction / 10) % 10));
                digits.Append((char)('0' + fraction % 10));
                while (digits[digits.Length - 1] == '0') digits.Length--;
                text += "." + digits;
            }
            return negative ? "-" + text : text;
        }
    }
}
