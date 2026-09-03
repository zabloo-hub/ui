using Unity.Collections;
using Unity.Collections.LowLevel.Unsafe;
using UnityEngine;
using UnityEngine.Rendering;

namespace Zabloo.Render
{
    /// <summary>
    /// The vertex layout a clip group's <see cref="Mesh"/> is declared with, and
    /// the one place a core array becomes something Unity can upload.
    ///
    /// The layout COPIES the core's arrays: position <c>x, y</c>, uv <c>u, v</c>,
    /// color <c>r, g, b, a</c> as floats, each in its own vertex stream. That is
    /// what lets <c>Mesh.SetVertexBufferData</c> take the core's pointers as
    /// <see cref="NativeArray{T}"/> views — no managed copy, no allocation in a
    /// steady frame. The Y axis is NOT flipped here: the core speaks y-down and
    /// the Canvas y-up, and the surface's transform flips (a flip per vertex
    /// would be a copy).
    ///
    /// <b>The one uncertainty this file isolates.</b> Unity's Canvas batches
    /// <c>CanvasRenderer</c> meshes on the CPU, reading their vertex data back. A
    /// two-component position and a float color are both legal mesh attributes,
    /// and the reference for what the batcher accepts is the engine itself, which
    /// this machine could not run (UN4). If the playground shows nothing — or the
    /// console names the vertex layout — define <c>ZABLOO_STANDARD_VERTICES</c>
    /// in Player Settings: positions are then copied into a persistent
    /// three-component scratch (a loop per vertex, still no allocation once
    /// grown), which is the layout every UGUI mesh has. Nothing else changes.
    /// </summary>
    internal static class VertexLayout
    {
#if ZABLOO_STANDARD_VERTICES
        /// <summary>Positions are copied to <c>float3</c>; uv and color stay as views.</summary>
        public const bool CopiesPositions = true;
        public const int PositionDimension = 3;
#else
        /// <summary>Every stream is a view over the core's own array.</summary>
        public const bool CopiesPositions = false;
        public const int PositionDimension = 2;
#endif

        public const int PositionStream = 0;
        public const int UvStream = 1;
        public const int ColorStream = 2;

        public static readonly VertexAttributeDescriptor[] Attributes =
        {
            new VertexAttributeDescriptor(VertexAttribute.Position, VertexAttributeFormat.Float32, PositionDimension, PositionStream),
            new VertexAttributeDescriptor(VertexAttribute.TexCoord0, VertexAttributeFormat.Float32, 2, UvStream),
            new VertexAttributeDescriptor(VertexAttribute.Color, VertexAttributeFormat.Float32, 4, ColorStream),
        };

        /// <summary>
        /// A <see cref="NativeArray{T}"/> over memory the core owns. Nothing is
        /// copied and nothing is freed: the array is a window, valid exactly as
        /// long as the pointer it wraps (until the next paint, for a batch).
        /// </summary>
        public static unsafe NativeArray<T> View<T>(void* data, int length) where T : unmanaged
        {
            var array = NativeArrayUnsafeUtility.ConvertExistingDataToNativeArray<T>(data, length, Allocator.None);
#if ENABLE_UNITY_COLLECTIONS_CHECKS
            // The editor refuses to read a NativeArray without a safety handle. The
            // temp slice handle is the one meant for exactly this: a view that no
            // job owns and that the caller promises not to keep.
            NativeArrayUnsafeUtility.SetAtomicSafetyHandle(ref array, AtomicSafetyHandle.GetTempUnsafePtrSliceHandle());
#endif
            return array;
        }
    }
}
