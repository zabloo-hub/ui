#include <string>
#include <vector>

#include "assets.h"
#include "testing.h"
#include "validate.h"
#include "view.h"

using namespace zabloo;

namespace {

/**
 * Two ids over one set of bytes, plus a third image and a sizeless entry.
 *
 * `data` is not a real PNG anywhere here on purpose: the core never decodes, so
 * what a test of this file can honestly assert is identity and size — the two
 * things layout runs on.
 */
const char *MANIFEST = R"({"v":1,"assets":{
  "icons/coin.png":{"hash":"aaa","mime":"image/png","size":3,"width":32,"height":16,"data":"AAEC"},
  "icons/gold.png":{"hash":"aaa","mime":"image/png","size":3,"width":32,"height":16,"data":"AAEC"},
  "images/banner.png":{"hash":"bbb","mime":"image/png","size":3,"width":64,"height":16,"data":"//8="},
  "fonts/ui.ttf":{"hash":"ccc","mime":"font/ttf","size":3,"data":"TQ=="}},
  "views":{"blank":{"type":"Container"}}})";

Envelope parsed(const char *json) {
  EnvelopeReport report = read_envelope(json);
  CHECK(report.ok);
  return std::move(report.envelope);
}

}  // namespace

TEST(assets, base64_round_trips_the_bytes_it_was_given) {
  const Envelope envelope = parsed(MANIFEST);
  const AssetEntry *coin = envelope.asset("icons/coin.png");
  CHECK(coin != nullptr);
  const std::vector<uint8_t> bytes = decode_asset_data(*coin);
  CHECK_EQ(bytes.size(), 3u);
  CHECK_EQ(static_cast<int>(bytes[0]), 0);
  CHECK_EQ(static_cast<int>(bytes[1]), 1);
  CHECK_EQ(static_cast<int>(bytes[2]), 2);

  // Padding shortens the run rather than producing a stray byte.
  const std::vector<uint8_t> padded = decode_asset_data(*envelope.asset("images/banner.png"));
  CHECK_EQ(padded.size(), 2u);
  CHECK_EQ(static_cast<int>(padded[0]), 255);
  CHECK_EQ(static_cast<int>(padded[1]), 255);
  CHECK_EQ(decode_asset_data(*envelope.asset("fonts/ui.ttf")).size(), 1u);
}

TEST(assets, an_entry_with_no_inline_data_decodes_to_nothing_instead_of_throwing) {
  // The deferred-resolution case the schema left room for (`data` is optional so
  // the platform can serve bytes by hash) and nothing implements yet. Asking for
  // bytes that are not here answers none of them, inside a frame that goes on.
  AssetEntry entry;
  entry.hash = "ddd";
  entry.mime = "image/png";
  CHECK(decode_asset_data(entry).empty());
}

TEST(assets, two_ids_over_the_same_bytes_are_one_asset) {
  const Envelope envelope = parsed(MANIFEST);
  ImageLibrary images(envelope);
  const ImageAsset *coin = images.get("asset:icons/coin.png");
  const ImageAsset *gold = images.get("asset:icons/gold.png");
  CHECK(coin != nullptr);
  // Same address, so the tessellator opens ONE batch for both — the whole reason
  // the cache is keyed by hash and not by id.
  CHECK(coin == gold);
  CHECK_EQ(images.all().size(), 1u);

  CHECK(images.get("asset:images/banner.png") != coin);
  CHECK_EQ(images.all().size(), 2u);
  // Idempotent: measure and paint both ask, every frame.
  CHECK(images.get("asset:icons/coin.png") == coin);
  CHECK_EQ(images.all().size(), 2u);
}

TEST(assets, an_asset_carries_the_manifests_intrinsic_size) {
  const Envelope envelope = parsed(MANIFEST);
  ImageLibrary images(envelope);
  const ImageAsset *coin = images.get("asset:icons/coin.png");
  CHECK(coin != nullptr);
  CHECK_EQ(coin->width, 32.0);
  CHECK_EQ(coin->height, 16.0);
  CHECK_EQ(coin->hash, std::string("aaa"));
  CHECK_EQ(coin->mime, std::string("image/png"));
  CHECK(coin->entry != nullptr);
}

TEST(assets, a_ref_that_does_not_resolve_is_null_and_not_a_diagnostic) {
  // `validate.cpp` already warned about the dangling ref once, at load, with the
  // node's path on it. Repeating that per frame would bury the line that matters.
  const Envelope envelope = parsed(MANIFEST);
  ImageLibrary images(envelope);
  CHECK(images.get("asset:icons/missing.png") == nullptr);
  CHECK(images.get("icons/coin.png") == nullptr);
  CHECK(images.get("") == nullptr);
  CHECK(images.all().empty());
}

TEST(assets, a_decoded_size_only_ever_fills_a_gap_the_manifest_left) {
  const Envelope envelope = parsed(MANIFEST);
  ImageLibrary images(envelope);
  // The adapter reaches its assets through `all()`, which is where the write
  // side of this back-channel lives; `get()` is the read side and stays const.
  CHECK(images.get("asset:icons/coin.png") != nullptr);
  CHECK(images.get("asset:fonts/ui.ttf") != nullptr);
  ImageAsset &sized = *images.all()[0];
  ImageAsset &sizeless = *images.all()[1];

  // The manifest wins: it is what layout already reserved.
  CHECK(!images.adopt_size(sized, 8, 8));
  CHECK_EQ(sized.width, 32.0);

  CHECK_EQ(sizeless.width, 0.0);
  CHECK(images.adopt_size(sizeless, 20, 10));
  CHECK_EQ(sizeless.width, 20.0);
  CHECK_EQ(sizeless.height, 10.0);
  // Once filled it is a manifest size like any other, so a second report is a
  // no-op rather than a relayout nobody asked for.
  CHECK(!images.adopt_size(sizeless, 99, 99));
  CHECK_EQ(sizeless.width, 20.0);
}

TEST(assets, a_decode_that_reports_nothing_usable_leaves_the_gap_open) {
  const Envelope envelope = parsed(MANIFEST);
  ImageLibrary images(envelope);
  CHECK(images.get("asset:fonts/ui.ttf") != nullptr);
  ImageAsset &sizeless = *images.all()[0];
  CHECK(!images.adopt_size(sizeless, 0, 0));
  CHECK_EQ(sizeless.width, 0.0);
}
