---
"@zabloo/cli": patch
---

Five first-hour failures that shared one shape: the CLI carried on after a failure and reported
something that was not true.

- `export` without `zabloo.config.ts` or `src/theme.ts` died on a raw stack that leaked the
  internal `__zabloo_export__.mjs` sentinel. Absence is now decided by looking at the disk, so a
  real error inside either file stops being swallowed.
- With the preview port taken, `dev` announced **another project's** preview URL and exited 0.
  It now walks to the next free port, says so, and announces the one it actually bound; if the
  whole range is taken it refuses to start.
- `dev` without `src/` dumped a UVException *after* the success banner. The check is now the
  first thing it does, with an actionable message and exit 1.
- A failed export during `dev` was invisible in the browser. The SSE channel is typed, the
  failure travels with the child's stderr, and the page paints it over the stale view with the
  status dot red. The server holds the failure, so a tab opened afterwards hears about it too.
- A `mount` that threw left the handle pointing at a view it had just disposed.
