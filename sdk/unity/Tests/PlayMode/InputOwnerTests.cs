using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace Zabloo.Tests
{
    /// <summary>
    /// The ownership rule, with any component standing in for a view: the registry
    /// is keyed on <see cref="Behaviour"/> precisely so this needs no plugin.
    /// </summary>
    public sealed class InputOwnerTests
    {
        /// <summary>A stand-in view. Nothing in it: only that it can be enabled, disabled and destroyed.</summary>
        sealed class Probe : MonoBehaviour
        {
        }

        readonly List<GameObject> objects = new List<GameObject>();

        Probe Spawn(string name)
        {
            var go = new GameObject(name);
            objects.Add(go);
            return go.AddComponent<Probe>();
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var go in objects) Object.DestroyImmediate(go);
            objects.Clear();
            // Destroyed views drop out on the next question; asking is the cleanup.
            Assert.IsNull(InputOwner.Owner);
        }

        [Test]
        public void TheFirstViewToRegisterOwnsInput()
        {
            var a = Spawn("a");
            var b = Spawn("b");
            InputOwner.Register(a);
            InputOwner.Register(b);
            Assert.IsTrue(InputOwner.Owns(a));
            Assert.IsFalse(InputOwner.Owns(b));
        }

        [Test]
        public void RegisteringEveryFrameChangesNothing()
        {
            var a = Spawn("a");
            var b = Spawn("b");
            InputOwner.Register(a);
            InputOwner.Register(b);
            InputOwner.Register(b);
            InputOwner.Register(a);
            Assert.IsTrue(InputOwner.Owns(a));
            // Nor does it make a view senior: disabling a still hands over to b, once.
            a.enabled = false;
            Assert.IsTrue(InputOwner.Owns(b));
        }

        [Test]
        public void TouchingAViewTakesInput()
        {
            var a = Spawn("a");
            var b = Spawn("b");
            InputOwner.Register(a);
            InputOwner.Register(b);
            InputOwner.Claim(b);
            Assert.IsTrue(InputOwner.Owns(b));
            Assert.IsFalse(InputOwner.Owns(a));
            InputOwner.Claim(a);
            Assert.IsTrue(InputOwner.Owns(a));
        }

        [Test]
        public void AViewThatIsNotRegisteredClaimsNothing()
        {
            var a = Spawn("a");
            var stranger = Spawn("stranger");
            InputOwner.Register(a);
            InputOwner.Claim(stranger);
            Assert.IsTrue(InputOwner.Owns(a));
            Assert.IsFalse(InputOwner.Owns(stranger));
            InputOwner.Claim(null);
            Assert.IsTrue(InputOwner.Owns(a));
        }

        [Test]
        public void ADisabledOwnerHandsOverToTheOldestViewLeft()
        {
            var a = Spawn("a");
            var b = Spawn("b");
            var c = Spawn("c");
            InputOwner.Register(a);
            InputOwner.Register(b);
            InputOwner.Register(c);
            InputOwner.Claim(c);
            c.enabled = false;
            // Not to whoever owned it before c, and not to the newest: to the oldest.
            Assert.IsTrue(InputOwner.Owns(a));
            a.gameObject.SetActive(false);
            Assert.IsTrue(InputOwner.Owns(b));
        }

        [Test]
        public void ADestroyedOwnerHandsOverToo()
        {
            var a = Spawn("a");
            var b = Spawn("b");
            InputOwner.Register(a);
            InputOwner.Register(b);
            var gone = a.gameObject;
            objects.Remove(gone);
            Object.DestroyImmediate(gone);
            Assert.IsTrue(InputOwner.Owns(b));
        }

        [Test]
        public void AViewThatComesBackIsTheNewestAgain()
        {
            var a = Spawn("a");
            var b = Spawn("b");
            InputOwner.Register(a);
            InputOwner.Register(b);
            a.enabled = false;
            Assert.IsTrue(InputOwner.Owns(b));
            // Re-enabled and polling again: it registers behind b, and b keeps input.
            a.enabled = true;
            InputOwner.Register(a);
            Assert.IsTrue(InputOwner.Owns(b));
            b.enabled = false;
            Assert.IsTrue(InputOwner.Owns(a));
        }

        [Test]
        public void ExplicitUnregisterFallsBackTheSameWay()
        {
            var a = Spawn("a");
            var b = Spawn("b");
            InputOwner.Register(a);
            InputOwner.Register(b);
            InputOwner.Unregister(a);
            Assert.IsTrue(InputOwner.Owns(b));
            InputOwner.Unregister(b);
            Assert.IsNull(InputOwner.Owner);
        }

        [Test]
        public void ASingleViewBehavesAsIfTheRuleWereNotThere()
        {
            var a = Spawn("a");
            InputOwner.Register(a);
            Assert.IsTrue(InputOwner.Owns(a));
            InputOwner.Claim(a);
            Assert.IsTrue(InputOwner.Owns(a));
            Assert.IsFalse(InputOwner.Owns(null));
        }

        [Test]
        public void ADisabledViewCannotRegister()
        {
            var a = Spawn("a");
            a.enabled = false;
            InputOwner.Register(a);
            Assert.IsNull(InputOwner.Owner);
            Assert.IsFalse(InputOwner.Owns(a));
        }
    }
}
