using System;
using System.Collections.Generic;
using UnityEngine;
using Zabloo.Sdk.Interop;

namespace Zabloo.Render
{
    /// <summary>
    /// The child of a <c>ZablooView</c> that everything painted hangs from: the
    /// pool of clip groups, the glyph atlases and the image textures. A component
    /// rather than a plain object for one reason — it owns GPU objects (meshes,
    /// materials, textures) that Unity does not collect, and <c>OnDestroy</c> is
    /// where they are freed. A child dies with its parent, so the view's own
    /// lifecycle file (UN3) needs no hook for it.
    ///
    /// Its <see cref="RectTransform"/> is the Y flip: anchored top-left, scaled
    /// <c>(1, -1, 1)</c>. The core speaks y-down from the top-left corner and the
    /// Canvas y-up, so a core position placed under this transform lands where the
    /// core meant it, and no vertex is ever rewritten (a flip per vertex would be a
    /// copy).
    /// </summary>
    [AddComponentMenu("")]
    [DisallowMultipleComponent]
    internal sealed class RenderSurface : MonoBehaviour
    {
        GlyphAtlases atlases;
        ImageTextures images;
        Shader shader;
        Canvas canvas;
        readonly List<ClipGroup> groups = new List<ClipGroup>();

        /// <summary>The shader that draws every batch, from <c>Runtime/Shaders/Resources/</c>.</summary>
        public const string ShaderResource = "ZablooCanvas";

        public GlyphAtlases Atlases => atlases;
        public ImageTextures Images => images;

        /// <summary>Clip groups that painted something in the last upload.</summary>
        public int UsedGroups { get; private set; }

        public static RenderSurface Create(Transform parent)
        {
            var gameObject = new GameObject("Zabloo Surface")
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
            rect.localScale = new Vector3(1f, -1f, 1f);
            var surface = gameObject.AddComponent<RenderSurface>();
            surface.Init();
            return surface;
        }

        void Init()
        {
            // Under Resources/ so a player build carries it: a shader nothing in a
            // scene references is stripped, and Shader.Find would then return null
            // in exactly the build that matters.
            shader = Resources.Load<Shader>(ShaderResource);
            if (shader == null)
            {
                Debug.LogError("[zabloo] the Zabloo/Canvas shader is missing from the package's Resources — nothing will draw");
            }
            atlases = new GlyphAtlases();
            images = new ImageTextures();
            canvas = GetComponentInParent<Canvas>();
        }

        /// <summary>
        /// A painted frame onto the Canvas: one group per clip group that drew
        /// something, in the order the core entered them, each with a submesh per
        /// batch. The frame's arrays are the core's and are read in place.
        /// </summary>
        public unsafe void Upload(in ZbFrame frame, Vector2 viewSize)
        {
            if (canvas == null) canvas = GetComponentInParent<Canvas>();
            // The clip rects go to the shader in root canvas space — the space the
            // Canvas batches vertices into — so they travel through the same
            // transform the vertices will.
            Matrix4x4 toCanvas = canvas != null
                ? canvas.rootCanvas.transform.worldToLocalMatrix * transform.localToWorldMatrix
                : Matrix4x4.identity;
            float scale = toCanvas.MultiplyVector(Vector3.right).magnitude;
            // Generous on purpose: a child may overflow its parent (a Slider's
            // thumb), and the Canvas needs a box, not a tight one.
            var bounds = new Bounds(
                new Vector3(viewSize.x * 0.5f, viewSize.y * 0.5f, 0f),
                new Vector3(viewSize.x * 3f + 64f, viewSize.y * 3f + 64f, 1f));

            ZbBatch* batches = frame.Batches;
            uint count = frame.BatchCount;
            int used = 0;
            uint i = 0;
            while (i < count)
            {
                // Batches of one group are contiguous, and the ordinal is what
                // separates them. First pass: what the group needs.
                uint ordinal = batches[i].Group;
                uint end = i;
                int vertices = 0, indices = 0, drawable = 0;
                while (end < count && batches[end].Group == ordinal)
                {
                    if (Resolve(in batches[end], out _, out _))
                    {
                        vertices += (int)batches[end].VertexCount;
                        indices += (int)batches[end].IndexCount;
                        drawable++;
                    }
                    end++;
                }

                // A group whose batches all dropped out claims no renderer, and
                // the ones after it move up: the count is not the core's ordinal,
                // but the ORDER is, which is the part that has to survive.
                if (drawable > 0)
                {
                    ClipGroup group = Claim(used++);
                    ClipRegion(batches[i].Clip, in toCanvas, scale, out Vector4 clipRect, out float clipRadius);
                    group.Begin(vertices, indices, drawable, clipRect, clipRadius, bounds);
                    int vertexOffset = 0, indexOffset = 0, slot = 0;
                    for (uint b = i; b < end; b++)
                    {
                        if (!Resolve(in batches[b], out Texture texture, out ZbTextureKind kind)) continue;
                        group.SetBatch(slot++, in batches[b], vertexOffset, indexOffset, texture, kind);
                        vertexOffset += (int)batches[b].VertexCount;
                        indexOffset += (int)batches[b].IndexCount;
                    }
                    group.End();
                }
                i = end;
            }

            // Slots the frame did not need are emptied rather than freed.
            for (int g = used; g < groups.Count; g++) groups[g].Clear();
            UsedGroups = used;
        }

        /// <summary>Nothing on screen: every group emptied, none freed.</summary>
        public void Clear()
        {
            for (int g = 0; g < groups.Count; g++) groups[g].Clear();
            UsedGroups = 0;
        }

        ClipGroup Claim(int index)
        {
            while (groups.Count <= index) groups.Add(new ClipGroup(transform, groups.Count, shader));
            return groups[index];
        }

        /// <summary>
        /// Whether a batch draws, and with what. A solid draws with no texture; a
        /// glyph run with its atlas; an image only once its texture exists — a
        /// decode that failed (or has not happened) skips the batch, which leaves
        /// the node's authored background showing underneath (ZAB-13).
        /// </summary>
        unsafe bool Resolve(in ZbBatch batch, out Texture texture, out ZbTextureKind kind)
        {
            kind = batch.TextureKind;
            switch (kind)
            {
                case ZbTextureKind.Glyphs:
                    texture = atlases.Get(batch.Texture);
                    return true;
                case ZbTextureKind.Image:
                    texture = images.Get(batch.Texture);
                    return texture != null;
                default:
                    texture = null;
                    kind = ZbTextureKind.None;
                    return true;
            }
        }

        /// <summary>The core's clip region (view space, y-down) as the shader wants it (root canvas space).</summary>
        static unsafe void ClipRegion(ZbClip* clip, in Matrix4x4 toCanvas, float scale, out Vector4 rect, out float radius)
        {
            if (clip == null)
            {
                rect = ClipGroup.Unclipped;
                radius = 0f;
                return;
            }
            // A region an intersection collapsed has a non-positive extent; it is
            // handed on as empty rather than backwards.
            float width = clip->Width > 0.0 ? (float)clip->Width : 0f;
            float height = clip->Height > 0.0 ? (float)clip->Height : 0f;
            Vector3 a = toCanvas.MultiplyPoint3x4(new Vector3((float)clip->X, (float)clip->Y, 0f));
            Vector3 b = toCanvas.MultiplyPoint3x4(new Vector3((float)clip->X + width, (float)clip->Y + height, 0f));
            float minX = Mathf.Min(a.x, b.x), maxX = Mathf.Max(a.x, b.x);
            float minY = Mathf.Min(a.y, b.y), maxY = Mathf.Max(a.y, b.y);
            rect = new Vector4(minX, minY, maxX - minX, maxY - minY);
            radius = (float)clip->Radius * scale;
        }

        void OnDestroy()
        {
            for (int g = 0; g < groups.Count; g++) groups[g].Dispose();
            groups.Clear();
            atlases?.Dispose();
            images?.Dispose();
            atlases = null;
            images = null;
        }

        /// <summary>Destroys a Unity object in play mode and in the editor alike (a test runs in edit mode).</summary>
        internal static void Free(UnityEngine.Object target)
        {
            if (target == null) return;
            if (Application.isPlaying) Destroy(target);
            else DestroyImmediate(target);
        }
    }
}
