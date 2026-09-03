#include "json_value.h"

#include <cmath>
#include <cstdint>

namespace zabloo::capi {

DataValue data_from_json(JsonRef value) {
  if (value.is_bool()) return DataValue::of_bool(value.as_bool());
  if (value.is_number()) return DataValue::of_number(value.as_number());
  if (value.is_string()) return DataValue::of_text(std::string(value.as_string()));
  if (value.is_array()) {
    DataValue out = DataValue::array();
    for (uint32_t i = 0; i < value.size(); i++) out.push(data_from_json(value.at(i)));
    return out;
  }
  if (value.is_object()) {
    DataValue out = DataValue::object();
    for (uint32_t i = 0; i < value.size(); i++) {
      out.insert(std::string(value.key_at(i)), data_from_json(value.at(i)));
    }
    return out;
  }
  return DataValue();
}

namespace {

const char HEX[] = "0123456789abcdef";

/** A string as a JSON literal, quotes included. */
void write_string(const std::string &text, std::string &out) {
  out.push_back('"');
  for (const char c : text) {
    const unsigned char byte = static_cast<unsigned char>(c);
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      default:
        if (byte < 0x20) {
          out += "\\u00";
          out.push_back(HEX[byte >> 4]);
          out.push_back(HEX[byte & 0xF]);
        } else {
          out.push_back(c);
        }
    }
  }
  out.push_back('"');
}

void write_value(const DataValue &value, std::string &out) {
  switch (value.kind) {
    case DataValue::Kind::Null: out += "null"; return;
    case DataValue::Kind::Bool: out += value.boolean ? "true" : "false"; return;
    case DataValue::Kind::Number:
      // JSON has no spelling for these; `JSON.stringify` writes null and so does this.
      if (std::isnan(value.number) || std::isinf(value.number)) {
        out += "null";
      } else {
        out += number_to_text(value.number);
      }
      return;
    case DataValue::Kind::Text: write_string(value.text, out); return;
    case DataValue::Kind::Array:
      out.push_back('[');
      for (size_t i = 0; i < value.items.size(); i++) {
        if (i > 0) out.push_back(',');
        write_value(value.items[i], out);
      }
      out.push_back(']');
      return;
    case DataValue::Kind::Object:
      out.push_back('{');
      for (size_t i = 0; i < value.items.size(); i++) {
        if (i > 0) out.push_back(',');
        write_string(i < value.keys.size() ? value.keys[i] : std::string(), out);
        out.push_back(':');
        write_value(value.items[i], out);
      }
      out.push_back('}');
      return;
  }
}

}  // namespace

std::string json_from_data(const DataValue &value) {
  std::string out;
  write_value(value, out);
  return out;
}

}  // namespace zabloo::capi
