#include "envelope.h"

#include <string_view>

namespace zabloo {
namespace {

struct TypeName {
  NodeType type;
  const char *name;
};

// One table, read in both directions, so a type can never be spelled two ways.
constexpr TypeName TYPE_NAMES[] = {
    {NodeType::Container, "Container"},     {NodeType::Text, "Text"},
    {NodeType::Button, "Button"},           {NodeType::Collapse, "Collapse"},
    {NodeType::ScrollView, "ScrollView"},   {NodeType::Image, "Image"},
    {NodeType::Toggle, "Toggle"},           {NodeType::Slider, "Slider"},
    {NodeType::TextInput, "TextInput"},     {NodeType::Overlay, "Overlay"},
    {NodeType::Repeat, "Repeat"},           {NodeType::ProgressBar, "ProgressBar"},
    {NodeType::Spinner, "Spinner"},
};

constexpr std::string_view ASSET_PREFIX = "asset:";

}  // namespace

const char *node_type_name(NodeType type) {
  for (const TypeName &entry : TYPE_NAMES) {
    if (entry.type == type) return entry.name;
  }
  return "Unknown";
}

NodeType node_type_from(std::string_view name) {
  for (const TypeName &entry : TYPE_NAMES) {
    if (name == entry.name) return entry.type;
  }
  return NodeType::Unknown;
}

bool is_asset_ref(std::string_view value) {
  return value.size() > ASSET_PREFIX.size() && value.compare(0, ASSET_PREFIX.size(), ASSET_PREFIX) == 0;
}

std::string_view asset_id_from_ref(std::string_view ref) {
  return is_asset_ref(ref) ? ref.substr(ASSET_PREFIX.size()) : std::string_view();
}

const View *Envelope::view(std::string_view id) const {
  for (const View &candidate : views) {
    if (candidate.id == id) return &candidate;
  }
  return nullptr;
}

const TokenValue *Envelope::token(std::string_view name) const {
  for (const auto &entry : tokens) {
    if (entry.first == name) return &entry.second;
  }
  return nullptr;
}

const AssetEntry *Envelope::asset(std::string_view id) const {
  for (const AssetEntry &entry : assets) {
    if (entry.id == id) return &entry;
  }
  return nullptr;
}

}  // namespace zabloo
