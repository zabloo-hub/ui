using System;
using System.Runtime.InteropServices;
using NUnit.Framework;
using Zabloo.Sdk.Interop;

namespace Zabloo.Tests
{
    /// <summary>
    /// <c>zb_abi_sizes</c> against <c>Marshal.SizeOf</c> of every struct in
    /// <c>NativeMethods.cs</c>: the first thing to run against a freshly built
    /// plugin, and the test that catches a field missing, mistyped or misaligned
    /// on either side of the C ABI BEFORE any corpus case does — a struct whose
    /// size drifted reads garbage where a metric should be, and a golden diff is
    /// a slow way to learn that.
    ///
    /// One test per struct, so the name of the one that fails is the struct to
    /// open. Needs the native plugin (<c>scons install</c> in <c>sdk/unity</c>);
    /// without it the suite is ignored, with the command, rather than red.
    /// </summary>
    public class AbiSizeTests
    {
        ZbAbiSizeTable sizes;

        [SetUp]
        public void ReadTheNativeTable()
        {
            try
            {
                NativeMethods.zb_abi_sizes(out sizes);
            }
            catch (DllNotFoundException)
            {
                Assert.Ignore("the native plugin is not installed — `cd sdk/unity && scons install` after `scons capi` in core/");
            }
        }

        static void Same(uint native, Type managed)
        {
            Assert.AreEqual((int)native, Marshal.SizeOf(managed),
                managed.Name + " is laid out differently in C# than in core/capi/zabloo.h");
        }

        [Test] public void Str() => Same(sizes.Str, typeof(ZbStr));
        [Test] public void Clip() => Same(sizes.Clip, typeof(ZbClip));
        [Test] public void Batch() => Same(sizes.Batch, typeof(ZbBatch));
        [Test] public void Frame() => Same(sizes.Frame, typeof(ZbFrame));
        [Test] public void AtlasInfo() => Same(sizes.AtlasInfo, typeof(ZbAtlasInfo));
        [Test] public void ImageInfo() => Same(sizes.ImageInfo, typeof(ZbImageInfo));
        [Test] public void KeyIntent() => Same(sizes.KeyIntent, typeof(ZbKeyIntent));
        [Test] public void PadSnapshot() => Same(sizes.PadSnapshot, typeof(ZbPadSnapshot));
        [Test] public void Action() => Same(sizes.Action, typeof(ZbAction));
        [Test] public void DataChange() => Same(sizes.DataChange, typeof(ZbDataChange));
        [Test] public void FrameStats() => Same(sizes.FrameStats, typeof(ZbFrameStats));
        [Test] public void Diagnostic() => Same(sizes.Diagnostic, typeof(ZbDiagnostic));
        [Test] public void AbiSizeTable() => Same(sizes.AbiSizeTable, typeof(ZbAbiSizeTable));
        [Test] public void FieldInfo() => Same(sizes.FieldInfo, typeof(ZbFieldInfo));

        [Test]
        public void TheBinarySaysWhichVersionItIs()
        {
            // The `fixed` group's version, stamped at build (UN2) — `0.0.0-dev` for a
            // core built without `packages/` next to it. Empty would mean the
            // symbol resolved to something that is not ours.
            var version = Marshal.PtrToStringAnsi(NativeMethods.zb_version());
            Assert.IsFalse(string.IsNullOrEmpty(version), "zb_version() answered nothing");
        }
    }
}
