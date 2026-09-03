using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.TestTools;
using Zabloo;

namespace Zabloo.Tests
{
    /// <summary>
    /// The keyboard cascade, driven by a synthetic <see cref="Keyboard"/> (UN5,
    /// ZAB-198). What a snapshot cannot record: a sequence — a press and its
    /// release, a paste clipped on the way in, an Escape that is ours and one that
    /// is not. Godot had to improvise this with throwaway scenes; here the
    /// <see cref="InputTestFixture"/> is the throwaway scene.
    ///
    /// These run in PLAY MODE (a <c>MonoBehaviour</c> has to tick) and inside
    /// Unity: the machine that wrote them had no editor, so they are written
    /// against the contract and run by whoever opens the playground. They need
    /// the native plugin installed (<c>scons install</c> in <c>sdk/unity</c>) and
    /// <c>LoadEnvelope</c> to be real (UN7): until then every case is
    /// inconclusive rather than red, which is what <c>Assume</c> is for.
    /// </summary>
    public class KeyboardInputTests : InputTestFixture
    {
        /// <summary>A field that submits, a button that fires, on one screen.</summary>
        const string Form = @"{""v"":1,""views"":{
          ""form"":{""type"":""Container"",""layout"":{""padding"":10,""gap"":10},""children"":[
            {""type"":""TextInput"",""id"":""name"",""autofocus"":true,""value"":{""bind"":""player.name""},
             ""layout"":{""width"":200,""height"":24},""maxLength"":8,""onSubmit"":""name-accept""},
            {""type"":""Button"",""id"":""ok"",""layout"":{""width"":80,""height"":24},""onClick"":""ok""}]},
          ""menu"":{""type"":""Container"",""layout"":{""padding"":10},""children"":[
            {""type"":""Button"",""id"":""play"",""autofocus"":true,""layout"":{""width"":80,""height"":24},""onClick"":""play""}]},
          ""dialog"":{""type"":""Container"",""layout"":{""padding"":10},""children"":[
            {""type"":""Button"",""id"":""under"",""autofocus"":true,""layout"":{""width"":80,""height"":24},""onClick"":""under""},
            {""type"":""Overlay"",""id"":""confirm"",""modal"":true,""onDismiss"":""closed"",""children"":[
              {""type"":""Button"",""id"":""yes"",""autofocus"":true,""layout"":{""width"":80,""height"":24},""onClick"":""yes""}]}]}}}";

        GameObject canvas;
        ZablooView view;
        Keyboard keyboard;
        readonly List<string> actions = new List<string>();
        readonly List<(string path, string json)> writes = new List<(string, string)>();

        [SetUp]
        public override void Setup()
        {
            base.Setup();
            keyboard = InputSystem.AddDevice<Keyboard>();

            canvas = new GameObject("Canvas", typeof(Canvas));
            canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var host = new GameObject("Zabloo", typeof(RectTransform));
            host.transform.SetParent(canvas.transform, false);
            ((RectTransform)host.transform).sizeDelta = new Vector2(960, 600);
            view = host.AddComponent<ZablooView>();
            view.OnAction += (name, _) => actions.Add(name);
            view.OnDataChanged += (path, json) => writes.Add((path, json));
            actions.Clear();
            writes.Clear();
        }

        [TearDown]
        public override void TearDown()
        {
            Object.DestroyImmediate(canvas);
            base.TearDown();
        }

        IEnumerator Open(string viewId)
        {
            // One frame for OnEnable to create the native document.
            yield return null;
            var loaded = view.LoadEnvelope(Form, viewId);
            Assume.That(loaded, Is.True, "needs the native plugin installed and LoadEnvelope (UN7)");
            yield return null;
        }

        /// <summary>The shortcut modifier on this platform — what `Keys.Shortcut` reads.</summary>
        UnityEngine.InputSystem.Controls.KeyControl Shortcut()
        {
#if UNITY_EDITOR_OSX || UNITY_STANDALONE_OSX
            return keyboard.leftCommandKey;
#else
            return keyboard.leftCtrlKey;
#endif
        }

        [UnityTest]
        public IEnumerator A_tap_of_Enter_fires_on_the_release_and_not_before()
        {
            yield return Open("menu");

            Press(keyboard.enterKey);
            yield return null;
            Assert.That(actions, Is.Empty, "a press alone activates nothing");

            Release(keyboard.enterKey);
            yield return null;
            Assert.That(actions, Is.EqualTo(new[] { "play" }));
        }

        [UnityTest]
        public IEnumerator Two_taps_are_two_actions()
        {
            yield return Open("menu");

            PressAndRelease(keyboard.enterKey);
            yield return null;
            PressAndRelease(keyboard.spaceKey);
            yield return null;
            Assert.That(actions, Is.EqualTo(new[] { "play", "play" }));
        }

        [UnityTest]
        public IEnumerator Typed_text_reaches_the_focused_field_and_writes_its_binding()
        {
            yield return Open("form");

            InputSystem.QueueTextEvent(keyboard, 'S');
            InputSystem.QueueTextEvent(keyboard, 'i');
            InputSystem.Update();
            yield return null;

            Assert.That(writes, Has.Count.EqualTo(2));
            Assert.That(writes[1], Is.EqualTo(("player.name", "\"Si\"")));
        }

        [UnityTest]
        public IEnumerator A_paste_is_clipped_to_maxLength_like_anything_typed()
        {
            yield return Open("form");

            GUIUtility.systemCopyBuffer = "Sergi Zamora";
            Press(Shortcut());
            Press(keyboard.vKey);
            yield return null;
            Release(keyboard.vKey);
            Release(Shortcut());
            yield return null;

            Assert.That(writes, Has.Count.EqualTo(1));
            Assert.That(writes[0], Is.EqualTo(("player.name", "\"Sergi Za\"")));
        }

        [UnityTest]
        public IEnumerator Enter_in_a_field_submits_and_presses_nothing()
        {
            yield return Open("form");

            PressAndRelease(keyboard.enterKey);
            yield return null;
            Assert.That(actions, Is.EqualTo(new[] { "name-accept" }));
        }

        [UnityTest]
        public IEnumerator Escape_closes_the_modal_and_is_consumed()
        {
            yield return Open("dialog");

            PressAndRelease(keyboard.escapeKey);
            yield return null;
            Assert.That(view.EscapeConsumedThisFrame, Is.True);
            Assert.That(actions, Is.EqualTo(new[] { "closed" }));

            // The property is a frame's answer: the next frame it is false again.
            yield return null;
            Assert.That(view.EscapeConsumedThisFrame, Is.False);
        }

        [UnityTest]
        public IEnumerator Escape_with_no_modal_up_is_not_consumed()
        {
            yield return Open("menu");

            PressAndRelease(keyboard.escapeKey);
            yield return null;
            Assert.That(view.EscapeConsumedThisFrame, Is.False, "an Escape this view did not use is the game's");
            Assert.That(actions, Is.Empty);
        }
    }
}
