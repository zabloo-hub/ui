using System.Collections.Generic;
using System.IO;
using UnityEngine;
using Zabloo.Json;

namespace Zabloo.Tests
{
    /// <summary>
    /// The pieces of <c>golden/</c> the Unity runner reads — the files, the case
    /// list, and what a case's fields mean. The Unity spelling of
    /// <c>core/tests/corpus.h</c>: the same <c>cases.json</c>, read with the
    /// adapter's own <see cref="JsonReader"/>, so that a <c>data</c> entry reaches
    /// the core through exactly the code a game's <c>SetData</c> goes through.
    ///
    /// <c>golden/</c> is not part of the package: it sits at the repository root,
    /// three levels above <c>sdk/unity</c> and three above the playground's
    /// <c>Assets/</c>. It is found by walking up from either — from the package's
    /// resolved path in the editor, and from <c>Application.dataPath</c>
    /// everywhere, which is what a batchmode run of the playground gives. A
    /// checkout that has no <c>golden/</c> above it is reported, not skipped:
    /// <see cref="MetricCaseNames"/> then yields one sentinel case whose failure
    /// says so, because a suite with nothing to compare must never be green.
    /// </summary>
    public static class GoldenCorpus
    {
        /// <summary>The sentinel <see cref="MetricCaseNames"/> yields when the corpus is not on disk.</summary>
        public const string NotFound = "(golden/ not found above the project)";

        /// <summary>How many parents to try above a starting directory before giving up.</summary>
        const int MaxAscent = 8;

        /// <summary>One case of <c>cases.json</c>, as the runner stages it.</summary>
        public sealed class Case
        {
            public string Name;
            public string About;
            /// <summary>File under <c>golden/envelopes/</c>.</summary>
            public string Envelope;
            /// <summary>What <c>SetData</c> is given, path by path, before the settling frames. Never null.</summary>
            public Dictionary<string, object> Data = new Dictionary<string, object>();
            public double Width = 480.0;
            public double Height = 320.0;
            /// <summary>Clock run before measuring, in one jump.</summary>
            public double AdvanceMs;
            /// <summary>The pad script, each step a <c>Dictionary</c>, or null.</summary>
            public List<object> Pad;
            /// <summary>The diagnostic code this envelope must be refused with, or null for a case that measures a frame.</summary>
            public string Refuses;

            public bool IsRefusal => Refuses != null;
        }

        static string root;
        static bool located;
        static List<Case> cases;

        /// <summary>Absolute path of <c>golden/</c>, or null when it is not above this project.</summary>
        public static string Root
        {
            get
            {
                if (located) return root;
                located = true;
                root = Locate();
                return root;
            }
        }

        static string Locate()
        {
#if UNITY_EDITOR
            // In the editor the package knows where it was resolved from — for the
            // playground that is `sdk/unity` itself, referenced by path.
            var package = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(ZablooView).Assembly);
            if (package != null)
            {
                var fromPackage = Ascend(package.resolvedPath);
                if (fromPackage != null) return fromPackage;
            }
#endif
            return Ascend(Application.dataPath);
        }

        /// <summary>Walks up from <paramref name="start"/> looking for a directory holding <c>golden/cases.json</c>.</summary>
        static string Ascend(string start)
        {
            if (string.IsNullOrEmpty(start)) return null;
            var dir = new DirectoryInfo(Path.GetFullPath(start));
            for (var i = 0; i < MaxAscent && dir != null; i++, dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, "golden");
                if (File.Exists(Path.Combine(candidate, "cases.json"))) return candidate;
            }
            return null;
        }

        /// <summary>A file under <c>golden/</c>, by path relative to it. Null if it is missing.</summary>
        public static string Read(string relative)
        {
            if (Root == null) return null;
            var path = Path.Combine(Root, relative);
            // Bytes, not lines: the corpus compares bytes, and a text reader that
            // normalized line endings on the way in would hide exactly the kind of
            // difference the comparison exists to see.
            return File.Exists(path) ? File.ReadAllText(path, System.Text.Encoding.UTF8) : null;
        }

        /// <summary>Every case of <c>cases.json</c>, in the file's order. Empty when the corpus is not on disk.</summary>
        public static IReadOnlyList<Case> Cases
        {
            get
            {
                if (cases != null) return cases;
                cases = new List<Case>();
                var text = Read("cases.json");
                if (text == null) return cases;
                if (!JsonReader.TryParse(text, out var parsed) || !(parsed is Dictionary<string, object> index))
                {
                    Debug.LogError("[zabloo] golden/cases.json is not a JSON object");
                    return cases;
                }
                foreach (var entry in index)
                {
                    if (entry.Value is Dictionary<string, object> spec) cases.Add(Parse(entry.Key, spec));
                }
                return cases;
            }
        }

        /// <summary>The case with this name, or null.</summary>
        public static Case Find(string name)
        {
            foreach (var c in Cases)
            {
                if (c.Name == name) return c;
            }
            return null;
        }

        /// <summary>
        /// The names of every case that measures a frame — what the runner is
        /// parameterized over. When the corpus is missing this is the one sentinel
        /// name, so the runner still has a test to fail with the reason.
        /// </summary>
        public static IEnumerable<string> MetricCaseNames()
        {
            var any = false;
            foreach (var c in Cases)
            {
                if (c.IsRefusal) continue;
                any = true;
                yield return c.Name;
            }
            if (!any) yield return NotFound;
        }

        /// <summary>The names of every case that records a refusal.</summary>
        public static IEnumerable<string> RefusalCaseNames()
        {
            var any = false;
            foreach (var c in Cases)
            {
                if (!c.IsRefusal) continue;
                any = true;
                yield return c.Name;
            }
            if (!any) yield return NotFound;
        }

        static Case Parse(string name, Dictionary<string, object> spec)
        {
            var c = new Case { Name = name };
            if (spec.TryGetValue("about", out var about)) c.About = about as string;
            if (spec.TryGetValue("envelope", out var envelope)) c.Envelope = envelope as string;
            if (spec.TryGetValue("data", out var data) && data is Dictionary<string, object> dict) c.Data = dict;
            if (spec.TryGetValue("width", out var width)) c.Width = Number(width, c.Width);
            if (spec.TryGetValue("height", out var height)) c.Height = Number(height, c.Height);
            if (spec.TryGetValue("advanceMs", out var advance)) c.AdvanceMs = Number(advance, 0.0);
            if (spec.TryGetValue("pad", out var pad)) c.Pad = pad as List<object>;
            if (spec.TryGetValue("refuses", out var refuses) && refuses is Dictionary<string, object> r
                && r.TryGetValue("code", out var code))
            {
                c.Refuses = code as string;
            }
            return c;
        }

        /// <summary>A number as <see cref="JsonReader"/> types one — <c>long</c> or <c>double</c> — or the default.</summary>
        public static double Number(object value, double fallback)
        {
            switch (value)
            {
                case long l: return l;
                case double d: return d;
                default: return fallback;
            }
        }
    }
}
