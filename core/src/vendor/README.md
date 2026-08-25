# vendor

Third-party code, verbatim. Nothing in here is edited — a local fix would be
invisible the next time the file is updated, so anything we need goes in a
wrapper of ours instead (`core/src/ttf.cpp`).

| | |
|---|---|
| `stb_truetype.h` | v1.26, public domain. The rasterizer every zabloo target runs (decision 2026-08-11, ZAB-15) |
| `stb_truetype_impl.cpp` | The single TU that compiles it — see the comment at its top for why it is alone, and why it is built with warnings off and hidden visibility |

## The second copy

The web renderer vendors **the same file** at
`packages/renderer-web/native/vendor/stb_truetype.h`, where it is compiled to
WASM. They are byte-identical and they move together: rasterizing with two
versions of stb would be exactly the silent divergence core-owned rasterization
exists to prevent, and the golden corpus would catch it as a wall of text
metrics that no longer match.

Copies, and not one shared directory, because each half has to be buildable on
its own: `core/` compiles with SCons and a C++ compiler and nothing else, and
`packages/renderer-web` ships to npm without the repo around it.

Updating stb means replacing both files in the same commit, then running
`core/scons test` and the web renderer's suite — the corpus is what says whether
the two still agree.
