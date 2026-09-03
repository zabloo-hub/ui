using NUnit.Framework;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Zabloo.Tests
{
    /// <summary>
    /// The translation table on its own: no device, no view, no plugin. What the
    /// corpus's <c>pad</c> script means has to be what a Unity pad produces, index
    /// for index and sign for sign.
    /// </summary>
    public sealed class PadMappingTests
    {
        [Test]
        public void ButtonSlotsLandOnTheStandardMappingsIndices()
        {
            Assert.AreEqual(0, PadMapping.SnapshotIndex(PadButtonSlot.A));
            Assert.AreEqual(1, PadMapping.SnapshotIndex(PadButtonSlot.B));
            Assert.AreEqual(12, PadMapping.SnapshotIndex(PadButtonSlot.DpadUp));
            Assert.AreEqual(13, PadMapping.SnapshotIndex(PadButtonSlot.DpadDown));
            Assert.AreEqual(14, PadMapping.SnapshotIndex(PadButtonSlot.DpadLeft));
            Assert.AreEqual(15, PadMapping.SnapshotIndex(PadButtonSlot.DpadRight));
        }

        [Test]
        public void EverySlotIsSpelledTheWayTheGameSideSpellsIt()
        {
            var names = new[] { "a", "b", "dpad_up", "dpad_down", "dpad_left", "dpad_right" };
            for (var i = 0; i < names.Length; i++)
            {
                Assert.IsTrue(PadMapping.TryButtonSlot(names[i], out var slot), names[i]);
                Assert.AreEqual((PadButtonSlot)i, slot);
                Assert.AreEqual(names[i], PadMapping.Name(slot));
            }
            var axes = new[] { "nav_x", "nav_y", "scroll_x", "scroll_y" };
            for (var i = 0; i < axes.Length; i++)
            {
                Assert.IsTrue(PadMapping.TryAxisSlot(axes[i], out var slot), axes[i]);
                Assert.AreEqual((PadAxisSlot)i, slot);
                Assert.AreEqual(axes[i], PadMapping.Name(slot));
            }
        }

        [Test]
        public void AnUnknownSlotIsAnsweredNotThrown()
        {
            Assert.IsFalse(PadMapping.TryButtonSlot("dpad-up", out _));
            Assert.IsFalse(PadMapping.TryButtonSlot("", out _));
            Assert.IsFalse(PadMapping.TryButtonSlot(null, out _));
            Assert.IsFalse(PadMapping.TryAxisSlot("nav", out _));
            // A slot's name is a button's OR an axis's, never both.
            Assert.IsFalse(PadMapping.TryAxisSlot("a", out _));
            Assert.IsFalse(PadMapping.TryButtonSlot("nav_x", out _));
        }

        [Test]
        public void TheFactoryLayoutIsTheInputSystemsStandardPositions()
        {
            var buttons = PadMapping.DefaultButtons();
            Assert.AreEqual(GamepadButton.South, buttons[(int)PadButtonSlot.A]);
            Assert.AreEqual(GamepadButton.East, buttons[(int)PadButtonSlot.B]);
            Assert.AreEqual(GamepadButton.DpadUp, buttons[(int)PadButtonSlot.DpadUp]);
            Assert.AreEqual(GamepadButton.DpadDown, buttons[(int)PadButtonSlot.DpadDown]);
            Assert.AreEqual(GamepadButton.DpadLeft, buttons[(int)PadButtonSlot.DpadLeft]);
            Assert.AreEqual(GamepadButton.DpadRight, buttons[(int)PadButtonSlot.DpadRight]);
            CollectionAssert.AreEqual(new[] { 0, 1, 2, 3 }, PadMapping.DefaultAxes());
        }

        [Test]
        public void TheDefaultsAreCopiesSoAViewRemapsOnlyItself()
        {
            var a = PadMapping.DefaultButtons();
            a[0] = GamepadButton.North;
            Assert.AreEqual(GamepadButton.South, PadMapping.DefaultButtons()[0]);
            var axes = PadMapping.DefaultAxes();
            axes[0] = PadMapping.AxisOff;
            Assert.AreEqual(0, PadMapping.DefaultAxes()[0]);
        }

        [Test]
        public void YIsFlippedBecauseTheCoreReadsDownAsPositive()
        {
            // The Input System reports a stick pushed UP as +1; the standard mapping
            // (and Godot) report it as -1. X is untouched.
            var up = new Vector2(0f, 1f);
            var rightward = new Vector2(1f, 0f);
            Assert.AreEqual(-1.0, PadMapping.Axis(PadMapping.AxisLeftY, up, Vector2.zero));
            Assert.AreEqual(-1.0, PadMapping.Axis(PadMapping.AxisRightY, Vector2.zero, up));
            Assert.AreEqual(1.0, PadMapping.Axis(PadMapping.AxisLeftX, rightward, Vector2.zero));
            Assert.AreEqual(1.0, PadMapping.Axis(PadMapping.AxisRightX, Vector2.zero, rightward));
            // Each axis reads its own stick and nothing of the other.
            Assert.AreEqual(0.0, PadMapping.Axis(PadMapping.AxisLeftX, Vector2.zero, rightward));
            Assert.AreEqual(0.0, PadMapping.Axis(PadMapping.AxisRightY, up, Vector2.zero));
        }

        [Test]
        public void AnAxisSwitchedOffOrUnknownIsAtRest()
        {
            var pushed = new Vector2(1f, 1f);
            Assert.AreEqual(0.0, PadMapping.Axis(PadMapping.AxisOff, pushed, pushed));
            Assert.AreEqual(0.0, PadMapping.Axis(7, pushed, pushed));
        }

        [Test]
        public void TheSnapshotIsShapedLikeAStandardMappingPad()
        {
            Assert.AreEqual(17, PadMapping.SnapshotButtons);
            Assert.AreEqual(4, PadMapping.SnapshotAxes);
            for (var slot = 0; slot < PadMapping.ButtonSlotCount; slot++)
            {
                Assert.Less(PadMapping.SnapshotIndex((PadButtonSlot)slot), PadMapping.SnapshotButtons);
            }
        }
    }
}
