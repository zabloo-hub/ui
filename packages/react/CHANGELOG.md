# @zabloo/react

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @zabloo/format@0.3.0

## 0.2.0

### Minor Changes

- [#43](https://github.com/zabloo-hub/ui/pull/43) [`f9d0145`](https://github.com/zabloo-hub/ui/commit/f9d01458de0335f4ce89a273ec881e130a8bd266) Thanks [@zamoks95](https://github.com/zamoks95)! - New `disabled` prop on every node, bindable like `visible`. It inherits: disabling a container
  disables everything inside it (an `Overlay` starts a fresh chain, so a modal declared inside a
  disabled panel stays operable). A disabled node is not focusable, takes no pointer or
  navigation input and releases anything it was holding; it still renders, styled through
  `states.disabled`, and a disabled `ScrollView` still scrolls. Host calls such as `setValue` and
  `setScroll` are not blocked.

- [#45](https://github.com/zabloo-hub/ui/pull/45) [`3b446b8`](https://github.com/zabloo-hub/ui/commit/3b446b8664850a5b8c598782b74b15e7817ee331) Thanks [@zamoks95](https://github.com/zamoks95)! - `onChange` on a `Container` with `group: "exclusive-check"` fires a named action when the
  group's selection moves — `<Select onChange>` and `<RadioGroup onChange>` now reach the IR and
  fire, where before the prop was accepted and silently dropped. The action carries the chosen
  option's `ActionContext`; the value itself still arrives through `onDataChanged`. Re-picking
  the option already selected does not fire.

- [#50](https://github.com/zabloo-hub/ui/pull/50) [`cc65805`](https://github.com/zabloo-hub/ui/commit/cc65805c3547f1edac3532356eac102e18545f44) Thanks [@zamoks95](https://github.com/zamoks95)! - `OverlayPosition` is an alias of `@zabloo/format`'s `AnchorAt` — one vocabulary for the nine
  positions. Every component now has a `displayName`.

### Patch Changes

- [#38](https://github.com/zabloo-hub/ui/pull/38) [`9039edf`](https://github.com/zabloo-hub/ui/commit/9039edfc2c7eca66a19cc4b62fd689d96418f336) Thanks [@zamoks95](https://github.com/zamoks95)! - Every package ships its README, `LICENSE` and complete npm metadata (`repository`,
  `homepage`, `bugs`, `keywords`, `engines`). `@zabloo/cli` and `create-zabloo-app` expose only
  `./package.json` — they are executables, not libraries.

- [#38](https://github.com/zabloo-hub/ui/pull/38) [`9039edf`](https://github.com/zabloo-hub/ui/commit/9039edfc2c7eca66a19cc4b62fd689d96418f336) Thanks [@zamoks95](https://github.com/zamoks95)! - Fix `@zabloo/react` failing to import from Node with `ERR_MODULE_NOT_FOUND` on
  `react-reconciler/constants`.

- [#49](https://github.com/zabloo-hub/ui/pull/49) [`cd2a3d9`](https://github.com/zabloo-hub/ui/commit/cd2a3d924db9090ceb668124c0238fc6153c0c93) Thanks [@zamoks95](https://github.com/zamoks95)! - A variant or prop that declares a state with no style no longer emits an empty `states`
  override into the envelope.

- [#59](https://github.com/zabloo-hub/ui/pull/59) [`0f42310`](https://github.com/zabloo-hub/ui/commit/0f42310da847fd61219a4c9f4a4f8d67dec2e6f8) Thanks [@zamoks95](https://github.com/zamoks95)! - JSDoc corrections on the public surface: `ToggleControlProps.onChange` now documents that,
  inside a `<RadioGroup>` or `<Select>`, it fires only for the option that takes the selection.
  Remaining non-English comments translated.
- Updated dependencies [[`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`7487ef1`](https://github.com/zabloo-hub/ui/commit/7487ef12fc352fa9e35b40a15857e40f5da7da05)]:
  - @zabloo/format@0.2.0
