using System;
using System.Collections;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
using UnityEngine.TestTools;
using Zabloo.Sdk.Interop;

namespace Zabloo.Tests
{
    /// <summary>
    /// The golden corpus, replayed from INSIDE Unity (UN10, ZAB-203).
    ///
    /// The corpus already passes in the core (G3) and through the C ABI (UN2).
    /// What neither can see is the adapter's plumbing — the size it hands the
    /// core, the clock, how it marshals a value, how it fills the pad snapshot —
    /// and this puts that plumbing under the same contract: the same envelope,
    /// the same metrics, byte for byte, through a real <see cref="ZablooView"/> on
    /// a real <c>Canvas</c>. If a case reproduces here it means the boundary did
    /// not change the answer; if it does not, the culprit is in <c>sdk/unity</c>,
    /// and the diff names the path.
    ///
    /// A case is <c>(envelope, data, viewport, clock, pad)</c> and it is staged in
    /// the order <c>golden/README.md</c> fixes and <c>core/tests/corpus.cpp</c>
    /// runs: the envelope loaded and shown, the data pushed — <b>through the
    /// public <see cref="ZablooView.SetData"/></b>, because the JSON writer it goes
    /// through is one of the things on trial —, two settling frames at t = 0, the
    /// clock advanced in one jump, then the pad script, each of whose spans is a
    /// polled frame. Frames are driven by <c>yield return null</c> — the
    /// component's own <c>Update</c>, no shortcut into the core — with the clock
    /// planted through <see cref="ZablooView.NowSource"/>, so the frame measured is
    /// the frame recorded: a Spinner's wave and a stick's scroll are functions of
    /// time, and a stopwatch would put them somewhere else.
    ///
    /// The pad is a synthetic <see cref="Gamepad"/> from
    /// <see cref="InputTestFixture"/>, pressed by the standard-mapping index the
    /// script uses, so what is tested is also the adapter's translation table
    /// (<see cref="PadMapping"/>, index and sign), not only the core's loop. A
    /// step the adapter has no slot for fails out loud rather than measuring a
    /// frame the script never reached.
    ///
    /// Needs the native plugin (<c>scons install</c> in <c>sdk/unity</c>); the
    /// suite is ignored, with the command, when it is missing. Runs in the Test
    /// Runner's PlayMode tab and in batchmode (<c>-runTests -testPlatform
    /// PlayMode</c>); not in CI, which has no Unity licence — the READMEs say so.
    /// </summary>
    public sealed class GoldenTests : InputTestFixture
    {
        readonly List<GameObject> objects = new List<GameObject>();
        ZablooView view;
        Gamepad pad;
        Vector2 leftStick;
        Vector2 rightStick;

        /// <summary>Where the planted clock stands, in ms. Every advance moves it.</summary>
        double clock;

        Func<double> stopwatch;

        public override void Setup()
        {
            base.Setup();
            RequirePlugin();
            clock = 0.0;
            stopwatch = ZablooView.NowSource;
            ZablooView.NowSource = () => clock;
            leftStick = Vector2.zero;
            rightStick = Vector2.zero;
        }

        public override void TearDown()
        {
            foreach (var go in objects) UnityEngine.Object.DestroyImmediate(go);
            objects.Clear();
            view = null;
            pad = null;
            if (stopwatch != null) ZablooView.NowSource = stopwatch;
            base.TearDown();
        }

        /// <summary>Ignores the suite, with the fix, when the plugin is not there — a `DllImport` that cannot resolve is not a corpus failure.</summary>
        static void RequirePlugin()
        {
            try
            {
                NativeMethods.zb_version();
            }
            catch (DllNotFoundException)
            {
                Assert.Ignore("the native plugin is not installed — `cd sdk/unity && scons install` after `scons capi` in core/");
            }
        }

        // --- the rig -------------------------------------------------------------

        /// <summary>A view on a Screen Space – Overlay canvas, sized to the case's viewport.</summary>
        ZablooView Spawn(double width, double height)
        {
            var canvas = new GameObject("golden-canvas", typeof(Canvas));
            canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            objects.Add(canvas);
            var host = new GameObject("golden-view", typeof(RectTransform));
            host.transform.SetParent(canvas.transform, false);
            ((RectTransform)host.transform).sizeDelta = new Vector2((float)width, (float)height);
            return host.AddComponent<ZablooView>();
        }

        /// <summary>One frame of the component's own <c>Update</c>, at the planted clock.</summary>
        IEnumerator Frame()
        {
            view.MarkDirty();
            yield return null;
        }

        static GoldenCorpus.Case Find(string name)
        {
            if (name == GoldenCorpus.NotFound)
            {
                Assert.Fail("golden/cases.json was not found above the package or the project: the runner has nothing to compare");
            }
            var spec = GoldenCorpus.Find(name);
            Assert.IsNotNull(spec, name + " is not a case of golden/cases.json");
            return spec;
        }

        // --- the corpus ------------------------------------------------------------

        /// <summary>
        /// Every case that measures a frame reproduces <c>golden/metrics/&lt;case&gt;.json</c>
        /// byte for byte. Nothing softens the comparison: a case either matches or
        /// the diff says where it does not, by path, with both values and the
        /// <c>ref</c> of the node an author wrote.
        /// </summary>
        [UnityTest]
        public IEnumerator ACaseReproducesTheMetricsItRecorded(
            [ValueSource(typeof(GoldenCorpus), nameof(GoldenCorpus.MetricCaseNames))] string name)
        {
            var spec = Find(name);
            var envelope = GoldenCorpus.Read("envelopes/" + spec.Envelope);
            Assert.IsNotNull(envelope, "golden/envelopes/" + spec.Envelope + " is missing");
            var expected = GoldenCorpus.Read("metrics/" + name + ".json");
            Assert.IsNotNull(expected, "golden/metrics/" + name + ".json is missing");

            // The pad is plugged in BEFORE the mount, so the first settling frame
            // connects it at t = 0 — where `replay_pad` connects its controller for a
            // case with no `advanceMs`. Every step of the script below is then a
            // change to a device the view is already reading.
            if (spec.Pad != null) pad = InputSystem.AddDevice<Gamepad>();

            view = Spawn(spec.Width, spec.Height);
            // The envelope's FIRST view, as `Document::load` shows it.
            Assert.IsTrue(view.LoadEnvelope(envelope, ""), name + ": the envelope was refused — " + Fatal(view));

            foreach (var entry in spec.Data) view.SetData(entry.Key, entry.Value);

            // Two frames at t = 0, and the second is part of the contract rather than
            // a rig detail: the settling frame `golden/README.md` requires after the
            // data — a bound array measures its items on the frame it arrives and
            // windows them on the next.
            yield return Frame();
            // A corpus envelope that warns is a broken fixture, and its metrics would
            // have been measured on a degraded render.
            Assert.AreEqual(0, view.Diagnostics.Count, name + " warned while loading: " + Lines(view.Diagnostics));
            yield return Frame();

            // Then the clock, in one jump: the record is of the frame at that instant,
            // not of the frames on the way there.
            if (spec.AdvanceMs > 0.0)
            {
                clock += spec.AdvanceMs;
                yield return Frame();
            }

            // And last the pad, which moves the clock the rest of the way in the
            // steps its own script asks for: a poll is a frame, so the spans between
            // them are where a held direction repeats and where the stick covers ground.
            if (spec.Pad != null) yield return ReplayPad(spec.Pad);

            var actual = view.Snapshot();
            Assert.IsNotNull(actual, name + ": no snapshot — nothing is on screen");
            if (!string.Equals(expected, actual, StringComparison.Ordinal))
            {
                Assert.Fail(GoldenDiff.Describe(name, expected, actual));
            }
        }

        /// <summary>
        /// Not every normative rule of the format produces a frame. A case with
        /// <c>refuses</c> records the other kind: the envelope must be rejected,
        /// with the code it names, and nothing must render — <c>LoadEnvelope</c>
        /// answers false, <c>IsLoaded</c> stays false, there is no snapshot, and
        /// the code is on <see cref="ZablooView.Diagnostics"/> as fatal.
        /// </summary>
        [UnityTest]
        public IEnumerator AnEnvelopeTheCorpusMarksAsRefusedIsRefusedWithItsCode(
            [ValueSource(typeof(GoldenCorpus), nameof(GoldenCorpus.RefusalCaseNames))] string name)
        {
            var spec = Find(name);
            var envelope = GoldenCorpus.Read("envelopes/" + spec.Envelope);
            Assert.IsNotNull(envelope, "golden/envelopes/" + spec.Envelope + " is missing");

            view = Spawn(spec.Width, spec.Height);
            // A refusal is reported to the console as an error, which is right for a
            // game and would fail this test for the wrong reason.
            LogAssert.Expect(LogType.Error, new Regex(Regex.Escape(spec.Refuses)));
            Assert.IsFalse(view.LoadEnvelope(envelope, ""), name + " loaded, and must not");
            Assert.IsFalse(view.IsLoaded);
            Assert.IsNull(view.Snapshot());

            string reported = null;
            foreach (var diagnostic in view.Diagnostics)
            {
                if (!diagnostic.Fatal) continue;
                reported = diagnostic.Code;
                break;
            }
            Assert.AreEqual(spec.Refuses, reported, name + ": refused with the wrong code");
            yield return null;
        }

        // --- the pad -------------------------------------------------------------

        /// <summary>
        /// Replays a case's <c>pad</c> script against the device the view is
        /// polling. A pad is POLLED, never pushed: a <c>press</c> only becomes an
        /// intention on a frame that reads it, so a step that changes the state
        /// does nothing until an <c>advanceMs</c> gives the loop one — exactly the
        /// rule <c>replay_pad</c> applies in the core's harness.
        /// </summary>
        IEnumerator ReplayPad(List<object> steps)
        {
            foreach (var raw in steps)
            {
                var step = raw as Dictionary<string, object>;
                Assert.IsNotNull(step, "a pad step is not an object");
                if (step.TryGetValue("press", out var press))
                {
                    Press(Button((int)GoldenCorpus.Number(press, -1)));
                }
                else if (step.TryGetValue("release", out var release))
                {
                    Release(Button((int)GoldenCorpus.Number(release, -1)));
                }
                else if (step.TryGetValue("axis", out var axis))
                {
                    step.TryGetValue("value", out var value);
                    Axis((int)GoldenCorpus.Number(axis, -1), (float)GoldenCorpus.Number(value, 0.0));
                }
                else
                {
                    step.TryGetValue("advanceMs", out var advance);
                    clock += GoldenCorpus.Number(advance, 0.0);
                    // With a pad connected the view polls it on every Update; the
                    // MarkDirty is only so the sequence reads the same as the rest.
                    yield return Frame();
                }
            }
        }

        /// <summary>
        /// The control a standard-mapping button index lands on. Only what the
        /// adapter has a SLOT for (<see cref="PadMapping"/>: A, B and the d-pad):
        /// a script pressing anything else could be written into the device and
        /// never be read, and a frame measured after that would not be the frame
        /// the script describes.
        /// </summary>
        ButtonControl Button(int index)
        {
            switch (index)
            {
                case 0: return pad.buttonSouth;
                case 1: return pad.buttonEast;
                case 12: return pad.dpad.up;
                case 13: return pad.dpad.down;
                case 14: return pad.dpad.left;
                case 15: return pad.dpad.right;
                default:
                    Assert.Fail("the Unity adapter has no slot for standard-mapping button " + index + " — the script cannot be replayed here");
                    return null;
            }
        }

        /// <summary>
        /// One axis of the standard mapping, written to the stick it belongs to in
        /// the Input System's own sign — up is +1 there and -1 in the mapping, so
        /// the Y the script gives is negated on the way IN, which is what
        /// <see cref="PadMapping.Axis"/> undoes on the way out. Both sticks are
        /// kept whole: setting one axis must not zero the other.
        /// </summary>
        void Axis(int index, float value)
        {
            switch (index)
            {
                case 0: leftStick.x = value; Set(pad.leftStick, leftStick); return;
                case 1: leftStick.y = -value; Set(pad.leftStick, leftStick); return;
                case 2: rightStick.x = value; Set(pad.rightStick, rightStick); return;
                case 3: rightStick.y = -value; Set(pad.rightStick, rightStick); return;
                default:
                    Assert.Fail("the standard mapping has no axis " + index + " — the script cannot be replayed here");
                    return;
            }
        }

        // --- reporting -----------------------------------------------------------

        static string Fatal(ZablooView v)
        {
            foreach (var diagnostic in v.Diagnostics)
            {
                if (diagnostic.Fatal) return diagnostic.ToString();
            }
            return "(no fatal diagnostic)";
        }

        static string Lines(IReadOnlyList<Diagnostic> diagnostics)
        {
            var lines = new List<string>();
            foreach (var diagnostic in diagnostics) lines.Add(diagnostic.ToString());
            return string.Join("; ", lines);
        }
    }
}
