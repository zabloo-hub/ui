using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;
using Zabloo.Sdk.Interop;

namespace Zabloo.Render
{
    /// <summary>
    /// The manifest images as Unity textures — the translation of the Godot
    /// adapter's <c>sync_images()</c> and <c>decode()</c>.
    ///
    /// The core carries the ENCODED bytes and decodes nothing: the engine's own
    /// codec (<see cref="ImageConversion.LoadImage(Texture2D, byte[], bool)"/>)
    /// turns them into pixels, once per content HASH. A hot-update rebuilds every
    /// core-side address, so keying by handle alone would decode the same picture
    /// on every reload; keyed by hash, an image whose bytes did not change keeps
    /// its texture across a <c>Reload</c>, and two ids with the same bytes share
    /// one. The handle index is a fast path over the hash map — a hash is a
    /// string, and building one per image per frame would allocate.
    ///
    /// A decode that fails is remembered, and its batches are skipped: the node
    /// keeps showing the <c>background</c> it painted underneath, which is the
    /// authored placeholder (ZAB-13). Drawing the batch would hand Unity a white
    /// texture instead — a solid tinted rectangle where a picture was meant to be.
    /// </summary>
    internal sealed class ImageTextures : IDisposable
    {
        sealed class Cached
        {
            public string Hash;
            public Texture2D Texture;
            public bool Failed;
            public int Stamp;
        }

        readonly Dictionary<string, Cached> byHash = new Dictionary<string, Cached>();
        readonly Dictionary<IntPtr, Cached> byHandle = new Dictionary<IntPtr, Cached>();
        readonly List<IntPtr> staleHandles = new List<IntPtr>();
        readonly List<string> staleHashes = new List<string>();
        int stamp;

        /// <summary>How many distinct images are decoded right now.</summary>
        public int Count => byHash.Count;

        /// <summary>
        /// The texture a batch of kind <c>Image</c> names, or null when it is not
        /// drawable — never decoded, or decoded and failed. Null means skip the batch.
        /// </summary>
        public Texture2D Get(IntPtr handle)
        {
            return byHandle.TryGetValue(handle, out var cached) ? cached.Texture : null;
        }

        /// <summary>
        /// The sweep. Call after <c>zb_view_paint</c>, which is what sweeps the
        /// core's side. Returns true when a decode filled a size the manifest did
        /// not carry — the cue to lay out again before drawing, because a box that
        /// was zero wide until now changes what the whole tree measures.
        /// </summary>
        public unsafe bool Sync(IntPtr view)
        {
            stamp++;
            bool adopted = false;
            uint count = NativeMethods.zb_view_image_count(view);
            for (uint i = 0; i < count; i++)
            {
                if (NativeMethods.zb_view_image_info(view, i, out ZbImageInfo info) == 0) continue;

                // The handle is the fast path, and it is verified: a reload frees the
                // old handles, and an allocator may hand a new image the address an
                // old one had. The hash is the identity; the handle is a hint.
                if (!byHandle.TryGetValue(info.Handle, out Cached cached) || !SameHash(cached.Hash, in info.Hash))
                {
                    string hash = Utf8(in info.Hash);
                    if (!byHash.TryGetValue(hash, out cached))
                    {
                        cached = Decode(in info, hash);
                        byHash[hash] = cached;
                    }
                    byHandle[info.Handle] = cached;
                }
                cached.Stamp = stamp;

                // What the manifest did not say and the decode knows: the one thing
                // that flows back into the core, and only ever to fill a gap.
                if (cached.Texture != null && (info.Width <= 0 || info.Height <= 0))
                {
                    adopted |= NativeMethods.zb_view_image_adopt_size(
                        view, info.Handle, cached.Texture.width, cached.Texture.height) != 0;
                }
            }

            // What is left over is what the new envelope stopped referencing (or a
            // handle a reload retired). Dropping the texture is what frees it.
            staleHandles.Clear();
            foreach (var pair in byHandle)
            {
                if (pair.Value.Stamp != stamp) staleHandles.Add(pair.Key);
            }
            for (int i = 0; i < staleHandles.Count; i++) byHandle.Remove(staleHandles[i]);

            staleHashes.Clear();
            foreach (var pair in byHash)
            {
                if (pair.Value.Stamp != stamp) staleHashes.Add(pair.Key);
            }
            for (int i = 0; i < staleHashes.Count; i++)
            {
                Release(byHash[staleHashes[i]].Texture);
                byHash.Remove(staleHashes[i]);
            }
            return adopted;
        }

        static unsafe Cached Decode(in ZbImageInfo info, string hash)
        {
            var cached = new Cached { Hash = hash };
            if (info.ByteCount == 0)
            {
                cached.Failed = true;
                Debug.LogWarning($"[zabloo] asset {hash} carries no bytes to decode");
                return cached;
            }

            string mime = Utf8(in info.Mime);
            if (mime != "image/png" && mime != "image/jpeg")
            {
                // Unity's built-in decoder reads PNG and JPEG; anything else the
                // manifest may declare (WebP) has no codec here.
                cached.Failed = true;
                Debug.LogWarning($"[zabloo] could not decode asset {hash} ({mime}: no decoder in this engine)");
                return cached;
            }

            // The one copy in this file, and it happens once per hash: LoadImage
            // wants a managed array, and the core's bytes are only good until the
            // next paint anyway.
            var bytes = new byte[(int)info.ByteCount];
            Marshal.Copy((IntPtr)info.Bytes, bytes, 0, bytes.Length);

            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false, false)
            {
                name = "zabloo image " + hash,
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
                hideFlags = HideFlags.HideAndDontSave,
            };
            if (!ImageConversion.LoadImage(texture, bytes, true))
            {
                // Remembered as failed, so this warning is said once rather than
                // sixty times a second, and the node paints its background from here on.
                RenderSurface.Free(texture);
                cached.Failed = true;
                Debug.LogWarning($"[zabloo] could not decode asset {hash} ({mime})");
                return cached;
            }
            cached.Texture = texture;
            return cached;
        }

        /// <summary>Byte-for-byte comparison of a core string against a cached one, without allocating. Hashes are hex, so char == byte.</summary>
        static unsafe bool SameHash(string cached, in ZbStr hash)
        {
            if (cached == null || (nuint)cached.Length != hash.Len) return false;
            var data = (byte*)hash.Data;
            for (int i = 0; i < cached.Length; i++)
            {
                if (cached[i] != (char)data[i]) return false;
            }
            return true;
        }

        static unsafe string Utf8(in ZbStr str)
        {
            return str.Len == 0 ? string.Empty : Encoding.UTF8.GetString((byte*)str.Data, (int)str.Len);
        }

        static void Release(Texture2D texture)
        {
            RenderSurface.Free(texture);
        }

        public void Dispose()
        {
            foreach (var pair in byHash) Release(pair.Value.Texture);
            byHash.Clear();
            byHandle.Clear();
        }
    }
}
