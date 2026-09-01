#include <algorithm>

#include "collapse.h"

namespace zabloo {

double closed_height(double header_height, double padding) {
  return std::max(0.0, header_height) + std::max(0.0, padding) * 2.0;
}

double collapse_target(bool open, double natural_height, double closed) {
  if (!open) return closed;
  return std::max(closed, natural_height);
}

}  // namespace zabloo
