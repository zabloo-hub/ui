---
"@zabloo/cli": patch
---

`zabloo export` stops answering with the name of a file that does not exist.

Pointing it at anything that was not a ready project — the wrong directory, or a real project
before its first `pnpm install` — ended in node's raw `Cannot find module 'react'` over a
`Require stack` naming `__zabloo_export__.mjs`, the internal base the project's dependencies
resolve from. Nobody could act on that: it is not a file anyone wrote, and it is not on disk to
go and look at.

Two things were in the way. The `src/views/` check ran *after* the dependency imports, so the
message that fit best — "No views directory found at …" — could never be reached by a directory
that had no `node_modules` either, which is every directory that has no `src/views/`. And a
missing dependency was reported verbatim. Now the cheap, specific check goes first, an absent
`react` or `@zabloo/react` says so and says to run `pnpm install`, and nothing that leaves the
export names the resolution base at all.
