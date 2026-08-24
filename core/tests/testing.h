// The test harness, in one header and one translation unit.
//
// Vendoring doctest or Catch2 would have been the comfortable choice; this is
// deliberately not that. The `core-tests` job is the one that fails on every PR,
// so it is the one that has to be fast, and a 10k-line header in every test TU is
// a tax on the fastest feedback loop in the milestone. What a test actually needs
// — declare a case, compare two values, say where it broke — fits here.

#pragma once

#include <cmath>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace zabloo::testing {

using TestFn = void (*)();

struct Registrar {
  Registrar(const char *suite, const char *name, TestFn fn);
};

/** Records a failure and lets the case continue: one run, every problem. */
void report(const char *file, int line, const std::string &message);

/** `argv[1]`, if given, keeps only the cases whose "suite.name" contains it. */
int run_all(int argc, char **argv);

/**
 * The repo root, found by walking up from the working directory until
 * `golden/cases.json` turns up. Baking an absolute path at build time would tie
 * the binary to the machine that compiled it, and CI copies artifacts around.
 */
const std::string &repo_root();

/** File contents, or an empty string. A missing fixture fails its own check. */
std::string read_file(const std::string &path);

// Rendered by CHECK_EQ so a mismatch prints values, not just a line number.
std::string show(bool value);
std::string show(double value);
std::string show(int value);
std::string show(unsigned value);
std::string show(long value);
std::string show(unsigned long value);
std::string show(long long value);
std::string show(unsigned long long value);
std::string show(const char *value);
std::string show(std::string_view value);
std::string show(const std::string &value);

}  // namespace zabloo::testing

#define ZABLOO_CONCAT_INNER(a, b) a##b
#define ZABLOO_CONCAT(a, b) ZABLOO_CONCAT_INNER(a, b)

/** One case. `suite` and `name` are bare words; together they are its filter key. */
#define TEST(suite, name)                                                        \
  static void ZABLOO_CONCAT(zabloo_test_, __LINE__)();                           \
  static const ::zabloo::testing::Registrar ZABLOO_CONCAT(zabloo_reg_, __LINE__)( \
      #suite, #name, &ZABLOO_CONCAT(zabloo_test_, __LINE__));                    \
  static void ZABLOO_CONCAT(zabloo_test_, __LINE__)()

#define CHECK(cond)                                                                \
  do {                                                                             \
    if (!(cond)) ::zabloo::testing::report(__FILE__, __LINE__, "CHECK(" #cond ")"); \
  } while (false)

// Both sides are COPIED, not bound by reference. `report.diagnostics[0].message`
// on a temporary report returns a reference the temporary outlives by nothing —
// a dangling read that reports as a mismatch and sends you hunting in the code
// instead of in the test. Copying a couple of strings per check is cheaper than
// that afternoon.
#define CHECK_EQ(actual, expected)                                             \
  do {                                                                         \
    const auto zabloo_a = (actual);                                            \
    const auto zabloo_b = (expected);                                          \
    if (!(zabloo_a == zabloo_b)) {                                             \
      ::zabloo::testing::report(__FILE__, __LINE__,                            \
                                std::string(#actual) + " == " + #expected +    \
                                    "\n    actual:   " +                       \
                                    ::zabloo::testing::show(zabloo_a) +        \
                                    "\n    expected: " +                       \
                                    ::zabloo::testing::show(zabloo_b));        \
    }                                                                          \
  } while (false)

/**
 * Layout arithmetic lands on values a byte-exact comparison would reject for the
 * last bit of a division. The corpus rounds to 3 decimals for the same reason
 * (`snapshot.ts`), so the default tolerance here matches it.
 */
#define CHECK_NEAR(actual, expected, eps)                                          \
  do {                                                                             \
    const double zabloo_a = static_cast<double>(actual);                           \
    const double zabloo_b = static_cast<double>(expected);                         \
    if (!(std::fabs(zabloo_a - zabloo_b) <= (eps))) {                              \
      ::zabloo::testing::report(__FILE__, __LINE__,                                \
                                std::string(#actual) + " ~= " + #expected +        \
                                    "\n    actual:   " +                           \
                                    ::zabloo::testing::show(zabloo_a) +            \
                                    "\n    expected: " +                           \
                                    ::zabloo::testing::show(zabloo_b));            \
    }                                                                              \
  } while (false)
