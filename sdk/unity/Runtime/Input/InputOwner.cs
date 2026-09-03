using System.Collections.Generic;
using UnityEngine;

namespace Zabloo
{
    /// <summary>
    /// Who gets the keys and the pad, when a scene has more than one
    /// <see cref="ZablooView"/> in it.
    ///
    /// A port of <c>sdk/godot/src/input_owner.{h,cpp}</c> (itself a port of the
    /// web renderer's <c>input/ownership.ts</c>). The pointer is scoped by
    /// construction — a press lands on the view under it — but the keyboard and
    /// the gamepad are not: <c>Keyboard.current</c> and <c>Gamepad.current</c> are
    /// properties of the PROCESS, so two views side by side would each move their
    /// own focus on every arrow and both consume the same pad. That asymmetry is
    /// the bug.
    ///
    /// It lives in the adapter and not in the core on purpose: it is about a
    /// process and its input routing, which is the one thing a <c>ViewSnapshot</c>
    /// cannot describe and therefore the one thing the golden corpus cannot
    /// arbitrate. The core knows about one view at a time, which is exactly right.
    ///
    /// The owner is the first view to register, and touching a view takes it — so
    /// a scene with a single view behaves exactly as if the rule were not here.
    /// Losing ownership goes through the same door as losing the cable: the pad
    /// disconnects from the view that had it (a press in flight cancels, a Slider
    /// being nudged settles) before the next one connects.
    ///
    /// <b>Registration is lazy and the registry prunes.</b> A view registers itself
    /// from its first poll rather than from <c>OnEnable</c>, and a view that has
    /// been disabled or destroyed drops out the next time anybody asks — so there
    /// is no unregister call a view could forget. (One exists for tests and for
    /// anyone who does have a lifecycle hook.) Keyed on <see cref="Behaviour"/>
    /// rather than on the view class so the rule can be tested with any component
    /// and without the native plugin.
    /// </summary>
    public static class InputOwner
    {
        /// <summary>Registered views, in the order they arrived — the head is the fallback owner.</summary>
        static readonly List<Behaviour> Views = new List<Behaviour>();

        static Behaviour owner;

        /// <summary>
        /// A view that is alive. The first one to arrive owns input. Registering
        /// twice is a no-op — a view calls this every frame.
        /// </summary>
        public static void Register(Behaviour view)
        {
            if (!Alive(view)) return;
            Prune();
            if (!Views.Contains(view)) Views.Add(view);
            if (owner == null) owner = view;
        }

        /// <summary>A view leaving: ownership falls back to the oldest one left, or to none.</summary>
        public static void Unregister(Behaviour view)
        {
            Views.Remove(view);
            if (owner == view) owner = Views.Count > 0 ? Views[0] : null;
            Prune();
        }

        /// <summary>
        /// The player touched this view — a press on its surface, wherever it lands —
        /// so it takes the keyboard and the pad. A view that is not registered claims
        /// nothing.
        /// </summary>
        public static void Claim(Behaviour view)
        {
            Prune();
            if (owner == view || !Views.Contains(view)) return;
            owner = view;
        }

        /// <summary>Whether this view is the one reading the keyboard and polling the pad.</summary>
        public static bool Owns(Behaviour view)
        {
            return view != null && Owner == view;
        }

        /// <summary>Who owns input right now, or null with no view alive.</summary>
        public static Behaviour Owner
        {
            get
            {
                Prune();
                return owner;
            }
        }

        /// <summary>
        /// Drops the views that are gone. Called from every entry point: the lists
        /// are one or two long, and it is what stands in for the disable hook a
        /// partial class cannot have.
        /// </summary>
        static void Prune()
        {
            for (var i = Views.Count - 1; i >= 0; i--)
            {
                if (!Alive(Views[i])) Views.RemoveAt(i);
            }
            // Not `owner != null`: a destroyed component IS Unity-null, so that test
            // would skip exactly the owner that has to be replaced, and `Owner` would
            // keep handing out a dead reference.
            if (!Alive(owner)) owner = Views.Count > 0 ? Views[0] : null;
        }

        /// <summary>Not destroyed (Unity's overloaded null), and enabled on an active object.</summary>
        static bool Alive(Behaviour view)
        {
            return view != null && view.isActiveAndEnabled;
        }
    }
}
