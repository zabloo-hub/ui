using System.Collections.Generic;
using NUnit.Framework;
using Zabloo.Editor;
using Zabloo.Json;

namespace Zabloo.Tests
{
    /// <summary>
    /// The rules that make N reloads cost one transfer (UN8, the transport of
    /// G14): which hashes a thin push is missing, how the bytes go back into the
    /// manifest, and what the cache keeps. They run without Unity — the editor
    /// half around them (<c>ZablooDevServer</c>) is what the playground's README
    /// checks by hand.
    /// </summary>
    public sealed class DevPushTests
    {
        const string Thin = "{\"v\":1,\"tokens\":{},\"views\":{\"main\":{\"type\":\"Container\"}},"
            + "\"assets\":{\"icons/coin.png\":{\"hash\":\"aaa\",\"mime\":\"image/png\",\"size\":3},"
            + "\"hero.png\":{\"hash\":\"bbb\",\"mime\":\"image/png\",\"size\":3},"
            + "\"icons/coin-again.png\":{\"hash\":\"aaa\",\"mime\":\"image/png\",\"size\":3}}}";

        static Dictionary<string, object> Parse(string json)
        {
            Assert.IsTrue(DevPush.TryParse(json, out var envelope), "a pushed envelope parses");
            return envelope;
        }

        static Dictionary<string, object> Manifest(string json)
        {
            Assert.IsTrue(JsonReader.TryParse(json, out var value));
            return (Dictionary<string, object>)((Dictionary<string, object>)value)["assets"];
        }

        static string Data(Dictionary<string, object> manifest, string id)
        {
            var entry = (Dictionary<string, object>)manifest[id];
            return entry.TryGetValue("data", out var data) ? (string)data : null;
        }

        [Test]
        public void OnlyAJsonObjectIsAPush()
        {
            Assert.IsFalse(DevPush.TryParse("{\"v\": 1, \"views\"", out _), "truncated");
            Assert.IsFalse(DevPush.TryParse("[1, 2]", out _), "an array is not an envelope");
            Assert.IsFalse(DevPush.TryParse(null, out _));
            Assert.IsTrue(DevPush.TryParse("{}", out var empty));
            Assert.AreEqual(0, empty.Count);
        }

        [Test]
        public void AFirstPushIsMissingEveryHashOnce()
        {
            var cache = new Dictionary<string, string>();

            var missing = DevPush.Missing(Parse(Thin), cache);

            // Two ids share `aaa`: one transfer, not two.
            CollectionAssert.AreEqual(new[] { "aaa", "bbb" }, missing);
        }

        [Test]
        public void ACachedHashIsNotMissing()
        {
            var cache = new Dictionary<string, string> { ["aaa"] = "QUFB" };

            CollectionAssert.AreEqual(new[] { "bbb" }, DevPush.Missing(Parse(Thin), cache));
        }

        [Test]
        public void RehydrationPutsTheBytesBackUnderEveryIdThatSharesTheHash()
        {
            var cache = new Dictionary<string, string> { ["aaa"] = "QUFB", ["bbb"] = "QkJC" };

            var manifest = Manifest(DevPush.Rehydrate(Parse(Thin), cache));

            Assert.AreEqual("QUFB", Data(manifest, "icons/coin.png"));
            Assert.AreEqual("QUFB", Data(manifest, "icons/coin-again.png"));
            Assert.AreEqual("QkJC", Data(manifest, "hero.png"));
        }

        // N reloads, one transfer: the second push about the same project needs nothing.
        [Test]
        public void TheSecondPushNeedsNothing()
        {
            var cache = new Dictionary<string, string> { ["aaa"] = "QUFB", ["bbb"] = "QkJC" };
            DevPush.Rehydrate(Parse(Thin), cache);

            Assert.IsEmpty(DevPush.Missing(Parse(Thin), cache));
        }

        [Test]
        public void BytesAPushCarriedInlineAreKeptForTheNextThinOne()
        {
            var fat = Thin.Replace("\"hash\":\"bbb\",", "\"hash\":\"bbb\",\"data\":\"QkJC\",");
            var cache = new Dictionary<string, string> { ["aaa"] = "QUFB" };

            // A manual POST, or an older CLI: not missing, and remembered.
            Assert.IsEmpty(DevPush.Missing(Parse(fat), cache));
            var manifest = Manifest(DevPush.Rehydrate(Parse(fat), cache));

            Assert.AreEqual("QkJC", Data(manifest, "hero.png"));
            Assert.AreEqual("QkJC", cache["bbb"]);
        }

        // The cache tracks the content on screen, not everything ever seen (ZAB-12).
        [Test]
        public void AHashTheEnvelopeStoppedReferencingLeavesTheCache()
        {
            var cache = new Dictionary<string, string> { ["aaa"] = "QUFB", ["bbb"] = "QkJC", ["old"] = "T0xE" };

            DevPush.Rehydrate(Parse(Thin), cache);

            CollectionAssert.AreEquivalent(new[] { "aaa", "bbb" }, cache.Keys);
        }

        // The preview server did not answer for one hash: that image costs its own
        // pixels, never the reload.
        [Test]
        public void AHashStillMissingStaysWithoutBytes()
        {
            var cache = new Dictionary<string, string> { ["aaa"] = "QUFB" };

            var manifest = Manifest(DevPush.Rehydrate(Parse(Thin), cache));

            Assert.AreEqual("QUFB", Data(manifest, "icons/coin.png"));
            Assert.IsNull(Data(manifest, "hero.png"));
        }

        [Test]
        public void TheTreeSurvivesTheRoundTrip()
        {
            var json = DevPush.Rehydrate(Parse(Thin), new Dictionary<string, string>());

            Assert.IsTrue(JsonReader.TryParse(json, out var value));
            var envelope = (Dictionary<string, object>)value;
            Assert.AreEqual(1L, envelope["v"]);
            var views = (Dictionary<string, object>)envelope["views"];
            Assert.AreEqual("Container", ((Dictionary<string, object>)views["main"])["type"]);
        }

        [Test]
        public void AnEnvelopeWithoutAssetsIsMissingNothing()
        {
            var cache = new Dictionary<string, string> { ["aaa"] = "QUFB" };
            var envelope = Parse("{\"v\":1,\"views\":{}}");

            Assert.IsEmpty(DevPush.Missing(envelope, cache));
            DevPush.Rehydrate(envelope, cache);

            // Nothing referenced: nothing kept.
            Assert.IsEmpty(cache);
        }
    }
}
