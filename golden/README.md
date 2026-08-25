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
└── metrics/*.json    what a correct renderer computes from them (generated)
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
and same font, but not the same FPU — and it lands with the text engine
(ZAB-137).

## What does NOT belong here

**Performance scenes.** The corpus documents BEHAVIOR, so its cases are as small
as the rule they record. The scenes the budgets are asserted against — a
thousand-row list, a wall of wrapped prose, a panel mid-transition — live in
`packages/renderer-web/src/perf/scenes.ts` instead (ZAB-73), for two reasons:
their metrics are `stats()`, which is web-only telemetry and deliberately
outside `snapshot()` (the cross-target contract), and a thousand rows of
recorded rects would be a megabyte of golden nobody reads.

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
