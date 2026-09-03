/*
 * The header compiled as C, and nothing else.
 *
 * `zabloo.h` promises to be C11, and this translation unit is what keeps the
 * promise: it is built by the C compiler (`$CC`, `-std=c11`, warnings as errors
 * in CI) and includes the header alone. A `bool`, a default argument, an
 * `enum class` or a reference slipping into the header breaks here, at the
 * moment it is written, instead of in the first binding that reads it.
 *
 * It also uses one function, so the linker checks the C spelling of a symbol
 * matches what the C++ side exported under `extern "C"`.
 */

#include "zabloo.h"

/* Referenced from the test runner so the object is not discarded as unused. */
const char *zabloo_capi_header_compiles_as_c(void) { return zb_version(); }
