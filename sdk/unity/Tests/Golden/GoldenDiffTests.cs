using NUnit.Framework;

namespace Zabloo.Tests
{
    /// <summary>
    /// The rules of the diff that no corpus case fixes — the same two the core's
    /// runner asserts about its own <c>describe</c>, so the report reads alike on
    /// every target. Pure: no engine, no plugin, and they run in either tab of the
    /// Test Runner.
    /// </summary>
    public class GoldenDiffTests
    {
        [Test]
        public void ADifferenceIsReportedByPathWithBothValuesAndTheNodeItIsIn()
        {
            const string recorded = @"{""view"":""a"",""tree"":{""type"":""Container"",""ref"":""root"",""rect"":{
                ""x"":0,""y"":0,""width"":480,""height"":320},""children"":[
                {""type"":""Button"",""ref"":""buy"",""rect"":{""x"":8,""y"":8,""width"":128,""height"":40},
                 ""style"":{""radius"":6}}]}}";
            const string produced = @"{""view"":""a"",""tree"":{""type"":""Container"",""ref"":""root"",""rect"":{
                ""x"":0,""y"":0,""width"":480,""height"":320},""children"":[
                {""type"":""Button"",""ref"":""buy"",""rect"":{""x"":8,""y"":8,""width"":132,""height"":40},
                 ""style"":{}}]}}";

            var report = GoldenDiff.Describe("demo", recorded, produced);
            StringAssert.Contains("demo does not reproduce golden/metrics/demo.json", report);
            StringAssert.Contains("tree.children[0].rect.width (ref \"buy\"): expected 128, actual 132", report);
            StringAssert.Contains("tree.children[0].style.radius (ref \"buy\"): expected 6, actual (absent)", report);
            // Nothing else moved, so nothing else is printed: what shows up in a diff
            // is what changed, not the noise around it.
            Assert.AreEqual(2, report.Split('\n').Length - 1);
        }

        [Test]
        public void ASnapshotThatDiffersOnlyInItsBytesStillFailsAndSaysSo()
        {
            var report = GoldenDiff.Describe("demo", @"{""a"":1,""b"":2}", @"{""b"":2,""a"":1}");
            StringAssert.Contains("the values match but the bytes do not", report);
        }

        [Test]
        public void AnArrayThatChangedLengthSaysSoAndStillWalksWhatItShares()
        {
            var report = GoldenDiff.Describe("demo", @"{""layer"":[{""ref"":""m"",""z"":1},{""ref"":""t"",""z"":2}]}",
                @"{""layer"":[{""ref"":""m"",""z"":3}]}");
            StringAssert.Contains("layer: expected 2 entries, actual 1", report);
            StringAssert.Contains("layer[0].z (ref \"m\"): expected 1, actual 3", report);
        }

        [Test]
        public void NumbersAreSpelledTheWayTheFileSpellsThem()
        {
            Assert.AreEqual("0", GoldenDiff.FormatNumber(0.0));
            Assert.AreEqual("0", GoldenDiff.FormatNumber(-0.0));
            Assert.AreEqual("0", GoldenDiff.FormatNumber(0.0004));
            Assert.AreEqual("0.001", GoldenDiff.FormatNumber(0.0005));
            Assert.AreEqual("62.234", GoldenDiff.FormatNumber(62.2341));
            Assert.AreEqual("18.4", GoldenDiff.FormatNumber(18.4));
            Assert.AreEqual("-2.5", GoldenDiff.FormatNumber(-2.5));
            Assert.AreEqual("-0.001", GoldenDiff.FormatNumber(-0.0005));
            Assert.AreEqual("480", GoldenDiff.FormatNumber(480.0));
            Assert.AreEqual("null", GoldenDiff.FormatNumber(double.NaN));
        }

        [Test]
        public void NumbersAreSpelledWithoutACulture()
        {
            var was = System.Threading.Thread.CurrentThread.CurrentCulture;
            try
            {
                System.Threading.Thread.CurrentThread.CurrentCulture = new System.Globalization.CultureInfo("es-ES");
                Assert.AreEqual("0.5", GoldenDiff.FormatNumber(0.5));
                Assert.AreEqual("1234.567", GoldenDiff.FormatNumber(1234.5674));
            }
            finally
            {
                System.Threading.Thread.CurrentThread.CurrentCulture = was;
            }
        }
    }
}
