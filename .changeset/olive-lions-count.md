---
"@zabloo/renderer-web": patch
---

The performance scenes the bench and the budget suite run on moved out of the package and
into `golden/perf/`, so the C++ core measures the same frames. Nothing in the published
renderer changed; if you imported `src/perf/scenes.ts` directly it is now a reader of those
files and no longer defines them.
