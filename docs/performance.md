# Performance

What a zabloo frame costs, what we hold it to, and how to measure it yourself.

There are two halves, and they are kept apart on purpose:

- **Deterministic counts** — draw calls, vertices, live atlases, atlas memory,
  and the frame's own work counters. These are exact counts of what a renderer
  did, so **CI holds a ceiling on them** and a regression fails a pull request.
- **Wall clock** — milliseconds per frame. Measured **by hand**, on one machine,
  comparing a before against an after. CI asserting on time flakes, so it does
  not.

Both are measured on the same scenes, which live in
[`golden/perf/`](../golden/perf/README.md) and are
read by both targets: a thousand-row virtualized list, a wall of wrapped prose, a
panel caught mid-transition, and a populated screen in two shapes — one with a
Spinner running, one with a text field's caret owning the clock alone. They are
960×600, a screen rather than the postcard the golden corpus measures in.

## What the frame counters mean

Every target exposes them under the name its language uses:
`handle.stats()` in `@zabloo/renderer-web`, `ZablooView.get_stats()` in Godot,
`View::stats()` in the core.

| Counter | What it says |
|---|---|
| `drawCalls` / `draw_calls` | Batches with geometry in them — one per texture per clip group, plus one per paint root. |
| `vertices`, `indices` | Geometry across those batches. |
| `atlases` | Live glyph atlases: one point size each, capped at 8. |
| `atlasBytes` / `atlas_bytes` | Bytes of those atlas bitmaps. |
| `resolved` | Nodes the resolve pass visited — the frame's CPU work before layout starts. |
| `textLayouts` / `text_layouts` | Texts actually broken into lines this frame. |
| `bufferGrowths` / `buffer_growths` | Geometry buffers that had to reallocate. |
| `repaintOnly` / `repaint_only` | The frame skipped everything before tessellation. |

The last three are the interesting ones, because **zero is the answer**:

- A steady frame over a static scene must re-wrap **no** text. Every `Text` whose
  content, atlas and options did not move keeps the block it already has, so
  anything above zero is the whole scene being re-broken into lines, every frame.
- A steady frame must grow **no** buffers. The geometry builder lives with the
  view and keeps its arrays, so it writes into last frame's memory.
- A blinking caret must be a **repaint**. A blink is a closed form of the time
  since the last edit, so nothing about the tree, its values or its boxes depends
  on it: the only frames it needs are the two per period where the answer changes,
  and each of those skips straight to tessellation.

These three are asserted in CI, on both targets. They are the ones that catch a
regression the eye never would.

## The budgets

Held in `packages/renderer-web/src/budgets.test.ts` and
`core/tests/test_budgets.cpp`. Each is comfortably above what the scene costs
today, so it fails on a regression and not on an honest new case.

| Budget | Web | Godot / core |
|---|---|---|
| Draw calls, corpus scene | ≤ 24 | ≤ 24 |
| Vertices, corpus scene | ≤ 2.000 | ≤ 2.000 |
| Draw calls, realistic scene | ≤ 12 | ≤ 12 |
| Vertices, realistic scene | ≤ 3.000–13.000, per scene | same |
| Nodes resolved, 1.000-row list | ≤ 120 | ≤ 120 |
| Live atlases | ≤ 3 corpus / ≤ 4 realistic (hard cap 8) | same |
| Atlas memory, corpus scene | ≤ 12 MiB | ≤ 6 MiB |
| Atlas memory, realistic scene | ≤ 16 MiB | ≤ 8 MiB |
| Steady frame: re-wraps, buffer growths | 0 and 0 | 0 and 0 |
| Caret frame | repaint, 0 resolved | repaint, 0 resolved |

Only one row differs, and it is a format and not a saving: the core's atlases are
**LA8** (two bytes a pixel — luminance and coverage) and the browser's are
**RGBA** (four). Same glyphs, same coverage, half the bytes.

## What the scenes cost today

Both targets, same scenes, same frame.

| Scene | Draw calls | Vertices | Atlases | Nodes resolved |
|---|---|---|---|---|
| `list` (1.000 unequal rows, virtualized) | 5 | 3.153 | 3 | 49 |
| `text` (wrapped prose, three sizes) | 4 | 9.015 | 3 | 19 |
| `motion` (at rest) | 2 | 94 | 1 | 4 |
| `dense-loop` (populated + Spinner) | 4 | 5.365 | 2 | 79 |
| `dense-caret` (populated + focused field) | 3 | 5.278 | 2 | 75 |

Every number in that table is **identical on both targets**. So is every corpus
scene but one — sixteen of seventeen agree to the vertex.

The virtualized list is the row worth reading twice: a thousand items, and the
frame's work is bounded by the **viewport** — 15 rows realized, 49 nodes resolved.
Scrolled to the far end it is 58. That is what virtualization buys, stated as a
number CI holds.

### Where the two targets legitimately differ

Two places, both understood, neither a bug:

1. **Atlas memory**, above: LA8 against RGBA.
2. **`assets-image`** is the one corpus scene whose geometry differs — the web
   paints 53 vertices in 2 draw calls where the core produces 127 in 4. The
   browser decodes an image **asynchronously** (`createImageBitmap`), so a frame
   measured right after the mount has not painted any of them yet. The core does
   not decode at all: it emits the batch and hands the bytes to its adapter, which
   is what an engine with a synchronous decoder wants. Layout is unaffected either
   way — an image reserves its box from the manifest's dimensions, which is what
   the manifest records them for — so the corpus metrics still compare byte for
   byte.

## Wall clock

Measured by hand, and only comparable against itself: same machine, same session.
Run `pnpm bench` in `packages/renderer-web/` and `scons target=release bench` in
`core/` — **release, or the number is meaningless**.

Both columns below were taken in one sitting on one machine (a 2019 Intel
MacBook Pro, i5, integrated graphics) with nothing else running. They are not a
claim about your machine; they are what a before-and-after is compared against.

| Frame | Web | Core |
|---|---|---|
| `settings`, full relayout | 0,202 ms | **0,036 ms** |
| Populated screen, full relayout | 0,574 ms | **0,258 ms** |
| Wall of prose, full relayout | 0,526 ms | **0,439 ms** |
| 1.000-row list, one scroll frame | 0,862 ms | **0,179 ms** |
| Spinner running over a populated screen | 0,536 ms | **0,255 ms** |
| Caret flip (a repaint) | 0,320 ms | **0,232 ms** |
| …as a share of a full frame of the same scene | 61 % | 92 % |

The core is between 1,2× and 5,6× faster, which is roughly what a C++ port of a
JavaScript renderer should be and is worth exactly that much: it says the port
did not lose anything, not that anything clever happened.

The last row is the one that repays a second look. A caret repaint skips every
pass before tessellation, and it saves **less** in the core — not because its
repaint is slow, but because the passes it skips are so cheap that tessellation
is nearly the whole frame. The same reading, from the other side: the core's
resolve, measure and arrange together cost about 0,02 ms on a screen where the
browser spends 0,20 ms.

The core's bench deliberately reports no allocation figure. The reference reads
V8's sampling heap profiler for one; there is no equally honest counter in C++,
and a malloc hook would measure the allocator rather than the renderer. What
stands in for it is `buffer_growths`, which is zero in a steady frame by
construction and asserted as such.

## In a real engine

Everything above is the CPU cost of producing a frame, measured without an
engine — which is what makes it portable, and also what it cannot tell you:
whether the geometry reaches a draw call, what the GPU does with it, or whether a
screen holds its frame rate. That needs a running export.

The playground has an unattended bench for it. Export it (see
`examples/godot-playground/README.md`) and run the binary with `-- --zabloo-bench`:
it walks every example, dwells on each, and prints a line per screen.

**macOS, release export, 960×600, Godot 4.6.2, Intel Iris Plus 645
(integrated):**

| Screen | fps | Draw calls | Vertices | Atlases | Texture memory |
|---|---|---|---|---|---|
| `settings-screen` | 120 | 6 (engine: 7) | 1.032 | 5 | 13,7 MiB |
| `showcase` / motion | 120 | 27 (engine: 28) | 7.578 | 5 | 13,7 MiB |
| `showcase` / overlays | 120 | 6 (engine: 7) | 5.617 | 4 | 11,7 MiB |
| `inventory-demo` (400 rows) | 120 | 11 (engine: 12) | 3.309 | 5 | 13,7 MiB |

Three things that table says:

- **The renderer is not the limit.** Every screen sits at the display's cap on a
  machine with integrated graphics from 2019 — including the list of 400 rows and
  the screen with four transitions and a Spinner running. The headroom above 120
  is not measured, because a cap hides it.
- **The engine adds exactly one draw call**, every time: the extra is the
  viewport's own. The core's count and the engine's agree otherwise, which is what
  says the adapter is grouping the geometry the way the core handed it over — one
  canvas item per clip group, one call per batch, nothing invented in between.
- **Texture memory is mostly not ours.** Godot reports 11,7–13,7 MiB against
  glyph atlases costing 2 MiB each; the rest is the engine's own.

There is no CPU-time column on purpose. Godot's `TIME_PROCESS` counts the whole
frame, vsync wait included, so under a display cap it reads ~16 ms for every
screen and tells you nothing. What a frame costs on the CPU is measured where no
engine can blur it, in the table above it.

### Unity

The Unity playground has the same bench (`examples/unity-playground/Assets/Bench/`):
build a player and launch it with `-zabloo-bench` (see
`sdk/unity/README.md` › *The bench*). It prints the same columns — the core's
counters read through the C ABI, next to the engine's draw calls from the
profiler's render counter and `Texture.currentTextureMemory` — after the same
warm-up, with vsync off. **B** shows them live.

**macOS, release player, IL2CPP, 960×600 — not yet measured.** The bench, the
player settings and the procedure exist (UN9, ZAB-202); the machine that wrote
them had no Unity installed, so the rows below are what the first run on a
machine with the editor fills in. Until then this table is a shape, not a
claim:

| Screen | fps | Draw calls | Vertices | Atlases | Texture memory |
|---|---|---|---|---|---|
| `settings-screen` | — | — (engine: —) | — | — | — |
| `showcase` / motion | — | — (engine: —) | — | — | — |
| `showcase` / overlays | — | — (engine: —) | — | — | — |
| `inventory-demo` (400 rows) | — | — (engine: —) | — | — | — |

Two things are known before a number is: the **core's columns** (draw calls,
vertices, atlases) will match Godot's row for row, because they are the same
core producing the same frame — the corpus through the C ABI says so byte by
byte — and the **engine's draw calls** are an upper bound rather than an
equality. A UGUI `Canvas` batches the `CanvasRenderer`s that share a material,
so it may report *fewer* than the core emitted; more would mean the adapter is
splitting what the core handed over, which is the reading the column is for.

## What has been measured where

| Target | Extension builds | Export runs | Frame rate measured |
|---|---|---|---|
| macOS (universal) | yes | yes | yes — the table above |
| Web (wasm side module) | yes | **yes, and it is interactive** | no — see below |
| Linux, Windows | in CI (Linux per PR; all in the weekly prerelease) | not here | no |
| Android, iOS | in CI (weekly prerelease) | **no** | **no** |

And the Unity package (its native core is a plugin, built per platform by CI's
`unity-plugin` job; the players are built by hand because Unity does not run
in CI):

| Target | Plugin builds | Player runs | Frame rate measured |
|---|---|---|---|
| macOS (universal dylib) | in CI | **not yet** — the IL2CPP procedure is written, not run | no |
| Windows x64 | in CI | **not yet** — same | no |
| Linux x64 | in CI | no | no |
| Android arm64-v8a, iOS arm64 | in CI (weekly prerelease) | **no** | **no** |

### Web

Web is experimental by decision (2026-08-24) and its criterion is that it
**loads**. It does: the playground exports with *Extensions Support* on, boots in
the browser, renders `settings-screen` and responds to input — switching tabs
relaid the panel out and moved the focus ring, and the in-page HUD reported the
core's own counters (5 draw calls, 1.103 vertices, 5 atlases, 10 MiB of them)
from wasm.

Getting there needed one thing that is worth writing down, because the failure
does not look like what it is. **The extension has to be built with an Emscripten
whose libc++ matches the one Godot's own web templates were built with.** Built
with a newer one it links fine and then aborts at load:

```
Aborted(Assertion failed: undefined symbol '_ZNSt3__213__hash_memoryEPKvm'.
perhaps a side module was not linked in?)
```

That symbol is `std::__2::__hash_memory` — libc++'s string hashing, which every
`unordered_map<std::string, …>` in the core reaches for. A side module expects it
from the main module, and Godot 4.6.2's templates were built before it existed.
Matching the toolchain (Emscripten **4.0.20** for Godot **4.6.2**) is the whole
fix; there is nothing to change in our code. It is also exactly the peg the
original decision hung web's "experimental" on: the `dlink` chain is not ours to
pin.

The frame rate was **not** measured. The browser was driven remotely, and a tab
that is not frontmost is throttled, so the figure the HUD showed says something
about Chrome's scheduler and nothing about the renderer.

What it costs to ship: **38 MiB** for Godot's own `dlink` main module, 1,5 MiB for
its loader, and **2,0 MiB** for the extension.

**Android and iOS are the gap in this milestone, and it is a gap and not a
finding.** The exit criterion asked for the example screens holding 60 fps on a
mid-range phone; the machine this was done on had no NDK, no connected device and
no Xcode. The extension compiles for both in CI, which stops the toolchains
rotting, and that is all it does — nothing here is evidence about a phone. The
playground's `--zabloo-bench` is what fills those rows in when a device is to
hand (on Android it prints to `adb logcat`); the gap is tracked by ZAB-193,
deliberately outside this milestone.

## The addon's size

| Platform | Library |
|---|---|
| macOS, universal (x86_64 + arm64) | 2,2 MiB |
| Web, wasm side module | 2,0 MiB |

Roughly half of that is a font. The core embeds Liberation Sans (~410 KiB of TTF)
as committed source so it can measure text with no engine, no file system and no
asset pipeline — the frontier the whole core rests on — and the arithmetic of a
universal binary doubles what that costs on macOS. It is the same debt the dev
preview carries for the same reason, and the same fix would serve both: ship the
font as an asset rather than as source.

