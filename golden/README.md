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

## A case is four things

A case is `(envelope, data, viewport, clock)` — and nothing else. Everything the
metrics record has to be derivable from those four, or a second target could not
reproduce it.

| Field | Meaning |
|---|---|
| `envelope` | file under `envelopes/` |
| `about` | what this case is a record of — the first thing a reader of a diff needs |
| `data` | pushed through the host data channel (`SetData`) before measuring |
| `width` / `height` | viewport in logical px (default 480×320, dpr 1) |
| `advanceMs` | milliseconds of clock run before measuring, so motion is recorded settled |

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

## Adding a capability

1. Write `envelopes/<name>.json` (IR v1 — see `packages/format/src/index.ts`).
2. Add the case to `cases.json` with an `about` and whatever `data` it needs.
3. Run the suite with `-u` and **read** the generated metrics: they are the
   record of what the renderer does, so they are only correct if you say so.
4. If the capability has an invariant a diff would not catch, assert it in
   `view.test.ts`.

The suite fails if an envelope on disk has no case, if a case warns while
rendering, or if a node type of the v1 catalog appears in no case at all.
