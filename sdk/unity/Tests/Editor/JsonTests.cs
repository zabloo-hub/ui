using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using NUnit.Framework;
using Zabloo.Json;

namespace Zabloo.Tests
{
    /// <summary>
    /// The JSON writer and reader under a Spanish locale — the whole point of
    /// them: a game running on a Spanish machine must still write <c>0.5</c>, not
    /// <c>0,5</c>, and read the core's <c>0.5</c> back as one half. Every test runs
    /// with the thread's culture set to <c>es-ES</c>, so a <c>ToString()</c> or a
    /// <c>Parse</c> that forgot its culture fails here instead of in a player.
    /// </summary>
    public sealed class JsonTests
    {
        CultureInfo culture;
        CultureInfo uiCulture;

        [SetUp]
        public void SpanishLocale()
        {
            culture = Thread.CurrentThread.CurrentCulture;
            uiCulture = Thread.CurrentThread.CurrentUICulture;
            Thread.CurrentThread.CurrentCulture = new CultureInfo("es-ES");
            Thread.CurrentThread.CurrentUICulture = new CultureInfo("es-ES");
        }

        [TearDown]
        public void RestoreLocale()
        {
            Thread.CurrentThread.CurrentCulture = culture;
            Thread.CurrentThread.CurrentUICulture = uiCulture;
        }

        [Test]
        public void TheLocaleIsReallySpanish()
        {
            // The control: without a culture, .NET itself writes the comma here.
            Assert.AreEqual("0,5", (0.5).ToString());
        }

        // --- writing --------------------------------------------------------------

        [Test]
        public void NumbersAreWrittenWithoutALocale()
        {
            Assert.AreEqual("0.5", JsonWriter.Write(0.5));
            Assert.AreEqual("0.1", JsonWriter.Write(0.1f));
            Assert.AreEqual("1200", JsonWriter.Write(1200));
            Assert.AreEqual("1200", JsonWriter.Write(1200.0));
            Assert.AreEqual("-3", JsonWriter.Write(-3L));
            Assert.AreEqual("1E+21", JsonWriter.Write(1e21));
            Assert.AreEqual("2.5", JsonWriter.Write(2.5m));
        }

        [Test]
        public void ScalarsAndNull()
        {
            Assert.AreEqual("null", JsonWriter.Write(null));
            Assert.AreEqual("true", JsonWriter.Write(true));
            Assert.AreEqual("false", JsonWriter.Write(false));
            Assert.AreEqual("\"Sergi\"", JsonWriter.Write("Sergi"));
            Assert.AreEqual("\"x\"", JsonWriter.Write('x'));
        }

        [Test]
        public void StringsEscapeOnlyWhatTheGrammarRequires()
        {
            Assert.AreEqual("\"a \\\"quote\\\" and a \\\\ slash\"", JsonWriter.Write("a \"quote\" and a \\ slash"));
            Assert.AreEqual("\"line\\nbreak\\ttab\\u0001\"", JsonWriter.Write("line\nbreak\ttab\u0001"));
            // Emoji and accents go through as they are: the core reads UTF-8.
            Assert.AreEqual("\"café 😀\"", JsonWriter.Write("café 😀"));
        }

        [Test]
        public void ListsArraysAndDictionaries()
        {
            var items = new List<Dictionary<string, object>>
            {
                new Dictionary<string, object> { { "id", "sword-01" }, { "price", 120 }, { "enabled", true } },
                new Dictionary<string, object> { { "id", "shield" }, { "price", 0.5 }, { "tags", new[] { "a", "b" } } },
            };
            Assert.AreEqual(
                "[{\"id\":\"sword-01\",\"price\":120,\"enabled\":true},{\"id\":\"shield\",\"price\":0.5,\"tags\":[\"a\",\"b\"]}]",
                JsonWriter.Write(items));
            Assert.AreEqual("[[1,2],[3,[4]]]", JsonWriter.Write(new object[] { new[] { 1, 2 }, new object[] { 3, new[] { 4 } } }));
            Assert.AreEqual("[]", JsonWriter.Write(new List<object>()));
            Assert.AreEqual("{}", JsonWriter.Write(new Dictionary<string, object>()));
            // A typed dictionary is a dictionary too.
            Assert.AreEqual("{\"gold\":1200}", JsonWriter.Write(new Dictionary<string, int> { { "gold", 1200 } }));
        }

        [Test]
        public void WhatJsonCannotCarryIsRefusedLoudly()
        {
            Assert.Throws<System.ArgumentException>(() => JsonWriter.Write(double.NaN));
            Assert.Throws<System.ArgumentException>(() => JsonWriter.Write(float.PositiveInfinity));
            Assert.Throws<System.ArgumentException>(() => JsonWriter.Write(new object()));
            Assert.Throws<System.ArgumentException>(() => JsonWriter.Write(new Dictionary<int, string> { { 1, "one" } }));
        }

        // --- reading --------------------------------------------------------------

        [Test]
        public void NumbersAreReadWithoutALocaleAndTypedByShape()
        {
            Assert.IsTrue(JsonReader.TryParse("0.5", out var half));
            Assert.AreEqual(0.5, half);
            Assert.IsInstanceOf<double>(half);

            Assert.IsTrue(JsonReader.TryParse("1200", out var gold));
            Assert.AreEqual(1200L, gold);
            Assert.IsInstanceOf<long>(gold);

            Assert.IsTrue(JsonReader.TryParse("-0", out var negativeZero));
            Assert.AreEqual(0L, negativeZero);

            Assert.IsTrue(JsonReader.TryParse("1e21", out var big));
            Assert.AreEqual(1e21, big);
            Assert.IsInstanceOf<double>(big);

            // Too wide for a long: still a number, as a double.
            Assert.IsTrue(JsonReader.TryParse("99999999999999999999", out var wide));
            Assert.IsInstanceOf<double>(wide);
        }

        [Test]
        public void ScalarsAndNullAreRead()
        {
            Assert.IsTrue(JsonReader.TryParse("true", out var t));
            Assert.AreEqual(true, t);
            Assert.IsTrue(JsonReader.TryParse(" false ", out var f));
            Assert.AreEqual(false, f);
            Assert.IsTrue(JsonReader.TryParse("null", out var n));
            Assert.IsNull(n);
            Assert.IsTrue(JsonReader.TryParse("\"Sergi\"", out var s));
            Assert.AreEqual("Sergi", s);
        }

        [Test]
        public void StringsUnescapeIncludingSurrogatePairs()
        {
            Assert.IsTrue(JsonReader.TryParse("\"a \\\"quote\\\" \\\\ \\/ \\n\\t\\u00e9\"", out var s));
            Assert.AreEqual("a \"quote\" \\ / \n\té", s);
            // The emoji escaped as a surrogate pair, and raw.
            Assert.IsTrue(JsonReader.TryParse("\"\\ud83d\\ude00\"", out var escaped));
            Assert.AreEqual("😀", escaped);
            Assert.IsTrue(JsonReader.TryParse("\"café 😀\"", out var raw));
            Assert.AreEqual("café 😀", raw);
        }

        [Test]
        public void ArraysAndObjectsNest()
        {
            Assert.IsTrue(JsonReader.TryParse("{\"items\":[{\"name\":\"Sword\",\"price\":120},{\"name\":\"Shield\",\"tags\":[[1],[2,3]]}],\"empty\":{}}", out var value));
            var root = (Dictionary<string, object>)value;
            var items = (List<object>)root["items"];
            Assert.AreEqual(2, items.Count);
            Assert.AreEqual("Sword", ((Dictionary<string, object>)items[0])["name"]);
            Assert.AreEqual(120L, ((Dictionary<string, object>)items[0])["price"]);
            var tags = (List<object>)((Dictionary<string, object>)items[1])["tags"];
            Assert.AreEqual(3L, ((List<object>)tags[1])[1]);
            Assert.AreEqual(0, ((Dictionary<string, object>)root["empty"]).Count);
        }

        [Test]
        public void WhatIsNotJsonAnswersFalseAndNeverThrows()
        {
            foreach (var bad in new[] { "", "   ", "{", "[1,", "{\"a\":}", "tru", "01", "1.", "-", "\"open", "\"ctrl\u0001\"", "\"\\x\"", "1 2", "{\"a\":1,}", "[1,]", "{a:1}", "nul", "\"\\u12\"" })
            {
                Assert.IsFalse(JsonReader.TryParse(bad, out var value), "should refuse: " + bad);
                Assert.IsNull(value);
            }
            Assert.IsFalse(JsonReader.TryParse(null, out _));
        }

        [Test]
        public void ADeepNestIsRefusedInsteadOfOverflowing()
        {
            var deep = new string('[', 300) + new string(']', 300);
            Assert.IsFalse(JsonReader.TryParse(deep, out _));
            var fine = new string('[', 200) + new string(']', 200);
            Assert.IsTrue(JsonReader.TryParse(fine, out _));
        }

        [Test]
        public void WriteThenReadRoundTrips()
        {
            var value = new Dictionary<string, object>
            {
                { "gold", 1200 },
                { "volume", 0.5 },
                { "name", "Sergi 😀 \"the\" \\ one" },
                { "items", new List<object> { 1, 2.5, "x", null, true, new List<object> { new Dictionary<string, object> { { "k", "v" } } } } },
            };
            Assert.IsTrue(JsonReader.TryParse(JsonWriter.Write(value), out var back));
            var root = (Dictionary<string, object>)back;
            Assert.AreEqual(1200L, root["gold"]);
            Assert.AreEqual(0.5, root["volume"]);
            Assert.AreEqual("Sergi 😀 \"the\" \\ one", root["name"]);
            var items = (List<object>)root["items"];
            Assert.AreEqual(1L, items[0]);
            Assert.AreEqual(2.5, items[1]);
            Assert.AreEqual("x", items[2]);
            Assert.IsNull(items[3]);
            Assert.AreEqual(true, items[4]);
            Assert.AreEqual("v", ((Dictionary<string, object>)((List<object>)items[5])[0])["k"]);
            // And writing it again gives the same bytes: the pair is stable.
            Assert.AreEqual(JsonWriter.Write(value), JsonWriter.Write(back));
        }
    }
}
