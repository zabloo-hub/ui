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
scons target=release bench   # the perf bench — build it optimized or it lies
scons capi            # the C ABI as a shared library — see capi/README.md
scons test capi       # the golden corpus, replayed through the C header alone
scons install-unity   # `capi`, then the host's library into sdk/unity's Plugins/
```

Needs SCons (`pip install scons`) and a C++17 compiler. Nothing else — the font
the text engine rasterizes is embedded as committed source, so no asset pipeline
and no Python are involved in a build. Re-run `python3 scripts/embed_font.py`
only if `assets/fonts/` ever changes, and commit what it writes.

`scons test golden` runs the corpus — see
[`golden/README.md`](../golden/README.md#running-the-corpus-against-the-c-core).

`scons bench` runs the perf cases and nothing else. They are ordinary cases in the
same binary, gated on `BENCH` in the environment (the same variable, and the same
reason, as the reference's `pnpm bench`): their output is for a human comparing a
before and an after on one machine, so they must not run in CI, where wall clock
flakes. What CI *does* hold is the deterministic half — draw calls, geometry,
atlas memory, and the counters of a steady frame — in `tests/test_budgets.cpp`.
Both read the scenes of [`golden/perf/`](../golden/perf/README.md), and
[`docs/performance.md`](../docs/performance.md) puts the numbers next to the web's.

## What is in here

| | |
|---|---|
| `json.{h,cpp}` | A JSON reader written for one job: feeding the validator. No exceptions, insertion order preserved, a depth cap that answers instead of crashing, and a number conversion that does not read the C locale |
| `diagnostics.{h,cpp}` | The 18 codes. The strings are the contract — the same input has to produce the same code here as in `@zabloo/format` |
| `envelope.{h,cpp}` | The IR as the core holds it: 13 node types and every v1 prop |
| `validate.{h,cpp}` | The loader's policy (ZAB-37): repair, never throw, refuse only on a major mismatch |
| `states.{h,cpp}` | The normative state merge order |
| `layout.{h,cpp}` | The v1 Yoga subset, `wrap` included. Pure geometry over resolved inputs |
| `clip.{h,cpp}` | The region a subtree is cut to, and the arena that gives each one a stable identity |
| `hit.{h,cpp}` | Who is under the pointer, under the regions this frame cut — the one place that keeps paint and input agreeing |
| `scroll.{h,cpp}` | How far the content reaches, and where the overlay indicator sits on it |
| `slider.{h,cpp}` | The rail's math: the range, the snap, the fraction, and where the fill and thumb sit on it |
| `progress.{h,cpp}` | The bar's fill: a fraction of the content box along the main axis |
| `spinner.{h,cpp}` | The wave over the beads, sampled from the loop's phase |
| `collapse.{h,cpp}` | The two heights a section animates between |
| `groups.{h,cpp}` | The `group` vocabulary, and the Toggle's two slots |
| `focus.{h,cpp}` | The spatial navigation score, and the scroll a revealed node asks for |
| `data.{h,cpp}` | The store a path addresses into, and the prefix index a write drops |
| `bindings.{h,cpp}` | Where a bound path resolves, inside an item scope or out of one |
| `easing.{h,cpp}` | The four closed-form curves, so parity between targets is arithmetic |
| `transition.{h,cpp}` | The engine: one track per animatable value, retargeted on change |
| `ttf.{h,cpp}` | The rasterizer: stb_truetype over the shipped TTF, with the unit contract every target shares |
| `glyphs.{h,cpp}` | The atlas we own — packing, growth, the kerning cache — and the LRU of one per point size |
| `text.{h,cpp}` | The normative wrap: break points, hard breaks, `maxLines`, ellipsis, alignment |
| `utf8.{h,cpp}` | Strings walked by code point, which is the unit everything above indexes |
| `assets.{h,cpp}` | The manifest resolved: `asset:<id>` → an image, cached by content hash. Carries bytes and sizes, and decodes no pixels — that is the adapter's engine's job |
| `tessellator.{h,cpp}` | Implicit paint: rounded rects, inset borders and image quads, into batches |
| `view.{h,cpp}` | The runtime — resolve, lay out, paint, hit-test — and `Document`, the stable handle |
| `color.{h,cpp}` | `#rrggbb[aa]` and the multiplicative opacity fade |
| `snapshot.{h,cpp}` | The `ViewSnapshot`: one frame's metrics as the bytes a golden file holds |
| `vendor/` | stb_truetype, verbatim — see [its README](src/vendor/README.md) |
| `generated/` | The embedded TTF, written by `scripts/embed_font.py` and committed |
| `capi/` (beside `src/`) | The **C ABI** over all of the above (`zabloo.h`): the door Unity — and anything with an FFI — comes in by. Wraps `view.h`, never edits it. See [`capi/README.md`](capi/README.md) |

## The rule this directory lives by

If a file in here would need to ask an engine something, it belongs in
`sdk/<engine>/` instead. The test for it is mechanical: the corpus runs against
this code alone, so anything that leaks into an adapter falls out of that net by
itself.
