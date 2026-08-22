# @zabloo/cli

## 0.2.0

### Minor Changes

- [#58](https://github.com/zabloo-hub/ui/pull/58) [`16201d2`](https://github.com/zabloo-hub/ui/commit/16201d24a5fd740ab1443770ed464048525a4c0d) Thanks [@zamoks95](https://github.com/zamoks95)! - The CLI gains the commands a studio's own CI needs, and the preview the controls it was missing:

  - `zabloo validate [file]` checks an envelope on disk with the same loading contract every
    SDK applies: exit `0` when it loads, `1` on a fatal, `--strict` to fail on repaired warnings
    too, `--json` for machine-readable diagnostics.
  - `zabloo preview <envelope.json>` serves the preview for an envelope with no project around
    it, reloading when the file changes.
  - `zabloo export --out <file>` writes the envelope where you say; `zabloo dev --open` opens
    the browser.
  - The preview gets viewport presets (1920×1080, 1280×720, custom) with a DPR selector, a
    frame-stats badge, and an SSE keepalive so live reload survives proxies.
  - The preview refuses requests for a `Host` that is not localhost (DNS-rebinding guard); pass
    `--allow-host <host>` behind a Codespace or a tunnel.

- [#82](https://github.com/zabloo-hub/ui/pull/82) [`7da34d9`](https://github.com/zabloo-hub/ui/commit/7da34d9c094756565164a41edfa90f81967c8d82) Thanks [@zamoks95](https://github.com/zamoks95)! - New dev preview UI for `zabloo dev` and `zabloo preview`: a topbar with view, viewport and DPR
  controls; an IDE-style console (Actions, Problems, Stats); a typed data-bindings panel; zen
  mode; light and dark theme. The built UI ships inside this package (about 1.2 MB unpacked).

  **Breaking:** the old page's `/renderer.js` and its own script are gone — the renderer is
  bundled as a hashed file under `/assets/`. Anything fetching those URLs directly must stop.
  `/envelope`, `/asset/<hash>` and `/events` are unchanged; `/envelope` gains an
  `x-zabloo-envelope-name` header.

  A failed export no longer paints an error over the canvas: the last good render stays under a
  "Stale" veil, the connection pill turns amber with the message, and the diagnostics are in the
  Problems tab. Red now means a lost connection.

### Patch Changes

- [#38](https://github.com/zabloo-hub/ui/pull/38) [`9039edf`](https://github.com/zabloo-hub/ui/commit/9039edfc2c7eca66a19cc4b62fd689d96418f336) Thanks [@zamoks95](https://github.com/zamoks95)! - Every package ships its README, `LICENSE` and complete npm metadata (`repository`,
  `homepage`, `bugs`, `keywords`, `engines`). `@zabloo/cli` and `create-zabloo-app` expose only
  `./package.json` — they are executables, not libraries.

- [#47](https://github.com/zabloo-hub/ui/pull/47) [`3341a53`](https://github.com/zabloo-hub/ui/commit/3341a533a23f410e1665e580a6bec5d36e801aef) Thanks [@zamoks95](https://github.com/zamoks95)! - `zabloo export` and `zabloo dev` fail honestly on a first run:

  - `export` works without `zabloo.config.ts` or `src/theme.ts` (both are optional) instead of
    crashing with an internal stack trace.
  - `dev` moves to the next free port when the preview port is taken and announces the one it
    actually bound — it used to print another project's URL.
  - `dev` without a `src/` directory exits with a clear message before starting anything.
  - A failed export during `dev` is shown in the browser over the last good view, with the
    failure text; a tab opened later sees it too.
  - A view that fails to mount no longer leaves the preview holding a disposed renderer.

- [#50](https://github.com/zabloo-hub/ui/pull/50) [`cc65805`](https://github.com/zabloo-hub/ui/commit/cc65805c3547f1edac3532356eac102e18545f44) Thanks [@zamoks95](https://github.com/zamoks95)! - The dev preview shows authoring diagnostics from the renderer's `onDiagnostic` sink instead of
  scraping the browser console.

- [#59](https://github.com/zabloo-hub/ui/pull/59) [`0f42310`](https://github.com/zabloo-hub/ui/commit/0f42310da847fd61219a4c9f4a4f8d67dec2e6f8) Thanks [@zamoks95](https://github.com/zamoks95)! - JSDoc corrections on the public surface: `ToggleControlProps.onChange` now documents that,
  inside a `<RadioGroup>` or `<Select>`, it fires only for the option that takes the selection.
  Remaining non-English comments translated.

- [#60](https://github.com/zabloo-hub/ui/pull/60) [`33f6331`](https://github.com/zabloo-hub/ui/commit/33f63314f02e95d0d448ff8b142645cce6111431) Thanks [@zamoks95](https://github.com/zamoks95)! - `zabloo export` in a directory that is not a ready project says so: a missing `src/views/`, or
  a missing dependency (`react`, `@zabloo/react` — run `pnpm install`), is reported in those
  terms and never as an internal module path.

- [#86](https://github.com/zabloo-hub/ui/pull/86) [`3848bb2`](https://github.com/zabloo-hub/ui/commit/3848bb2fd999c2bc67db4b1a5b3c37ccd39e54e6) Thanks [@zamoks95](https://github.com/zamoks95)! - The preview server no longer dies on a request that throws: an unhandled error answers 500, an
  envelope name with characters a header cannot carry is encoded (and decoded by the page), and
  an unbuilt preview answers 503 with the build instruction.
- Updated dependencies [[`7668939`](https://github.com/zabloo-hub/ui/commit/76689390978644645c0a4b100638ea17db3a618d), [`731a375`](https://github.com/zabloo-hub/ui/commit/731a375eb7e39c6efbf34be533ad2f53409b281b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`7487ef1`](https://github.com/zabloo-hub/ui/commit/7487ef12fc352fa9e35b40a15857e40f5da7da05), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`7487ef1`](https://github.com/zabloo-hub/ui/commit/7487ef12fc352fa9e35b40a15857e40f5da7da05), [`a54c35d`](https://github.com/zabloo-hub/ui/commit/a54c35d42370e3a01476af9e7a7e98fdd3ecc992)]:
  - @zabloo/renderer-web@0.2.0
  - @zabloo/format@0.2.0
