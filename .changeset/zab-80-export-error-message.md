---
"@zabloo/cli": patch
---

`zabloo export` in a directory that is not a ready project says so: a missing `src/views/`, or
a missing dependency (`react`, `@zabloo/react` — run `pnpm install`), is reported in those
terms and never as an internal module path.
