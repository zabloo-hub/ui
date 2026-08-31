#include "assets.h"

namespace zabloo {
namespace {

/** Base64 value of a character, or -1 for anything that is not one. */
int base64_value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

}  // namespace

std::vector<uint8_t> decode_asset_data(const AssetEntry &entry) {
  std::vector<uint8_t> out;
  if (!entry.has_data) return out;
  out.reserve(entry.data.size() / 4 * 3);

  // Four characters carry three bytes. Padding and anything that is not a base64
  // character simply end the run: the validator already refused a malformed
  // string, so this is a floor and not a parser.
  uint32_t bits = 0;
  int filled = 0;
  for (const char c : entry.data) {
    const int value = base64_value(c);
    if (value < 0) break;
    bits = (bits << 6) | static_cast<uint32_t>(value);
    filled += 6;
    if (filled >= 8) {
      filled -= 8;
      out.push_back(static_cast<uint8_t>((bits >> filled) & 0xFF));
    }
  }
  return out;
}

const ImageAsset *ImageLibrary::get(std::string_view src) {
  if (!is_asset_ref(src)) return nullptr;
  const AssetEntry *entry = envelope_->asset(asset_id_from_ref(src));
  if (entry == nullptr) return nullptr;

  for (const std::unique_ptr<ImageAsset> &asset : assets_) {
    if (asset->hash == entry->hash) return asset.get();
  }

  auto asset = std::make_unique<ImageAsset>();
  asset->hash = entry->hash;
  asset->mime = entry->mime;
  asset->width = entry->width.value_or(0.0);
  asset->height = entry->height.value_or(0.0);
  asset->entry = entry;
  assets_.push_back(std::move(asset));
  return assets_.back().get();
}

bool ImageLibrary::adopt_size(ImageAsset &asset, double width, double height) {
  const bool missing = !(asset.width > 0.0) || !(asset.height > 0.0);
  if (!missing || !(width > 0.0) || !(height > 0.0)) return false;
  asset.width = width;
  asset.height = height;
  return true;
}

}  // namespace zabloo
