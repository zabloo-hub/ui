#include <string>
#include <string_view>

#include "json.h"
#include "testing.h"

using namespace zabloo;

namespace {

JsonParse parse(std::string_view text) { return JsonDoc::parse(text); }

}  // namespace

TEST(json, reads_the_shape_of_an_envelope) {
  const JsonParse result = parse(R"({"v":1,"views":{"hud":{"type":"Container"}}})");
  CHECK(result.ok);
  const JsonRef root = result.doc.root();
  CHECK(root.is_object());
  CHECK_EQ(root.get("v").as_number(), 1.0);
  CHECK_EQ(root.get("views").get("hud").get("type").as_string(), std::string_view("Container"));
}

TEST(json, object_members_keep_their_written_order) {
  // `views` is a map, and which view loads first has to be a property of the
  // file, not of a hash seed.
  const JsonParse result = parse(R"({"z":1,"a":2,"m":3})");
  CHECK(result.ok);
  const JsonRef root = result.doc.root();
  CHECK_EQ(root.size(), 3u);
  CHECK_EQ(root.key_at(0), std::string_view("z"));
  CHECK_EQ(root.key_at(1), std::string_view("a"));
  CHECK_EQ(root.key_at(2), std::string_view("m"));
}

TEST(json, every_accessor_is_total) {
  // The validator reads a hostile payload as a straight line of questions, so
  // asking the wrong one has to answer rather than fail.
  const JsonParse result = parse(R"({"n":5})");
  CHECK(result.ok);
  const JsonRef root = result.doc.root();
  CHECK(!root.get("missing").exists());
  CHECK_EQ(root.get("missing").as_number(7.0), 7.0);
  CHECK_EQ(root.get("n").as_string(), std::string_view(""));
  CHECK_EQ(root.get("n").size(), 0u);
  CHECK(!root.at(9).exists());
  CHECK_EQ(root.get("missing").get("deeper").as_bool(true), true);
}

TEST(json, arrays_index_in_order) {
  const JsonParse result = parse(R"([10,"two",true,null,{"k":1}])");
  CHECK(result.ok);
  const JsonRef root = result.doc.root();
  CHECK_EQ(root.size(), 5u);
  CHECK_EQ(root.at(0).as_number(), 10.0);
  CHECK_EQ(root.at(1).as_string(), std::string_view("two"));
  CHECK_EQ(root.at(2).as_bool(), true);
  CHECK(root.at(3).is_null());
  CHECK_EQ(root.at(4).get("k").as_number(), 1.0);
}

TEST(json, numbers_are_converted_without_a_locale) {
  // The reason the conversion is written by hand: `strtod` would read the
  // decimal separator from the C locale, and a game that sets a Spanish one
  // would turn every fractional metric into an integer.
  const JsonParse result = parse(R"([0.5,0.1,-2.25,1e3,1.5e-2,0,1234567890123,3.0e2])");
  CHECK(result.ok);
  const JsonRef root = result.doc.root();
  CHECK_EQ(root.at(0).as_number(), 0.5);
  CHECK_EQ(root.at(1).as_number(), 0.1);
  CHECK_EQ(root.at(2).as_number(), -2.25);
  CHECK_EQ(root.at(3).as_number(), 1000.0);
  CHECK_EQ(root.at(4).as_number(), 0.015);
  CHECK_EQ(root.at(5).as_number(), 0.0);
  CHECK_EQ(root.at(6).as_number(), 1234567890123.0);
  CHECK_EQ(root.at(7).as_number(), 300.0);
}

TEST(json, escapes_decode_to_utf8) {
  const JsonParse result = parse(R"(["a\"b\\c\n\t","\u00e1\u4e2d","\ud83c\udf10"])");
  CHECK(result.ok);
  const JsonRef root = result.doc.root();
  CHECK_EQ(root.at(0).as_string(), std::string_view("a\"b\\c\n\t"));
  CHECK_EQ(root.at(1).as_string(), std::string_view("\xc3\xa1\xe4\xb8\xad"));
  CHECK_EQ(root.at(2).as_string(), std::string_view("\xf0\x9f\x8c\x90"));
}

TEST(json, an_unpaired_surrogate_becomes_a_replacement_char) {
  // The payload is still renderable; one mangled character is a smaller loss
  // than a screen that refuses to load.
  const JsonParse result = parse(R"(["\ud83c"])");
  CHECK(result.ok);
  CHECK_EQ(result.doc.root().at(0).as_string(), std::string_view("\xef\xbf\xbd"));
}

TEST(json, malformed_input_answers_instead_of_throwing) {
  const char *bad[] = {
      "",            "{",         "{\"a\"}",   "{\"a\":}",     "[1,]",
      "[1 2]",       "\"unterminated", "tru",  "{'a':1}",      "01",
      "{\"a\":1} x", "[1,2",      "\"\\q\"",   "\"\\u00zz\"",
  };
  for (const char *text : bad) {
    const JsonParse result = parse(text);
    CHECK(!result.ok);
    CHECK(!result.error.empty());
  }
}

TEST(json, a_failed_parse_leaves_no_document_behind) {
  const JsonParse result = parse("{\"a\":");
  CHECK(!result.ok);
  CHECK(!result.doc.root().exists());
}

TEST(json, nesting_past_the_cap_is_refused_not_crashed) {
  std::string deep;
  for (int i = 0; i < JsonDoc::MAX_NESTING + 10; i++) deep += '[';
  for (int i = 0; i < JsonDoc::MAX_NESTING + 10; i++) deep += ']';
  const JsonParse result = parse(deep);
  CHECK(!result.ok);
  CHECK(result.error.find("nesting") != std::string::npos);
}

TEST(json, legal_ir_depth_still_parses) {
  // 256 nodes deep is what the validator accepts, and each node level costs
  // three JSON levels. The cap has to sit above that or a legal document would
  // meet it.
  std::string open;
  std::string close;
  for (int i = 0; i < 256; i++) {
    open += R"({"type":"Container","children":[)";
    close += "]}";
  }
  const JsonParse result = parse(open + R"({"type":"Text","text":"x"})" + close);
  CHECK(result.ok);
}
