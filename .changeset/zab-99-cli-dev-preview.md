---
"@zabloo/cli": minor
---

New dev preview UI: topbar with view/viewport/DPR controls, IDE-style console (actions,
problems, stats), typed data-bindings panel, zen mode, light/dark theme.

The hand-written page `zabloo dev` and `zabloo preview` used to serve is gone, and with it
its two routes: `/renderer.js` and the page's own script. The chrome imports the renderer as
ESM, so both are now hashed files under `/assets/` — anything fetching those URLs directly
was reaching into the preview's internals and has to stop. `/envelope`, `/asset/<hash>`,
`/events` and the `Host` guard are unchanged; `/envelope` gained an
`x-zabloo-envelope-name` header, which is the short name the statusbar prints and the key
the preview remembers your selected view under.

A failed export no longer paints an error over the canvas and turns the status dot red. The
last good render stays on screen under a veil with a "Stale" pill, the connection pill goes
amber and carries the message, and the diagnostics live in the Problems tab — red is now
reserved for a lost connection.

The tarball grows: the built chrome ships inside this package (~1.2 MB unpacked of the
1.4 MB total), which is what serving a real app instead of a string of HTML costs. Bundled
fonts are subset to latin + latin-ext rather than shipping every subset @fontsource
declares.
