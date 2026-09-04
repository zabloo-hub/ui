using System;
using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Zabloo.Tests
{
    /// <summary>
    /// A steady frame allocates nothing — the C# reading of the core's
    /// <c>buffer_growths == 0</c> (G15). The adapter reads the core's arrays as
    /// <c>NativeArray</c> views and keeps its meshes, materials and renderers from
    /// one frame to the next, so once a screen has warmed up, a frame that runs
    /// the whole pipeline (<c>MarkDirty</c> every frame) and a frame that skips it
    /// must both leave the managed heap exactly where it was. This is what
    /// catches a <c>new</c> per batch slipping into the render layer, or a
    /// closure per poll into the input layer, months from now.
    ///
    /// Measured from two probes with fixed execution order around the view's
    /// <c>Update</c> — not from the test's own coroutine, which resumes after
    /// every <c>Update</c> and whose machinery is not what is being measured.
    /// Needs the native plugin in <c>Runtime/Plugins/</c> (<c>scons install</c>
    /// in <c>sdk/unity</c>); without it the test is inconclusive rather than red.
    ///
    /// PlayMode only: a frame is a <c>yield return null</c>. Runs on Mono in the
    /// editor, where <see cref="GC.GetAllocatedBytesForCurrentThread"/> counts;
    /// an IL2CPP player's build is checked by hand (sdk/unity/README.md › IL2CPP).
    /// </summary>
    public sealed class AllocationTests
    {
        /// <summary>Frames given to warming up: shader, mesh growth, glyphs reaching the atlas, textures uploading.</summary>
        const int WarmupFrames = 30;

        /// <summary>Frames measured after that. One would do; ten says it is steady and not lucky.</summary>
        const int MeasuredFrames = 10;

        /// <summary>
        /// A screen with the catalog's usual mix: text, buttons with states, a
        /// toggle with its two slots, a progress bar — enough that the frame has
        /// solids, glyphs and more than one clip group to keep.
        /// </summary>
        const string Probe =
            "{\"v\":1,\"tokens\":{\"color.bg\":\"#0f172a\",\"color.panel\":\"#1e293b\",\"color.text\":\"#e2e8f0\",\"color.accent\":\"#4f46e5\"},"
            + "\"views\":{\"main\":{\"type\":\"Container\",\"id\":\"root\",\"layout\":{\"direction\":\"column\",\"gap\":12,\"padding\":24},"
            + "\"style\":{\"background\":\"{color.bg}\"},\"children\":["
            + "{\"type\":\"Text\",\"id\":\"title\",\"text\":\"Allocation probe\",\"style\":{\"color\":\"{color.text}\",\"fontSize\":24}},"
            + "{\"type\":\"Container\",\"id\":\"panel\",\"clip\":true,\"layout\":{\"direction\":\"row\",\"gap\":8,\"padding\":12},"
            + "\"style\":{\"background\":\"{color.panel}\",\"radius\":8},\"children\":["
            + "{\"type\":\"Button\",\"id\":\"one\",\"autofocus\":true,\"onPress\":\"one\",\"layout\":{\"padding\":8},\"style\":{\"background\":\"{color.accent}\",\"radius\":4},"
            + "\"states\":{\"focused\":{\"style\":{\"borderWidth\":2,\"borderColor\":\"#ffffff\"}}},\"children\":[{\"type\":\"Text\",\"text\":\"One\",\"style\":{\"color\":\"{color.text}\"}}]},"
            + "{\"type\":\"Button\",\"id\":\"two\",\"onPress\":\"two\",\"layout\":{\"padding\":8},\"style\":{\"background\":\"{color.accent}\",\"radius\":4},"
            + "\"children\":[{\"type\":\"Text\",\"text\":\"Two\",\"style\":{\"color\":\"{color.text}\"}}]},"
            + "{\"type\":\"Toggle\",\"id\":\"sfx\",\"checked\":true,\"layout\":{\"direction\":\"row\",\"gap\":6,\"align\":\"center\"},\"children\":["
            + "{\"type\":\"Container\",\"layout\":{\"width\":16,\"height\":16},\"style\":{\"background\":\"{color.accent}\",\"radius\":8}},"
            + "{\"type\":\"Container\",\"layout\":{\"width\":16,\"height\":16},\"style\":{\"background\":\"{color.panel}\",\"radius\":8,\"borderWidth\":1,\"borderColor\":\"{color.text}\"}},"
            + "{\"type\":\"Text\",\"text\":\"Sound\",\"style\":{\"color\":\"{color.text}\"}}]}]},"
            + "{\"type\":\"ProgressBar\",\"id\":\"bar\",\"value\":0.6,\"layout\":{\"height\":8},\"style\":{\"background\":\"{color.panel}\",\"radius\":4},"
            + "\"children\":[{\"type\":\"Container\",\"style\":{\"background\":\"{color.accent}\",\"radius\":4}}]}]}}}";

        readonly List<GameObject> objects = new List<GameObject>();

        [TearDown]
        public void TearDown()
        {
            foreach (var go in objects) UnityEngine.Object.Destroy(go);
            objects.Clear();
        }

        [UnityTest]
        public IEnumerator A_still_frame_allocates_nothing()
        {
            return Measure(dirtyEveryFrame: false);
        }

        [UnityTest]
        public IEnumerator A_full_pipeline_frame_allocates_nothing()
        {
            return Measure(dirtyEveryFrame: true);
        }

        IEnumerator Measure(bool dirtyEveryFrame)
        {
            var view = Spawn();
            bool loaded;
            try
            {
                loaded = view.LoadEnvelope(Probe, "main");
            }
            catch (DllNotFoundException)
            {
                Assert.Inconclusive("the native plugin is not installed (`scons install` in sdk/unity)");
                yield break;
            }
            Assert.IsTrue(loaded, "the probe envelope loads");

            var before = view.gameObject.AddComponent<Before>();
            var after = view.gameObject.AddComponent<After>();
            before.View = dirtyEveryFrame ? view : null;

            for (var i = 0; i < WarmupFrames; i++) yield return null;

            long worst = 0;
            for (var i = 0; i < MeasuredFrames; i++)
            {
                yield return null;
                worst = Math.Max(worst, after.Sampled - before.Sampled);
            }
            var stats = view.GetStats();
            Assert.AreEqual(0, stats.BufferGrowths, "no geometry buffer grew in a steady frame");
            Assert.AreEqual(0, worst, dirtyEveryFrame
                ? "a frame that ran the whole pipeline allocated managed memory"
                : "an idle frame allocated managed memory");
        }

        ZablooView Spawn()
        {
            var canvas = new GameObject("alloc-canvas", typeof(Canvas));
            objects.Add(canvas);
            var go = new GameObject("alloc-view", typeof(RectTransform));
            go.transform.SetParent(canvas.transform, false);
            ((RectTransform)go.transform).sizeDelta = new Vector2(480f, 320f);
            return go.AddComponent<ZablooView>();
        }

        /// <summary>
        /// Runs before every other <c>Update</c> in the frame: samples the heap,
        /// and asks for a full frame when the test wants one. <c>MarkDirty</c> sets
        /// a bool, so the sample taken right after it is still "before the view".
        /// </summary>
        [DefaultExecutionOrder(-32000)]
        sealed class Before : MonoBehaviour
        {
            public ZablooView View;
            public long Sampled;

            void Update()
            {
                if (View != null) View.MarkDirty();
                Sampled = GC.GetAllocatedBytesForCurrentThread();
            }
        }

        /// <summary>Runs after every other <c>Update</c>: the view's, and nothing else, sits between the two samples.</summary>
        [DefaultExecutionOrder(32000)]
        sealed class After : MonoBehaviour
        {
            public long Sampled;

            void Update()
            {
                Sampled = GC.GetAllocatedBytesForCurrentThread();
            }
        }
    }
}
