# create-zabloo-app

## 0.1.2

### Patch Changes

- [#113](https://github.com/zabloo-hub/ui/pull/113) [`7cd0184`](https://github.com/zabloo-hub/ui/commit/7cd01840b954b9e88260eca35399244a07bbcc03) Thanks [@zamoks95](https://github.com/zamoks95)! - Scaffolded projects get a `dev:godot` script (`zabloo dev --godot`), and the README says how
  to run the Godot dev loop: enable the addon, press Play, and every save hot-swaps the
  running view.

- [#117](https://github.com/zabloo-hub/ui/pull/117) [`3e2f98a`](https://github.com/zabloo-hub/ui/commit/3e2f98a2c5779d289186f5dbeb46a01c9d4aa692) Thanks [@zamoks95](https://github.com/zamoks95)! - The scaffolded README now shows the Godot wiring — a `ZablooView` with its `action` and
  `data_changed` signals — beside the Unity one, and points at the Godot install steps. The
  generated project already had `pnpm dev:godot`; this is the other half of it.

- [#120](https://github.com/zabloo-hub/ui/pull/120) [`063fa96`](https://github.com/zabloo-hub/ui/commit/063fa96ceef4821c6a80f4683ba2a0fb42781cb2) Thanks [@zamoks95](https://github.com/zamoks95)! - The scaffolded README describes the rebuilt Unity SDK — a thin adapter over the native core (F12) — instead of the removed one. `pnpm dev:unity` is unchanged and pushes to the new SDK's editor dev mode on `localhost:5077`.

- [#131](https://github.com/zabloo-hub/ui/pull/131) [`294e723`](https://github.com/zabloo-hub/ui/commit/294e723a16c246a78821ea455b649bd4034a424d) Thanks [@zamoks95](https://github.com/zamoks95)! - The scaffolded README now installs the released Unity SDK — the `com.zabloo.sdk` tarball added to `Packages/manifest.json` by path — and shows the C# wiring (`OnAction`, `OnDataChanged`, `SetData` on the `ZablooView` component) beside the Godot one. `pnpm dev:unity` is listed with the other commands.

## 0.1.1

### Patch Changes

- [#88](https://github.com/zabloo-hub/ui/pull/88) [`e085560`](https://github.com/zabloo-hub/ui/commit/e085560d3077466d5cf563a16715fa8487a8f5b9) Thanks [@zamoks95](https://github.com/zamoks95)! - The README scaffolded into a new project describes the current dev preview — the typed
  bindings panel and the console — instead of the old data panel and view picker.

- [#38](https://github.com/zabloo-hub/ui/pull/38) [`9039edf`](https://github.com/zabloo-hub/ui/commit/9039edfc2c7eca66a19cc4b62fd689d96418f336) Thanks [@zamoks95](https://github.com/zamoks95)! - Every package ships its README, `LICENSE` and complete npm metadata (`repository`,
  `homepage`, `bugs`, `keywords`, `engines`). `@zabloo/cli` and `create-zabloo-app` expose only
  `./package.json` — they are executables, not libraries.

- [#58](https://github.com/zabloo-hub/ui/pull/58) [`16201d2`](https://github.com/zabloo-hub/ui/commit/16201d24a5fd740ab1443770ed464048525a4c0d) Thanks [@zamoks95](https://github.com/zamoks95)! - `create-zabloo-app` scaffolds the `@zabloo/*` version range that matches its own version
  instead of a hardcoded `^0.1.0`.
