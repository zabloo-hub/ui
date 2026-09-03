using System.Collections.Generic;
using Unity.Collections;
using Unity.Collections.LowLevel.Unsafe;
using UnityEngine;
using UnityEngine.Rendering;
using Zabloo.Sdk.Interop;

namespace Zabloo.Render
{
    /// <summary>
    /// One clip group on screen: a child <see cref="GameObject"/> with a
    /// <see cref="CanvasRenderer"/>, a <see cref="Mesh"/> with one submesh per
    /// batch, and one pooled <see cref="Material"/> per submesh slot. The UGUI
    /// spelling of the Godot adapter's <c>clip_item()</c> — a canvas item per
    /// group with its clip armed — and of "one draw per batch".
    ///
    /// The group's identity is its ORDINAL in the frame, never its region: two
    /// adjacent groups may share a region (both unclipped, typically) and still
    /// have to draw one after the other (<c>start_root</c>, G6/G9). Sibling order
    /// under the surface is the draw order, and the pool hands groups out by
    /// index, so a group reused frame after frame keeps its place.
    ///
    /// Why a material per SLOT and not per group: in UGUI the texture lives on the
    /// material and <c>SetMaterial(material, index)</c> is per submesh, so a group
    /// that holds solids, an image and a glyph run needs three instances. They
    /// are pooled with the slot and reused; a still frame touches none.
    /// </summary>
    internal sealed class ClipGroup
    {
        const MeshUpdateFlags Silent = MeshUpdateFlags.DontRecalculateBounds
            | MeshUpdateFlags.DontValidateIndices
            | MeshUpdateFlags.DontNotifyMeshUsers
            | MeshUpdateFlags.DontResetBoneBounds;

        static readonly int MainTexId = Shader.PropertyToID("_MainTex");
        static readonly int TextureKindId = Shader.PropertyToID("_TextureKind");
        static readonly int ClipRectId = Shader.PropertyToID("_ClipRect");
        static readonly int ClipRadiusId = Shader.PropertyToID("_ClipRadius");

        /// <summary>A rect no fragment falls outside of: what an unclipped group is cut to.</summary>
        public static readonly Vector4 Unclipped = new Vector4(-1e7f, -1e7f, 2e7f, 2e7f);

        readonly GameObject gameObject;
        readonly CanvasRenderer renderer;
        readonly Mesh mesh;
        readonly Shader shader;
        readonly List<Material> materials = new List<Material>();

        int vertexCapacity;
        int indexCapacity;

#if ZABLOO_STANDARD_VERTICES
        /// <summary>The three-component positions the mesh takes instead of the core's two (see <see cref="VertexLayout"/>).</summary>
        NativeArray<Vector3> positions;
#endif

        public CanvasRenderer Renderer => renderer;
        public Mesh Mesh => mesh;

        public ClipGroup(Transform parent, int index, Shader shader)
        {
            this.shader = shader;
            gameObject = new GameObject("clip group " + index)
            {
                hideFlags = HideFlags.DontSave | HideFlags.NotEditable,
            };
            var rect = gameObject.AddComponent<RectTransform>();
            rect.SetParent(parent, false);
            rect.anchorMin = new Vector2(0f, 1f);
            rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.anchoredPosition = Vector2.zero;
            rect.sizeDelta = Vector2.zero;
            renderer = gameObject.AddComponent<CanvasRenderer>();
            // A group is never "transparent as a whole" in a way the Canvas could
            // decide for it: the core already skipped what has zero opacity.
            renderer.cullTransparentMesh = false;
            mesh = new Mesh
            {
                name = "zabloo clip group " + index,
                hideFlags = HideFlags.HideAndDontSave,
            };
            mesh.MarkDynamic();
        }

        /// <summary>
        /// Opens the group for a frame: reserves the buffers (they only ever grow),
        /// declares the submesh count, and arms every slot's clip. The rect and the
        /// radius are in ROOT CANVAS space, which is the space the shader sees its
        /// vertices in once the Canvas has batched them.
        /// </summary>
        public void Begin(int vertices, int indices, int batches, Vector4 clipRect, float clipRadius, Bounds bounds)
        {
            if (vertices > vertexCapacity)
            {
                mesh.SetVertexBufferParams(vertices, VertexLayout.Attributes);
                vertexCapacity = vertices;
#if ZABLOO_STANDARD_VERTICES
                if (positions.IsCreated) positions.Dispose();
                positions = new NativeArray<Vector3>(vertices, Allocator.Persistent, NativeArrayOptions.UninitializedMemory);
#endif
            }
            if (indices > indexCapacity)
            {
                mesh.SetIndexBufferParams(indices, IndexFormat.UInt32);
                indexCapacity = indices;
            }
            if (mesh.subMeshCount != batches) mesh.subMeshCount = batches;
            mesh.bounds = bounds;

            while (materials.Count < batches)
            {
                materials.Add(new Material(shader)
                {
                    name = "zabloo canvas",
                    hideFlags = HideFlags.HideAndDontSave,
                });
            }
            renderer.materialCount = batches;
            for (int i = 0; i < batches; i++)
            {
                materials[i].SetVector(ClipRectId, clipRect);
                materials[i].SetFloat(ClipRadiusId, clipRadius);
            }
        }

        /// <summary>
        /// One batch into one submesh slot, straight from the core's arrays. The
        /// vertex and index offsets are where this batch's data lands in the
        /// group's buffers; <c>baseVertex</c> on the submesh is what lets the
        /// core's zero-based indices stay as they are.
        /// </summary>
        public unsafe void SetBatch(int slot, in ZbBatch batch, int vertexOffset, int indexOffset, Texture texture, ZbTextureKind kind)
        {
            int count = (int)batch.VertexCount;
            int indexCount = (int)batch.IndexCount;

#if ZABLOO_STANDARD_VERTICES
            float* source = batch.Positions;
            var target = (Vector3*)positions.GetUnsafePtr() + vertexOffset;
            for (int i = 0; i < count; i++) target[i] = new Vector3(source[i * 2], source[i * 2 + 1], 0f);
            mesh.SetVertexBufferData(positions, vertexOffset, vertexOffset, count, VertexLayout.PositionStream, Silent);
#else
            var view = VertexLayout.View<float>(batch.Positions, count * 2);
            mesh.SetVertexBufferData(view, 0, vertexOffset * 2, count * 2, VertexLayout.PositionStream, Silent);
#endif
            var uvs = VertexLayout.View<float>(batch.Uvs, count * 2);
            mesh.SetVertexBufferData(uvs, 0, vertexOffset * 2, count * 2, VertexLayout.UvStream, Silent);
            var colors = VertexLayout.View<float>(batch.Colors, count * 4);
            mesh.SetVertexBufferData(colors, 0, vertexOffset * 4, count * 4, VertexLayout.ColorStream, Silent);
            var indices = VertexLayout.View<uint>(batch.Indices, indexCount);
            mesh.SetIndexBufferData(indices, 0, indexOffset, indexCount, Silent);

            mesh.SetSubMesh(slot, new SubMeshDescriptor(indexOffset, indexCount, MeshTopology.Triangles)
            {
                baseVertex = vertexOffset,
                firstVertex = vertexOffset,
                vertexCount = count,
                bounds = mesh.bounds,
            }, Silent);

            Material material = materials[slot];
            if (material.mainTexture != texture) material.SetTexture(MainTexId, texture);
            material.SetFloat(TextureKindId, (float)kind);
            renderer.SetMaterial(material, slot);
        }

        /// <summary>Hands the frame's mesh to the Canvas.</summary>
        public void End()
        {
            renderer.SetMesh(mesh);
        }

        /// <summary>
        /// Emptied and not freed: a scroller that is momentarily not clipping
        /// anything will want this slot back next frame.
        /// </summary>
        public void Clear()
        {
            renderer.Clear();
        }

        public void Dispose()
        {
            for (int i = 0; i < materials.Count; i++) RenderSurface.Free(materials[i]);
            materials.Clear();
            RenderSurface.Free(mesh);
#if ZABLOO_STANDARD_VERTICES
            if (positions.IsCreated) positions.Dispose();
#endif
            RenderSurface.Free(gameObject);
        }
    }
}
