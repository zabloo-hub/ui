# @zabloo/format

## 0.3.0

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

### Patch Changes

- [#38](https://github.com/zabloo-hub/ui/pull/38) [`9039edf`](https://github.com/zabloo-hub/ui/commit/9039edfc2c7eca66a19cc4b62fd689d96418f336) Thanks [@zamoks95](https://github.com/zamoks95)! - Every package ships its README, `LICENSE` and complete npm metadata (`repository`,
  `homepage`, `bugs`, `keywords`, `engines`). `@zabloo/cli` and `create-zabloo-app` expose only
  `./package.json` — they are executables, not libraries.

- [#44](https://github.com/zabloo-hub/ui/pull/44) [`0c9862d`](https://github.com/zabloo-hub/ui/commit/0c9862d44fcff350ee28fbf1251c74f7e5bf5e77) Thanks [@zamoks95](https://github.com/zamoks95)! - `readEnvelope` accepts `text: ""` on a `Text` node instead of dropping the node as
  `invalid-node` — an empty label keeps its one-line height and its slot in the layout. A `Text`
  with no `text` field at all is still rejected.

- [#49](https://github.com/zabloo-hub/ui/pull/49) [`cd2a3d9`](https://github.com/zabloo-hub/ui/commit/cd2a3d924db9090ceb668124c0238fc6153c0c93) Thanks [@zamoks95](https://github.com/zamoks95)! - `readEnvelope` rejects an inverted `Slider` range when only one bound is declared
  (`{ min: 5 }` against the default `max` of 1), not only when both are.
