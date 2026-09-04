using System;
using System.Collections.Generic;
using System.Diagnostics;
using UnityEngine;

namespace Zabloo
{
    /// <summary>
    /// Renders one view of a zabloo envelope inside a UGUI <c>Canvas</c>.
    ///
    /// This is the Unity half of the adapter and nothing more: the core
    /// (<c>libzabloo</c>, the same C++ that drives Godot) owns layout, text,
    /// tessellation, states, bindings and transitions, and this component hands it
    /// a rect, a clock and the player's input, then draws the triangles it gets
    /// back. Unity's own layout is deliberately not used inside the view — anchors
    /// and layout groups would be a second layout system disagreeing with the one
    /// every other target runs. The <see cref="RectTransform"/> gives the core a
    /// size; everything inside it is the core's.
    ///
    /// The class is split into partials so that each concern lands in its own
    /// file (F12, Wave B). This file owns the lifecycle and the frame; the
    /// <c>partial void</c> hooks below are what the other files fill in:
    ///
    /// <list type="table">
    ///   <item><term><c>ZablooView.Render.cs</c></term><description><see cref="Paint"/> — meshes, materials, clip groups.</description></item>
    ///   <item><term><c>ZablooView.Pointer.cs</c>, <c>ZablooView.Keyboard.cs</c></term><description><see cref="PollPointer"/>, <see cref="PollKeyboard"/>.</description></item>
    ///   <item><term><c>ZablooView.Pad.cs</c></term><description><see cref="PollPad"/>.</description></item>
    ///   <item><term><c>ZablooView.Host.cs</c></term><description><see cref="Flush"/>, the public API, and the native handles (<see cref="CreateNative"/>, <see cref="DestroyNative"/>, <see cref="Step"/>).</description></item>
    /// </list>
    ///
    /// A hook that nobody implements compiles to nothing — that is what lets this
    /// scaffold build before any of them exist.
    /// </summary>
    [AddComponentMenu("Zabloo/Zabloo View")]
    [RequireComponent(typeof(RectTransform))]
    [DisallowMultipleComponent]
    public sealed partial class ZablooView : MonoBehaviour
    {
        [SerializeField]
        [Tooltip("The exported envelope (dist/zabloo.ir.json imported as a TextAsset). "
            + "Leave empty to load one from code with LoadEnvelope.")]
        TextAsset envelope;

        [SerializeField]
        [Tooltip("The id of the view to show — the filename of its .tsx in src/views/.")]
        string viewId = "";

        /// <summary>The envelope assigned in the inspector, if any.</summary>
        public TextAsset Envelope => envelope;

        /// <summary>The id of the view this component shows.</summary>
        public string ViewId => viewId;

        /// <summary>
        /// A monotonic clock in milliseconds. The core never asks what time it is —
        /// it is told, once per frame — so this is what it is told. <c>Time.deltaTime</c>
        /// is ignored on purpose: a dropped frame lands a tween where the wall clock
        /// says, not where the sum of deltas got to.
        /// </summary>
        static readonly Stopwatch Clock = Stopwatch.StartNew();

        /// <summary>
        /// Every view alive in this process. The native plugin is never unloaded in
        /// the editor, so a handle that outlives its C# owner is a crash on the next
        /// Play: the domain-unload handler below walks this list and destroys them.
        /// </summary>
        static readonly List<ZablooView> Live = new List<ZablooView>();
        static bool domainHooked;

        // --- Frame state the partials read and write ------------------------------

        /// <summary>The size last handed to the core, in the RectTransform's units.</summary>
        Vector2 size;

        /// <summary>Set by <see cref="Step"/>: the core still has motion in flight.</summary>
        bool animating;

        /// <summary>Set by <see cref="PollPad"/>: a gamepad is connected and being polled.</summary>
        bool padConnected;

        /// <summary>Something changed since the last frame ran — input, data, content, size.</summary>
        bool dirty;

        /// <summary>Whether the native document exists (between OnEnable and OnDisable).</summary>
        bool alive;

        /// <summary>
        /// The native document (<c>zb_document *</c>), or zero. Host.cs creates it in
        /// <see cref="CreateNative"/> and destroys it in <see cref="DestroyNative"/>;
        /// every other partial only reads it.
        /// </summary>
        IntPtr document;

        /// <summary>
        /// The native view (<c>zb_view *</c>), or zero before the first successful
        /// load. Stable for the document's life — a load or a show swaps the view
        /// underneath it, never the handle — so a partial may keep it across frames.
        /// Host.cs writes it; Render, Pointer, Keyboard and Pad read it.
        /// </summary>
        IntPtr view;

        /// <summary>
        /// Asks for a frame. Every mutation of the view ends here — a pushed value,
        /// a pointer move, a resize — so <see cref="Update"/> can stay idle when
        /// nothing did: a still UI costs no frames.
        /// </summary>
        public void MarkDirty()
        {
            dirty = true;
        }

        /// <summary>
        /// Where <see cref="NowMs"/> reads the time from: the stopwatch, unless a test
        /// plants one. The golden runner (UN10) needs the frame it measures to be
        /// the frame the corpus records, and a Spinner's wave or a stick's scroll
        /// are functions of the clock — so it sets this, drives the frames it wants
        /// at the instants it wants, and puts the stopwatch back.
        /// </summary>
        internal static Func<double> NowSource = () => Clock.Elapsed.TotalMilliseconds;

        /// <summary>Milliseconds since the clock started. What <c>set_now</c> receives.</summary>
        public static double NowMs => NowSource();

        // --- Lifecycle ------------------------------------------------------------

        void OnEnable()
        {
            if (!domainHooked)
            {
                domainHooked = true;
                AppDomain.CurrentDomain.DomainUnload += OnDomainUnload;
            }
            Live.Add(this);
            alive = true;
            size = Vector2.zero;
            CreateNative();
            MarkDirty();
        }

        void OnDisable()
        {
            Teardown();
        }

        void OnDestroy()
        {
            Teardown();
        }

        /// <summary>Idempotent: OnDisable and OnDestroy both call it, and so does the domain unload.</summary>
        void Teardown()
        {
            if (!alive) return;
            alive = false;
            animating = false;
            padConnected = false;
            Live.Remove(this);
            DestroyNative();
        }

        static void OnDomainUnload(object sender, EventArgs e)
        {
            // Snapshot: Teardown edits the list.
            foreach (var view in Live.ToArray())
            {
                view.Teardown();
            }
        }

        // --- The frame ------------------------------------------------------------

        void OnRectTransformDimensionsChange()
        {
            MarkDirty();
        }

        void Update()
        {
            if (!alive) return;

            SyncSize();

            // Input is polled every frame a pad is connected — a device is asked,
            // never told — and otherwise only when something already asked for a
            // frame. Pointer and keyboard are event-driven on Unity's side, so
            // their polls are cheap when idle.
            PollPointer();
            PollKeyboard();
            PollPad();

            if (!dirty && !animating && !padConnected) return;
            dirty = false;

            Step(NowMs);
            Paint();
            Flush();
        }

        /// <summary>
        /// Reads the RectTransform and remembers it; <see cref="Step"/> hands it to
        /// the core. A change is a frame: the layout has to run again.
        /// </summary>
        void SyncSize()
        {
            var rect = ((RectTransform)transform).rect;
            var next = new Vector2(Mathf.Max(0f, rect.width), Mathf.Max(0f, rect.height));
            if (next == size) return;
            size = next;
            dirty = true;
        }

        // --- Hooks the other partials implement ------------------------------------

        /// <summary>Creates the native document and view. Host.cs.</summary>
        partial void CreateNative();

        /// <summary>Destroys them. Host.cs. Must tolerate being called with nothing created.</summary>
        partial void DestroyNative();

        /// <summary>
        /// One layout frame: <c>set_size(size)</c>, <c>set_now(nowMs)</c>,
        /// <c>layout_frame()</c>, and <see cref="animating"/> from <c>animating()</c>.
        /// Host.cs.
        /// </summary>
        partial void Step(double nowMs);

        /// <summary>Tessellates and uploads the frame's geometry. Render.cs.</summary>
        partial void Paint();

        /// <summary>Turns this frame's pointer state into the core's intentions. Pointer.cs.</summary>
        partial void PollPointer();

        /// <summary>Turns this frame's keys and text into the core's intentions. Keyboard.cs.</summary>
        partial void PollKeyboard();

        /// <summary>Polls the gamepad and sets <see cref="padConnected"/>. Pad.cs.</summary>
        partial void PollPad();

        /// <summary>Drains actions, data changes and diagnostics into the C# events. Host.cs.</summary>
        partial void Flush();
    }
}
