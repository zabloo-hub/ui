# core

The shared C++ core: **layout · text · tessellation · the IR runtime · the
`ViewSnapshot`**. It is what every engine SDK is a thin adapter over, and it
knows about no engine at all.

That last part is not a style rule, it is the frontier the whole milestone rests
on (decision 2026-08-24):

> **The core has to be able to produce a `ViewSnapshot` with no engine.**

Which is why this directory builds and tests itself with no Godot, no GPU and no
third-party dependency — and why the golden corpus can be its test.

## Build and test

```sh
scons                 # core/bin/libzabloocore.a + core/bin/zabloo-core-tests
scons test            # the above, then run them
scons target=release  # optimized
scons test validate   # only the cases whose name contains "validate"
```

Needs SCons (`pip install scons`) and a C++17 compiler. Nothing else — the font
the text engine rasterizes is embedded as committed source, so no asset pipeline
and no Python are involved in a build. Re-run `python3 scripts/embed_font.py`
only if `assets/fonts/` ever changes, and commit what it writes.

`scons test golden` runs the corpus — see
[`golden/README.md`](../golden/README.md#running-the-corpus-against-the-c-core).

## What is in here

| | |
|---|---|
| `json.{h,cpp}` | A JSON reader written for one job: feeding the validator. No exceptions, insertion order preserved, a depth cap that answers instead of crashing, and a number conversion that does not read the C locale |
| `diagnostics.{h,cpp}` | The 18 codes. The strings are the contract — the same input has to produce the same code here as in `@zabloo/format` |
| `envelope.{h,cpp}` | The IR as the core holds it: 13 node types and every v1 prop |
| `validate.{h,cpp}` | The loader's policy (ZAB-37): repair, never throw, refuse only on a major mismatch |
| `states.{h,cpp}` | The normative state merge order |
| `layout.{h,cpp}` | The v1 Yoga subset, `wrap` included. Pure geometry over resolved inputs |
| `ttf.{h,cpp}` | The rasterizer: stb_truetype over the shipped TTF, with the unit contract every target shares |
| `glyphs.{h,cpp}` | The atlas we own — packing, growth, the kerning cache — and the LRU of one per point size |
| `text.{h,cpp}` | The normative wrap: break points, hard breaks, `maxLines`, ellipsis, alignment |
| `utf8.{h,cpp}` | Strings walked by code point, which is the unit everything above indexes |
| `tessellator.{h,cpp}` | Implicit paint: rounded rects and inset borders, into batches |
| `view.{h,cpp}` | The runtime — resolve, lay out, paint, hit-test — and `Document`, the stable handle |
| `color.{h,cpp}` | `#rrggbb[aa]` and the multiplicative opacity fade |
| `snapshot.{h,cpp}` | The `ViewSnapshot`: one frame's metrics as the bytes a golden file holds |
| `vendor/` | stb_truetype, verbatim — see [its README](src/vendor/README.md) |
| `generated/` | The embedded TTF, written by `scripts/embed_font.py` and committed |

## The rule this directory lives by

If a file in here would need to ask an engine something, it belongs in
`sdk/<engine>/` instead. The test for it is mechanical: the corpus runs against
this code alone, so anything that leaks into an adapter falls out of that net by
itself.
