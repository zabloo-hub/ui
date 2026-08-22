---
"@zabloo/cli": patch
---

`zabloo export` and `zabloo dev` fail honestly on a first run:

- `export` works without `zabloo.config.ts` or `src/theme.ts` (both are optional) instead of
  crashing with an internal stack trace.
- `dev` moves to the next free port when the preview port is taken and announces the one it
  actually bound — it used to print another project's URL.
- `dev` without a `src/` directory exits with a clear message before starting anything.
- A failed export during `dev` is shown in the browser over the last good view, with the
  failure text; a tab opened later sees it too.
- A view that fails to mount no longer leaves the preview holding a disposed renderer.
