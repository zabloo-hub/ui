# create-zabloo-app

## 0.1.1

### Patch Changes

- 54b8e52: The README scaffolded into a new project described the old dev preview — a data panel for
  bound paths and a view picker. It now names what the page actually has: a bindings panel
  with a typed field per path, and the console the actions are logged in.
- 85a1a3a: Give every package a README and complete npm metadata (`repository` with its monorepo
  `directory`, `homepage`, `bugs`, `keywords`, `engines.node`, explicit
  `publishConfig.access`), and ship `LICENSE` inside each tarball instead of only at the
  repo root. `@zabloo/cli` and `create-zabloo-app` close their `exports` to
  `./package.json`: they are executables, not libraries.

  Fix the import that made `@zabloo/react` unimportable from Node — `react-reconciler/constants`
  has no extension and that package declares no `exports`, so the ESM resolver refused it
  (`ERR_MODULE_NOT_FOUND`) for every real consumer.

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
