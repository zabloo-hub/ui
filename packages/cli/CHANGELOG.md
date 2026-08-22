# @zabloo/cli

## 0.2.0

### Minor Changes

- 85a1a3a: Close seven gaps and asymmetries in the renderer's public surface before the freeze — things
  the renderer knows and would not let you read, or exposed two different ways.

  - **`onDiagnostic` in `MountOptions`.** `@zabloo/format` produces _structured_ diagnostics —
    stable code, path into the envelope — and `loadEnvelope` dumped them to `console.warn`, where
    that structure died: a dev server overlay, the preview and the future editor cannot scrape a
    console. The sink receives warns and fatals, on both `mount` and `reload`, and the fatals
    arrive before the throw. Without a sink the console lines are exactly what they always were.
  - The preview stops depending on the console: a repaired `warn` takes the fading log line, a
    `fatal` takes the overlay and the red dot.
  - **`handle.viewIds` is a getter.** It was `Object.keys()` evaluated once when the handle was
    built, so after a `reload` the caller still listed the views from before the save — a save
    that added a view left it invisible until a manual page reload.
  - **`findNode` is exported**: `serializeSnapshot` was there, but reading a `ViewSnapshot` needs
    the single node.

- 85a1a3a: Release ops and the CLI surface a studio needs in its own CI.

  **`zabloo validate [file]`** runs the loading contract — the same one every SDK
  applies — against an envelope on disk and answers in exit-code terms: `0` when it
  loads, `1` on a fatal, `--strict` to fail on repaired warnings too, `--json` for a
  step that wants the diagnostic's path rather than a rendered line. Until now the
  only way to check a committed envelope was to write a script against
  `@zabloo/format` first.

  **`zabloo preview <envelope.json>`** serves the web preview for an envelope with no
  project around it — a build artifact, a colleague's attachment — and reloads when
  the file changes. **`zabloo export --out <file>`** writes one project's envelope
  wherever a CI matrix row needs it, and **`zabloo dev --open`** opens the browser.

  **The preview grew the three things it was missing.** _Viewport presets_
  (1920×1080, 1280×720, custom, plus a DPR selector): the canvas was `flex: 1` and
  took the window, so a UI authored for 1080p could not be looked at in 720p. Under a
  preset the canvas keeps its declared pixel size — which is what the renderer lays
  out against — and only a CSS transform shrinks it to fit. A _stats badge_ for what
  the last painted frame cost, which `stats()` would only tell you if you typed
  `zabloo.stats()` into a console you were not looking at. And an _SSE keepalive_, so
  live reload survives a proxy that drops idle connections.

  `@zabloo/renderer-web` gains the two `MountOptions` those need, both additive:
  `dpr`, which overrides the page's device pixel ratio everywhere the renderer turns
  logical pixels into device ones, and `onFrame`, which fires once per frame actually
  painted with what it cost. Only the renderer knows when it drew — it paints on
  demand — so only the renderer can report a frame rate.

  **The preview now refuses requests addressed to a host that is not ours** (403,
  with `--allow-host <host>` for a Codespace or a tunnel). Binding to loopback was
  never the defence it looks like: a page on an attacker's domain whose DNS answers
  127.0.0.1 reaches the preview through the developer's own browser and reads
  whatever envelope was being worked on.

  `create-zabloo-app` stops hardcoding the range it scaffolds. It was the literal
  `^0.1.0`, guarded by nothing — after the first version bump every new user would
  have been pinned to `^0.1.0` in silence, and the external smoke test cannot see it
  because it rewrites those dependencies to local tarballs before installing.

- e6af6e7: New dev preview UI: topbar with view/viewport/DPR controls, IDE-style console (actions,
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

### Patch Changes

- 85a1a3a: Give every package a README and complete npm metadata (`repository` with its monorepo
  `directory`, `homepage`, `bugs`, `keywords`, `engines.node`, explicit
  `publishConfig.access`), and ship `LICENSE` inside each tarball instead of only at the
  repo root. `@zabloo/cli` and `create-zabloo-app` close their `exports` to
  `./package.json`: they are executables, not libraries.

  Fix the import that made `@zabloo/react` unimportable from Node — `react-reconciler/constants`
  has no extension and that package declares no `exports`, so the ESM resolver refused it
  (`ERR_MODULE_NOT_FOUND`) for every real consumer.

- 85a1a3a: Five first-hour failures that shared one shape: the CLI carried on after a failure and reported
  something that was not true.

  - `export` without `zabloo.config.ts` or `src/theme.ts` died on a raw stack that leaked the
    internal `__zabloo_export__.mjs` sentinel. Absence is now decided by looking at the disk, so a
    real error inside either file stops being swallowed.
  - With the preview port taken, `dev` announced **another project's** preview URL and exited 0.
    It now walks to the next free port, says so, and announces the one it actually bound; if the
    whole range is taken it refuses to start.
  - `dev` without `src/` dumped a UVException _after_ the success banner. The check is now the
    first thing it does, with an actionable message and exit 1.
  - A failed export during `dev` was invisible in the browser. The SSE channel is typed, the
    failure travels with the child's stderr, and the page paints it over the stale view with the
    status dot red. The server holds the failure, so a tab opened afterwards hears about it too.
  - A `mount` that threw left the handle pointing at a view it had just disposed.

- a54c35d: JSDoc corrections on the public surface. `ToggleControlProps.onChange` said it fired
  "after every change" without the grouped case: inside a `<RadioGroup>` or `<Select>` it
  fires only for the option that TAKES the selection, never for the one that loses it. The
  remaining Spanish comments in `export.ts` and the perf scenes are now English.
- 12bb2bc: `zabloo export` stops answering with the name of a file that does not exist.

  Pointing it at anything that was not a ready project — the wrong directory, or a real project
  before its first `pnpm install` — ended in node's raw `Cannot find module 'react'` over a
  `Require stack` naming `__zabloo_export__.mjs`, the internal base the project's dependencies
  resolve from. Nobody could act on that: it is not a file anyone wrote, and it is not on disk to
  go and look at.

  Two things were in the way. The `src/views/` check ran _after_ the dependency imports, so the
  message that fit best — "No views directory found at …" — could never be reached by a directory
  that had no `node_modules` either, which is every directory that has no `src/views/`. And a
  missing dependency was reported verbatim. Now the cheap, specific check goes first, an absent
  `react` or `@zabloo/react` says so and says to run `pnpm install`, and nothing that leaves the
  export names the resolution base at all.

- af2adfc: The preview server now survives what used to kill the whole dev loop: the
  request handler has an error boundary (it was async and unawaited — any throw
  was an unhandled rejection that took the process down), the envelope name is
  encoded into its header (a non-Latin-1 path made `writeHead` throw on the first
  `/envelope` fetch), and an unbuilt chrome answers as a 503 with the build
  instruction instead of a stack trace on a terminal nobody is watching.
- Updated dependencies [7668939]
- Updated dependencies [731a375]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [85a1a3a]
- Updated dependencies [a54c35d]
  - @zabloo/renderer-web@0.2.0
  - @zabloo/format@0.2.0
