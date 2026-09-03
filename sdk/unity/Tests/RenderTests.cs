using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;
using Zabloo.Render;
using Zabloo.Sdk.Interop;

namespace Zabloo.Tests
{
    /// <summary>
    /// What the render layer can be checked for WITHOUT the native core: that the
    /// shader ships, that a mesh takes the vertex layout the core's arrays are
    /// uploaded through, and that a clip group turns a batch into a submesh with
    /// a material. Edit mode, no plugin, no pixels — the pixels are the
    /// playground's (README, "Checking UN4 by hand").
    /// </summary>
    public class RenderTests
    {
        [Test]
        public void TheShaderShipsUnderResources()
        {
            var shader = Resources.Load<Shader>(RenderSurface.ShaderResource);
            Assert.IsNotNull(shader, "Runtime/Shaders/Resources/ZablooCanvas.shader is what every batch draws with");
            Assert.AreEqual("Zabloo/Canvas", shader.name);
            Assert.IsTrue(shader.isSupported, "the shader does not compile on this GPU");
        }

        [Test]
        public void AMeshTakesTheCoreVertexLayout()
        {
            // The one thing this machine could not check when the layout was
            // written: a two-component position in its own stream. If this fails,
            // define ZABLOO_STANDARD_VERTICES (see VertexLayout.cs).
            var mesh = new Mesh();
            try
            {
                mesh.SetVertexBufferParams(4, VertexLayout.Attributes);
                Assert.AreEqual(4, mesh.vertexCount);
                Assert.AreEqual(VertexLayout.PositionDimension, mesh.GetVertexAttributeDimension(VertexAttribute.Position));
                Assert.AreEqual(VertexLayout.PositionStream, mesh.GetVertexAttributeStream(VertexAttribute.Position));
                Assert.AreEqual(VertexLayout.UvStream, mesh.GetVertexAttributeStream(VertexAttribute.TexCoord0));
                Assert.AreEqual(VertexLayout.ColorStream, mesh.GetVertexAttributeStream(VertexAttribute.Color));
                Assert.AreEqual(VertexAttributeFormat.Float32, mesh.GetVertexAttributeFormat(VertexAttribute.Color));
            }
            finally
            {
                Object.DestroyImmediate(mesh);
            }
        }

        [Test]
        public void TheAtlasFormatIsOneChannelAndSupported()
        {
            Assert.IsTrue(GlyphAtlases.Format == TextureFormat.R8 || GlyphAtlases.Format == TextureFormat.Alpha8);
            Assert.IsTrue(SystemInfo.SupportsTextureFormat(GlyphAtlases.Format));
        }

        [Test]
        public unsafe void AGroupUploadsABatchIntoOneSubmeshWithOneMaterial()
        {
            var parent = new GameObject("view", typeof(RectTransform));
            try
            {
                RenderSurface surface = RenderSurface.Create(parent.transform);

                // One triangle, the way the core hands it over: separate arrays,
                // zero-based indices, a colour with the opacity in its alpha.
                float* positions = stackalloc float[6] { 0f, 0f, 10f, 0f, 0f, 10f };
                float* uvs = stackalloc float[6] { 0f, 0f, 1f, 0f, 0f, 1f };
                float* colors = stackalloc float[12] { 1f, 0f, 0f, 1f, 1f, 0f, 0f, 1f, 1f, 0f, 0f, 1f };
                uint* indices = stackalloc uint[3] { 0, 1, 2 };
                var batch = new ZbBatch
                {
                    Positions = positions,
                    Uvs = uvs,
                    Colors = colors,
                    Indices = indices,
                    VertexCount = 3,
                    IndexCount = 3,
                    TextureKind = ZbTextureKind.None,
                    Group = 0,
                };
                var frame = new ZbFrame { Batches = &batch, BatchCount = 1 };

                surface.Upload(in frame, new Vector2(100f, 100f));

                Assert.AreEqual(1, surface.UsedGroups);
                var renderer = surface.transform.GetChild(0).GetComponent<CanvasRenderer>();
                Assert.IsNotNull(renderer);
                Assert.AreEqual(1, renderer.materialCount);
                Assert.AreEqual("Zabloo/Canvas", renderer.GetMaterial(0).shader.name);

                // An empty frame empties the group and keeps it.
                var empty = new ZbFrame { Batches = null, BatchCount = 0 };
                surface.Upload(in empty, new Vector2(100f, 100f));
                Assert.AreEqual(0, surface.UsedGroups);
                Assert.AreEqual(1, surface.transform.childCount, "a group is emptied, not freed");
            }
            finally
            {
                Object.DestroyImmediate(parent);
            }
        }
    }
}
