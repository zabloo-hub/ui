#include "corpus.h"

#include "testing.h"

namespace zabloo::testing {

std::string corpus_file(const std::string &relative) {
  return read_file(repo_root() + "/golden/" + relative);
}

JsonRef corpus_cases() {
  // Held by value for the life of the process: a `JsonRef` is a cursor into its
  // document, so every ref handed out below would dangle the moment it was rebuilt.
  static const JsonParse parsed = JsonDoc::parse(corpus_file("cases.json"));
  return parsed.doc.root();
}

DataValue to_data_value(JsonRef value) {
  if (value.is_bool()) return DataValue::of_bool(value.as_bool());
  if (value.is_number()) return DataValue::of_number(value.as_number());
  if (value.is_string()) return DataValue::of_text(std::string(value.as_string()));
  if (value.is_array()) {
    DataValue out = DataValue::array();
    for (uint32_t i = 0; i < value.size(); i++) out.push(to_data_value(value.at(i)));
    return out;
  }
  if (value.is_object()) {
    DataValue out = DataValue::object();
    for (uint32_t i = 0; i < value.size(); i++) {
      out.insert(std::string(value.key_at(i)), to_data_value(value.at(i)));
    }
    return out;
  }
  return DataValue();
}

}  // namespace zabloo::testing
