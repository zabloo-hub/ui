#include "testing.h"

#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

namespace zabloo::testing {
namespace {

struct Case {
  const char *suite;
  const char *name;
  TestFn fn;
};

// A function-local static, not a namespace-scope vector: registrars run during
// static initialization, and across translation units their order is undefined —
// a plain global could still be unconstructed when the first one registers.
std::vector<Case> &registry() {
  static std::vector<Case> cases;
  return cases;
}

int failures_in_case = 0;
int total_failures = 0;

std::string trim_number(double value) {
  char buffer[64];
  std::snprintf(buffer, sizeof(buffer), "%.6g", value);
  return buffer;
}

}  // namespace

Registrar::Registrar(const char *suite, const char *name, TestFn fn) {
  registry().push_back(Case{suite, name, fn});
}

void report(const char *file, int line, const std::string &message) {
  failures_in_case++;
  total_failures++;
  std::printf("    %s:%d: %s\n", file, line, message.c_str());
}

std::string show(bool value) { return value ? "true" : "false"; }
std::string show(double value) { return trim_number(value); }
std::string show(int value) { return std::to_string(value); }
std::string show(unsigned value) { return std::to_string(value); }
std::string show(long value) { return std::to_string(value); }
std::string show(unsigned long value) { return std::to_string(value); }
std::string show(long long value) { return std::to_string(value); }
std::string show(unsigned long long value) { return std::to_string(value); }
std::string show(const char *value) { return std::string("\"") + (value ? value : "") + "\""; }
std::string show(std::string_view value) { return "\"" + std::string(value) + "\""; }
std::string show(const std::string &value) { return "\"" + value + "\""; }

const std::string &repo_root() {
  static const std::string root = [] {
    std::filesystem::path dir = std::filesystem::current_path();
    for (int i = 0; i < 12; i++) {
      if (std::filesystem::exists(dir / "golden" / "cases.json")) return dir.string();
      if (!dir.has_parent_path() || dir.parent_path() == dir) break;
      dir = dir.parent_path();
    }
    return std::string();
  }();
  return root;
}

std::string read_file(const std::string &path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) return {};
  std::ostringstream buffer;
  buffer << file.rdbuf();
  return buffer.str();
}

int run_all(int argc, char **argv) {
  const char *filter = argc > 1 ? argv[1] : nullptr;
  int ran = 0;
  int failed_cases = 0;
  for (const Case &test : registry()) {
    const std::string key = std::string(test.suite) + "." + test.name;
    if (filter != nullptr && key.find(filter) == std::string::npos) continue;
    ran++;
    failures_in_case = 0;
    std::printf("  %s\n", key.c_str());
    test.fn();
    if (failures_in_case > 0) failed_cases++;
  }
  if (total_failures == 0) {
    std::printf("\n%d cases, all green\n", ran);
    return 0;
  }
  std::printf("\n%d cases, %d failed (%d checks)\n", ran, failed_cases, total_failures);
  return 1;
}

}  // namespace zabloo::testing

int main(int argc, char **argv) {
  return zabloo::testing::run_all(argc, argv);
}
