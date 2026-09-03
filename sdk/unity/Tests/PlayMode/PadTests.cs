using System.Collections;
using System.Collections.Generic;
using System.Text;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.TestTools;

namespace Zabloo.Tests
{
    /// <summary>
    /// The pad against a real <see cref="ZablooView"/>, with a synthetic
    /// <see cref="Gamepad"/> from <see cref="InputTestFixture"/> — the procedure of
    /// ZAB-47/G13 that Godot could only run by hand. What the corpus records is
    /// where the player ENDED UP; these say the steps on the way there were the
    /// right ones, and that the adapter's half (which device, which button, when to
    /// look, who owns it) is wired to the core's.
    ///
    /// Everything is observed through <see cref="ZablooView.OnAction"/>: a menu of
    /// twelve buttons whose actions are their ids, so "press A" says which one the
    /// focus reached. That needs the host channel (UN7) — until it lands,
    /// <c>LoadEnvelope</c> is a stub and every test here fails at its first assert.
    ///
    /// PlayMode only: the pad is polled from <c>Update</c>, and a frame is a
    /// <c>yield return null</c>.
    /// </summary>
    public sealed class PadTests : InputTestFixture
    {
        /// <summary>How many buttons the menu has: a second of hold walks 8, so more than 9.</summary>
        const int Buttons = 12;

        readonly List<GameObject> objects = new List<GameObject>();
        readonly Dictionary<ZablooView, List<string>> actions = new Dictionary<ZablooView, List<string>>();

        public override void Setup()
        {
            base.Setup();
        }

        public override void TearDown()
        {
            foreach (var go in objects) Object.Destroy(go);
            objects.Clear();
            actions.Clear();
            base.TearDown();
        }

        // --- the envelopes -------------------------------------------------------

        /// <summary>A column of buttons, `b0` focused, each firing its own id.</summary>
        static string Menu()
        {
            var sb = new StringBuilder();
            sb.Append("{\"v\":1,\"tokens\":{},\"views\":{\"menu\":{\"type\":\"Container\",\"id\":\"root\",");
            sb.Append("\"layout\":{\"direction\":\"column\",\"gap\":4,\"padding\":8},\"children\":[");
            for (var i = 0; i < Buttons; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append("{\"type\":\"Button\",\"id\":\"b").Append(i).Append("\",\"onPress\":\"b").Append(i).Append('"');
                if (i == 0) sb.Append(",\"autofocus\":true");
                sb.Append(",\"layout\":{\"width\":200,\"height\":24},\"style\":{\"background\":\"#334155\"},");
                sb.Append("\"states\":{\"focused\":{\"style\":{\"background\":\"#4f46e5\"}}}}");
            }
            sb.Append("]}}}");
            return sb.ToString();
        }

        /// <summary>One horizontal slider, focused, with the two hooks of ZAB-24.</summary>
        const string Fader =
            "{\"v\":1,\"tokens\":{},\"views\":{\"fader\":{\"type\":\"Container\",\"id\":\"root\","
            + "\"layout\":{\"padding\":8},\"children\":[{\"type\":\"Slider\",\"id\":\"fader\",\"autofocus\":true,"
            + "\"value\":50,\"min\":0,\"max\":100,\"step\":10,\"onChange\":\"fader-change\",\"onCommit\":\"fader-commit\","
            + "\"layout\":{\"width\":200,\"height\":20},\"style\":{\"background\":\"#334155\"},\"children\":["
            + "{\"type\":\"Container\",\"id\":\"fill\",\"style\":{\"background\":\"#4f46e5\"}},"
            + "{\"type\":\"Container\",\"id\":\"thumb\",\"layout\":{\"width\":16,\"height\":16},\"style\":{\"background\":\"#ffffff\"}}]}]}}}";

        // --- the rig -------------------------------------------------------------

        ZablooView Spawn(string name, string envelope, string viewId)
        {
            var canvas = new GameObject(name + "-canvas", typeof(Canvas));
            objects.Add(canvas);
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(canvas.transform, false);
            ((RectTransform)go.transform).sizeDelta = new Vector2(480f, 480f);
            var view = go.AddComponent<ZablooView>();
            var log = new List<string>();
            actions[view] = log;
            view.OnAction += (action, context) => log.Add(action);
            Assert.IsTrue(view.LoadEnvelope(envelope, viewId), "the envelope loads (needs UN7)");
            return view;
        }

        List<string> Actions(ZablooView view)
        {
            return actions[view];
        }

        /// <summary>Press and release A across two frames: the focused node fires on the release edge.</summary>
        IEnumerator Activate(Gamepad pad)
        {
            Press(pad.buttonSouth);
            yield return null;
            Release(pad.buttonSouth);
            yield return null;
        }

        // --- one press, one step ------------------------------------------------

        [UnityTest]
        public IEnumerator OnePushOfTheDpadIsOneStepOfFocus()
        {
            var pad = InputSystem.AddDevice<Gamepad>();
            var view = Spawn("view", Menu(), "menu");
            yield return null; // registers, adopts the pad

            Press(pad.dpad.down);
            yield return null;
            Release(pad.dpad.down);
            yield return null;
            yield return Activate(pad);
            CollectionAssert.AreEqual(new[] { "b1" }, Actions(view));

            // And the left stick is the same step, in the core's sign: down is +Y
            // for the core, -Y for the Input System.
            Set(pad.leftStick, new Vector2(0f, -1f));
            yield return null;
            Set(pad.leftStick, Vector2.zero);
            yield return null;
            yield return Activate(pad);
            CollectionAssert.AreEqual(new[] { "b1", "b2" }, Actions(view));

            Set(pad.leftStick, new Vector2(0f, 1f));
            yield return null;
            Set(pad.leftStick, Vector2.zero);
            yield return null;
            yield return Activate(pad);
            CollectionAssert.AreEqual(new[] { "b1", "b2", "b1" }, Actions(view));
        }

        [UnityTest]
        public IEnumerator ASecondHeldIsEightSteps()
        {
            var pad = InputSystem.AddDevice<Gamepad>();
            var view = Spawn("view", Menu(), "menu");
            yield return null;

            // Fires on the press, waits 400 ms, then every 90 ms: 0, 400, 490, 580,
            // 670, 760, 850, 940 — eight by the time a second is up, the ninth not
            // before 1030. Released a little short of the second so a slow frame
            // cannot tip it over.
            Press(pad.dpad.down);
            yield return null;
            yield return new WaitForSecondsRealtime(0.96f);
            Release(pad.dpad.down);
            yield return null;
            yield return Activate(pad);
            CollectionAssert.AreEqual(new[] { "b8" }, Actions(view));
        }

        // --- closing well ---------------------------------------------------------

        [UnityTest]
        public IEnumerator UnpluggingMidPressCancelsInsteadOfActivating()
        {
            var pad = InputSystem.AddDevice<Gamepad>();
            var view = Spawn("view", Menu(), "menu");
            yield return null;

            Press(pad.buttonSouth);
            yield return null;
            InputSystem.RemoveDevice(pad);
            yield return null;
            yield return null;
            CollectionAssert.IsEmpty(Actions(view));

            // The controller forgot the hold with the cable: a new pad's A is a new
            // press, not the release of the old one.
            var next = InputSystem.AddDevice<Gamepad>();
            yield return null;
            yield return Activate(next);
            CollectionAssert.AreEqual(new[] { "b0" }, Actions(view));
        }

        [UnityTest]
        public IEnumerator UnpluggingMidNudgeSettlesTheSlider()
        {
            var pad = InputSystem.AddDevice<Gamepad>();
            var view = Spawn("view", Fader, "fader");
            yield return null;

            // Along its axis the d-pad adjusts the value: one step, reported live…
            Press(pad.dpad.right);
            yield return null;
            CollectionAssert.AreEqual(new[] { "fader-change" }, Actions(view));

            // …and the cable pulled mid-hold is the end of the gesture: the value on
            // screen is the one the player left there, so it commits (ZAB-47).
            InputSystem.RemoveDevice(pad);
            yield return null;
            yield return null;
            CollectionAssert.AreEqual(new[] { "fader-change", "fader-commit" }, Actions(view));
        }

        // --- one owner -----------------------------------------------------------

        [UnityTest]
        public IEnumerator OnlyTheOwnerMovesAndTouchingTheOtherTakesInput()
        {
            var pad = InputSystem.AddDevice<Gamepad>();
            // One frame apart, so the order of arrival is not left to Unity.
            var first = Spawn("first", Menu(), "menu");
            yield return null;
            var second = Spawn("second", Menu(), "menu");
            yield return null;

            Press(pad.dpad.down);
            yield return null;
            Release(pad.dpad.down);
            yield return null;
            yield return Activate(pad);
            CollectionAssert.AreEqual(new[] { "b1" }, Actions(first));
            CollectionAssert.IsEmpty(Actions(second));

            // The pointer's press does this in Pointer.cs (UN5); here it is said
            // directly. The second view starts from its own autofocus.
            InputOwner.Claim(second);
            yield return null;
            yield return Activate(pad);
            CollectionAssert.AreEqual(new[] { "b1" }, Actions(first));
            CollectionAssert.AreEqual(new[] { "b0" }, Actions(second));

            // Losing the owner hands the pad back to the oldest view, whose focus
            // stayed where it was.
            Object.Destroy(second.gameObject);
            yield return null;
            yield return null;
            yield return Activate(pad);
            CollectionAssert.AreEqual(new[] { "b1", "b1" }, Actions(first));
        }

        [UnityTest]
        public IEnumerator ARemappedSlotReadsTheOtherButton()
        {
            var pad = InputSystem.AddDevice<Gamepad>();
            var view = Spawn("view", Menu(), "menu");
            yield return null;

            Assert.IsTrue(view.SetPadButton("a", GamepadButton.East));
            Assert.IsTrue(view.SetPadButton("b", GamepadButton.South));
            Assert.IsFalse(view.SetPadButton("dpad-up", GamepadButton.North));
            Assert.IsFalse(view.SetPadAxis("nav", PadMapping.AxisOff));

            // South is now "back": nothing to dismiss, nothing happens.
            yield return Activate(pad);
            CollectionAssert.IsEmpty(Actions(view));

            Press(pad.buttonEast);
            yield return null;
            Release(pad.buttonEast);
            yield return null;
            CollectionAssert.AreEqual(new[] { "b0" }, Actions(view));
        }
    }
}
