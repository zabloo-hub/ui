#!/usr/bin/env bash
#
# Builds stbtt.c to a standalone WASM module and re-generates the embedded
# base64 sources under src/generated/.
#
# Nobody needs to run this to build or test the package: the generated TS is
# committed, so `pnpm build`, `typecheck` and `test` work with no toolchain.
# Re-run it only when stbtt.c, the vendored stb_truetype.h or the shipped TTF
# change — and commit the regenerated files with the change.
#
# Requires emscripten (`brew install emscripten`). Built with emcc 6.0.6.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc not found — install emscripten (brew install emscripten)" >&2
  exit 1
fi

echo "emcc: $(emcc --version | head -1)"

# -Oz            : optimize for size — this ships inside the JS bundle.
# -sSTANDALONE_WASM + --no-entry : a plain WASM module, no emscripten JS glue.
# -sMALLOC=emmalloc              : the small allocator; we allocate rarely.
# -sFILESYSTEM=0                 : no stdio, the font arrives as bytes.
# -sALLOW_MEMORY_GROWTH=1        : big fonts / large glyphs grow past the initial heap.
emcc stbtt.c \
  -o stbtt.wasm \
  -Oz \
  --no-entry \
  -sSTANDALONE_WASM=1 \
  -sMALLOC=emmalloc \
  -sFILESYSTEM=0 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sERROR_ON_UNDEFINED_SYMBOLS=1

echo "built: $(wc -c < stbtt.wasm) bytes"

node ../scripts/embed-binaries.mjs
