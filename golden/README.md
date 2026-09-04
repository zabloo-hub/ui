# Golden corpus

Reference envelopes and the metrics every target must reproduce from them.

This directory is **not** part of any package. It sits at the repo root because
it is a **cross-target** artifact: the web renderer measures itself against it
(ZAB-48) and so does the **C++ core** every engine SDK is built on (ZAB-136). An
envelope that lived inside `packages/renderer-web` would be a fixture of the web
test suite; here it is a specification of what the IR means.

```
golden/
├── cases.json        the corpus: one case per capability, and its INPUT
├── envelopes/*.json  hand-written IR envelopes
├── metrics/*.json    what a correct renderer computes from them (generated)
└── perf/             scenes the performance budgets are measured on — NOT cases
```

## A case is five things

A case is `(envelope, data, viewport, clock, pad)` — and nothing else. Everything
the metrics record has to be derivable from those five, or a second target could
not reproduce it.

| Field | Meaning |
|---|---|
| `envelope` | file under `envelopes/` |
| `about` | what this case is a record of — the first thing a reader of a diff needs |
| `data` | pushed through the host data channel (`SetData`) before measuring |
| `width` / `height` | viewport in logical px (default 480×320, dpr 1) |
| `advanceMs` | milliseconds of clock run before measuring, so motion is recorded settled |
| `pad` | gamepad script replayed before measuring — see below |
| `refuses` | this case records a **load**, not a frame — see below |

The pad belongs on that list for the same reason the clock does: a gamepad is a
**state the SDK polls**, not an event of any one platform, so a declarative
script of it replays anywhere. A step is either a change to that state
(`{"press": 13}`, `{"release": 13}`, `{"axis": 3, "value": 1}`) or a span of time
for the poll loop to see it in (`{"advanceMs": 16}`) — and nothing happens until
one of those spans runs, exactly as on a real pad. Indices are the standard
mapping: `0`=A, `1`=B, `12`–`15`=d-pad, axes `0`/`1` left stick, `2`/`3` right.
An engine may number its own buttons differently — Godot's `JoyButton` puts the
d-pad at 11–14 — and translating is the adapter's job, so a script written here
means the same thing on every target.

Two rules the runner applies to every case, and that every other target has to
apply too:

1. **Text is measured with the SDK's own rasterizer** (stb\_truetype over the
   shipped TTF), never a platform one. Same algorithm, same font, same metrics.
2. **One settling frame after the data.** The frame a bound array arrives on is
   the one that *measures* its items; the window over them is computed from those
   measurements on the *next* frame. Measuring the first would record a transient.

## The metrics

`metrics/<case>.json` is a `ViewSnapshot` (see
`packages/renderer-web/src/snapshot.ts`, and `core/src/snapshot.cpp` for the port
of it): layout rects, wrap points with their baselines, active states, resolved
paint values, clipping regions, scroll extents, control values, realized windows
and the overlay layer in paint order. No pixels — golden **images** need a GPU
and stay a manual step (see below); everything here runs on a bare CPU in CI.

Numbers are rounded to 3 decimals so the last bits of a floating-point multiply
never rewrite a file.

## Cases that refuse to load

Not every normative rule of the format produces a frame. A case with `refuses`
records the other kind: the envelope must be **rejected**, with the diagnostic
code it names, and nothing must render. It has no file under `metrics/` — there
is nothing to measure — so the assertion lives in each target's runner instead
(`golden.test.ts`, `core/tests/test_golden.cpp`).

```json
"future-major": {
  "envelope": "future-major.json",
  "about": "…",
  "refuses": { "code": "unsupported-version" }
}
```

Together with `unknown-type` (the degradation rule: an unknown node type renders
as a `Container` preserving `layout`, `style`, `visible`, `disabled` and
`children`), these are the two halves of
[forward-tolerance](../docs/format/loading.md#forward-tolerance-normative) — the
rules a second target is likeliest to get wrong, because they are about content
it was never built for. They are also the seed of the forward-compat corpus of
ZAB-39.

## Working with it

```sh
pnpm --filter @zabloo/renderer-web test          # compare against the corpus
pnpm --filter @zabloo/renderer-web test -- -u    # accept new metrics
```

`-u` rewrites `metrics/`. **The diff is the review** — that is the whole reason
these files are versioned next to the envelopes instead of living inline in a
test. Read it before committing: a rect that moved by a pixel is either the fix
you just made or the regression you just shipped.

Invariants that a careless `-u` could bless away — a modal capturing input, a
drag that must not become a click, an action carrying the item it fired from —
are **not** here. They are hand-written assertions in
`packages/renderer-web/src/view.test.ts`.

## Running the corpus against the C++ core

The core produces a `ViewSnapshot` **with no engine at all** — that is the
frontier decision 2026-08-24 drew — so the same corpus runs against a native
binary on a bare CPU, with no Godot and no GPU:

```sh
cd core && scons test          # everything
cd core && scons test golden   # only the corpus
```

That is the very command CI runs (`core-tests`), and it is the one to run before
committing anything under `core/`.

A failure names the case, the path inside the snapshot and both values, so a diff
reads the same on either target:

```
flex-layout does not reproduce golden/metrics/flex-layout.json
    tree.children[1].rect.width (ref "row-gap"): expected 128, actual 132
    tree.children[1].children[0].style.radius (ref "chip"): expected 6, actual (absent)
```

### Unity: the same corpus, twice more

The Unity adapter reaches the core through its C ABI (`core/capi/`), so the
corpus runs **through the ABI alone** in CI, with no Unity at all — the same
seventeen cases and the refusal, marshalled as C strings and JSON and polled
through `zb_pad_poll`, so that a metric which changes on crossing the boundary
is blamed on the boundary and not on the core:

```sh
cd core && scons test capi
```

And it runs **from inside Unity**, through a real `ZablooView` on a `Canvas`
(`sdk/unity/Tests/Golden/GoldenTests.cs`), which is the only run that sees the
adapter's own plumbing — the size it hands the core, the clock, the JSON writer
a `SetData` goes through, the pad snapshot filled from a synthetic gamepad. Same
byte-for-byte comparison, same diff format. It needs an editor, so it is not in
CI: `sdk/unity/README.md` › *Tests* says how to run it from the Test Runner and
from the command line against `examples/unity-playground`.

### The skip list

`core/tests/golden-skip.json` names the cases the core cannot reproduce **yet**,
each with the capability it is waiting on and the ticket that lands it. It keeps
CI green while F11 is built capability by capability, and **removing your
ticket's line is part of its exit criteria**.

It is a checklist, not a carpet. A skipped case is still replayed, and one that
starts agreeing with its record **fails the suite** asking to be taken off the
list — so the file cannot quietly outlive the gap it documents. Nothing else is
allowed to soften a comparison: a case is either compared byte for byte or named
in that file, with a reason.

### Golden images

Comparing *pixels* needs a GPU, so it is **not** in CI and is not automated: it
is the side-by-side capture of the same envelope in both targets, with the
tolerance written down next to it. Text is what it exists for — same algorithm
and same font, but not the same FPU, and not the same sampler.

**What the metrics already settle, and images cannot add to.** Since the text
engine landed (ZAB-137) both targets rasterize stb_truetype over the same
Liberation Sans, and `text-wrap` compares **byte for byte**: the same break
points, the same line widths to three decimals, the same baselines. A capture
cannot disagree with that about *where* a glyph is. What it can catch is
everything downstream of the metrics — the coverage a rasterized bitmap lands
with, the filtering an engine samples it through, the blend the canvas composites
it with — which is exactly the part no snapshot describes.

**The procedure.** One envelope, every target, the same viewport, one image each:

1. `pnpm zabloo preview golden/envelopes/text-wrap.json` — it serves any envelope
   on disk, no project needed. Set the viewport to **480×320** and the DPR to
   **1** in the topbar, and capture the canvas alone.
2. `cd sdk/godot && scons install`, open `examples/godot-playground`, point the
   `ZablooView` at `golden/envelopes/text-wrap.json`, size the control to
   **480×320** and capture the viewport.
3. `cd sdk/unity && scons install`, open `examples/unity-playground` and run
   **Zabloo › Verify › Golden capture** from the menu bar: it builds a scene
   with a `ZablooView` of exactly **480×320** on a constant-pixel-size canvas
   (one canvas unit is one device pixel, whatever the Game view's size) and
   reads the envelope straight from this directory. Set the Game view's Scale
   slider to 1, press Play, then **C**: the rig reads back the view's rect at
   the end of the frame with `Texture2D.ReadPixels` — the canvas alone, no
   post-processing, no camera in between (the canvas is Screen Space – Overlay)
   — and writes `Captures/text-wrap-unity.png` next to the project, where it is
   gitignored. Do not use a supersized `ScreenCapture`: any scale but 1 resamples
   the glyphs you are about to compare.
4. Compare the three at 1:1. They are not committed — see below.

**The tolerance.** A glyph's *placement* must match exactly — same line breaks,
same left edges, same baselines to the pixel — because both sides snap the glyph
origin to the same grid and read the placement out of the same numbers the corpus
already compares. Its *coverage bytes* are identical too, by construction: one
rasterizer, one font, one scale.

What is left to differ is only what happens to those bytes afterwards, and it is
**≤ 2/255 per channel along antialiased edges, nowhere else**. The web's atlas is
a canvas, which a browser keeps with premultiplied alpha and hands to WebGL
through its own color management; the core hands an engine the raw coverage and
lets it sample and blend on its own terms. A rounding step or two at the boundary
between ink and background is that, and nothing more.

Anything with one of these shapes is a **bug, not tolerance**: a line that breaks
in another place, a run that drifts sideways as it goes (a kerning or an advance
applied on one side only), a baseline off by a pixel (ascent, half-leading, or a
snap that rounds the other way), or a solid interior that differs at all —
antialiasing lives on edges, so the middle of a stroke has nothing to round.

Captures are **not committed**. They are dated evidence of one run on one GPU,
and a PNG in git that nobody can re-derive is worse than the procedure that
produces one: the rule the corpus lives by is that a record has to be
reproducible, and this one is not. What belongs in a PR is the observation.

## What does NOT belong here

**Performance scenes** are not cases. They sit next door, in `perf/`, which has a
README of its own — same directory, deliberately different contract: a case here
records what a frame MEANS and every target must reproduce it byte for byte, while
a scene there is a load to measure and what it costs is each target's own answer.

## Adding a capability

1. Write `envelopes/<name>.json` (IR v1 — see `packages/format/src/index.ts`).
2. Add the case to `cases.json` with an `about` and whatever `data` or `pad` it
   needs.
3. Run the suite with `-u` and **read** the generated metrics: they are the
   record of what the renderer does, so they are only correct if you say so.
4. If the capability has an invariant a diff would not catch, assert it in
   `view.test.ts`.
5. Add the case to `core/tests/golden-skip.json` with the ticket that will make
   the core reproduce it. A capability the reference has and the core does not is
   exactly what that file is for — and until the line exists, `scons test` in
   `core/` fails on the new case.

The suite fails if an envelope on disk has no case, if a case warns while
rendering, if a node type of the v1 catalog appears in no case at all, or if
either forward-tolerance rule above loses its case — a type outside the catalog
that degrades to a box with its children intact, and a major version that is
refused.
