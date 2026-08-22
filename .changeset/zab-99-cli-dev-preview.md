---
"@zabloo/cli": minor
---

pr: 82

New dev preview UI for `zabloo dev` and `zabloo preview`: a topbar with view, viewport and DPR
controls; an IDE-style console (Actions, Problems, Stats); a typed data-bindings panel; zen
mode; light and dark theme. The built UI ships inside this package (about 1.2 MB unpacked).

**Breaking:** the old page's `/renderer.js` and its own script are gone — the renderer is
bundled as a hashed file under `/assets/`. Anything fetching those URLs directly must stop.
`/envelope`, `/asset/<hash>` and `/events` are unchanged; `/envelope` gains an
`x-zabloo-envelope-name` header.

A failed export no longer paints an error over the canvas: the last good render stays under a
"Stale" veil, the connection pill turns amber with the message, and the diagnostics are in the
Problems tab. Red now means a lost connection.
