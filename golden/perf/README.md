# Performance scenes

The loads the performance budgets are measured on — a thousand-row list, a wall
of wrapped prose, a panel caught mid-transition, a populated screen with
something animating on it. Both targets read these very files: the web renderer
through `packages/renderer-web/src/perf/scenes.ts`, the C++ core through
`core/tests/staging.cpp`.

```
golden/perf/
├── scenes.json           the index: what each scene is, and what it is for
├── <name>.envelope.json  the IR envelope
└── <name>.data.json      what is pushed through the data channel first
```

## Why they are here and not in a package

Because the two targets have to measure **the same frame**. They started as a
TypeScript module (ZAB-73), which was fine while there was one renderer; the
moment the core had budgets of its own (G15, ZAB-148) that module would have had
to be transcribed into C++ fixtures, and two definitions of "a thousand unequal
rows" drift the first time one of them learns something.

## Why they are NOT corpus cases

They sit in the same directory as the corpus and obey a different contract, so
the difference is worth stating plainly:

| | `golden/cases.json` | `golden/perf/` |
|---|---|---|
| Records | what a frame **means** | what a frame **costs** |
| Compared | byte for byte, across targets | against a ceiling, per target |
| Lives in | `metrics/*.json`, committed | nothing committed — it is measured |

A metric is the cross-target contract: same envelope, same numbers, and a target
that disagrees is wrong. A cost is not. Draw calls, atlas bytes and nodes
resolved are properties of **how** a target draws — the core's atlases are LA8
and the browser's are RGBA, so the same three atlases are 6 MiB here and 12 MiB
there, and neither is a bug. That is why nothing under `perf/` is recorded: each
target holds its own ceilings, in `core/tests/test_budgets.cpp` and
`packages/renderer-web/src/budgets.test.ts`, and `docs/performance.md` puts the
two columns side by side.

The second reason is duller and just as real: a thousand rows of recorded rects
would be a megabyte of golden nobody reads.

## The scenes

Every one is 960×600 — a screen, not the postcard the corpus measures in.

| Scene | What it puts under load |
|---|---|
| `list` | 1.000 unequal rows virtualized inside a scroller |
| `text` | three columns of wrapped prose at three point sizes, one capped and ellipsized |
| `motion` | twelve rows of toggles, bars and a Collapse, measured mid-transition |
| `dense-loop` | a populated screen with a Spinner running — the steady animation frame |
| `dense-caret` | the same screen with nothing looping, so a focused field's caret owns the clock |

## Mounting one

The same two settling frames a corpus case gets: a `Repeat` measures its
instances on the frame the data arrives and windows them on the next. After that
the clock is the caller's — a budget reads the frame at rest, and the cases that
measure motion drive it themselves.

One asymmetry to know about when reading the two suites side by side: the web
handle renders on every write of its own accord, and the core leaves frames to
its adapter. So where the reference writes `setOpen(...)` and moves on, the core's
test writes and then asks for the frame — and it matters, because a node entering
the layout SNAPS, so without that frame there would be nothing in flight left to
measure.

## Changing them

These are inputs, not records, so there is nothing to regenerate — but both
targets are budgeted against them, so a change to a scene moves numbers in two
suites. Re-run `scons bench` in `core/` and `pnpm bench` in
`packages/renderer-web/`, and update the observed values in `docs/performance.md`
alongside the ceilings in the two budget files.
