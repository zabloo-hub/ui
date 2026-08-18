# Golden corpus

Reference envelopes and the metrics every target must reproduce from them.

This directory is **not** part of any package. It sits at the repo root because
it is a **cross-target** artifact: the web renderer measures itself against it
today (ZAB-48), and the Unity SDK will be measured against these same files
(ZAB-38). An envelope that lived inside `packages/renderer-web` would be a
fixture of the web test suite; here it is a specification of what the IR means.

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

Two rules the runner applies to every case, and that the Unity side has to apply
too:

1. **Text is measured with the SDK's own rasterizer** (stb\_truetype over the
   shipped TTF), never a platform one. Same algorithm, same font, same metrics.
2. **One settling frame after the data.** The frame a bound array arrives on is
   the one that *measures* its items; the window over them is computed from those
   measurements on the *next* frame. Measuring the first would record a transient.

## The metrics

`metrics/<case>.json` is a `ViewSnapshot` (see
`packages/renderer-web/src/snapshot.ts`): layout rects, wrap points with their
baselines, active states, resolved paint values, clipping regions, scroll
extents, control values, realized windows and the overlay layer in paint order.
No pixels — golden **images** are ZAB-38's other half and need a GPU; everything
here runs on a bare CPU in CI.

Numbers are rounded to 3 decimals so the last bits of a floating-point multiply
never rewrite a file.

## Cases that refuse to load

Not every normative rule of the format produces a frame. A case with `refuses`
records the other kind: the envelope must be **rejected**, with the diagnostic
code it names, and nothing must render. It has no file under `metrics/` — there
is nothing to measure — and the assertion lives in `golden.test.ts` instead.

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

The suite fails if an envelope on disk has no case, if a case warns while
rendering, if a node type of the v1 catalog appears in no case at all, or if
either forward-tolerance rule above loses its case — a type outside the catalog
that degrades to a box with its children intact, and a major version that is
refused.
