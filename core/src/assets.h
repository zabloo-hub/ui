// The manifest, resolved: `asset:<id>` → an image the tessellator can name.
//
// A port of `packages/renderer-web/src/assets.ts` with its decoder taken out.
// The core NEVER decodes pixels: it has no image codec and does not want one
// (the zero-dependency rule of G2), and it does not need any — layout reads the
// manifest's `width`/`height`, and the corpus compares no pixels. The bytes
// travel to the adapter, which hands them to whatever its engine already has
// (`Image.load_png_from_buffer` in Godot).
//
// So an `ImageAsset` here is an IDENTITY plus a size, and its address is the
// opaque handle a `Batch` carries — the same shape a `GlyphAtlas` has, and for
// the same reason: the tessellator names a texture without knowing what a
// texture is.
//
// Keyed by content hash, never by id. Two ids with the same bytes are one asset,
// so they share a draw call; and a hot-update that re-exports the same image
// keeps the texture the adapter already made for that hash. It is the same
// content-addressed property the platform's future CDN and the dev loop's
// transport are both built on (2026-08-11).

#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "envelope.h"

namespace zabloo {

/** One manifest image, cached by hash. Its address is the texture handle. */
struct ImageAsset {
  std::string hash;
  std::string mime;
  /**
   * Intrinsic size in px, straight from the manifest — which is why an `Image`
   * occupies its space on the very first frame, with nothing decoded.
   *
   * Zero when the manifest omitted them (the export could not read that format's
   * header). The node then measures nothing and paints nothing until the adapter
   * reports what it decoded, through `adopt_size`.
   */
  double width = 0.0;
  double height = 0.0;
  /** The manifest entry, bytes still base64: whoever decodes pays for it once. */
  const AssetEntry *entry = nullptr;
};

/**
 * Bytes out of an entry's inlined `data`.
 *
 * A port of `decodeAssetData`, minus its throw: an entry with no `data` is the
 * deferred-resolution case the schema left room for and nothing implements yet,
 * and the honest answer to "give me bytes that are not here" is none of them,
 * not a crash inside a frame. Whatever reached an `AssetEntry` is well-formed
 * base64 already — `validate.cpp` dropped the entry otherwise.
 */
std::vector<uint8_t> decode_asset_data(const AssetEntry &entry);

class ImageLibrary {
 public:
  explicit ImageLibrary(const Envelope &envelope) : envelope_(&envelope) {}

  /**
   * The asset behind a node's `src`, resolved on first sight and a lookup after.
   * Called from measure and paint, so it stays cheap and idempotent.
   *
   * Null for a ref that does not resolve — the node then paints only its own
   * background, which is the authored placeholder (there is no `loading` state,
   * decision ZAB-13). It does NOT warn: a dangling ref is a property of the
   * payload, and `validate.cpp` already said so once at load time with the
   * node's path attached.
   */
  const ImageAsset *get(std::string_view src);

  /**
   * The live assets, in first-sight order — the list the adapter reconciles its
   * textures against, exactly as it sweeps `FontLibrary::all()`. One mechanism
   * answers "what is new?" and "what is gone?"; see `View::fonts`.
   */
  const std::vector<std::unique_ptr<ImageAsset>> &all() const { return assets_; }

  /**
   * What the adapter decoded, for an entry whose manifest carried no size.
   *
   * The manifest always wins — it is what layout already reserved — so this only
   * ever fills a gap, and returns whether it did, which is the adapter's cue to
   * lay out again. It is the one thing the reference gets for free (it measures
   * the bitmap it just decoded) and the core cannot, having decoded nothing.
   */
  bool adopt_size(ImageAsset &asset, double width, double height);

 private:
  const Envelope *envelope_ = nullptr;
  /** Held behind pointers so an asset's address survives the vector growing. */
  std::vector<std::unique_ptr<ImageAsset>> assets_;
};

}  // namespace zabloo
