# @zabloo/renderer-web

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

- [#50](https://github.com/zabloo-hub/ui/pull/50) [`cc65805`](https://github.com/zabloo-hub/ui/commit/cc65805c3547f1edac3532356eac102e18545f44) Thanks [@zamoks95](https://github.com/zamoks95)! - The renderer's public surface closes three gaps:

  - New `onDiagnostic` in `MountOptions`: receive the structured diagnostics (`code`, `path`,
    `level`) `readEnvelope` produces on `mount` and `reload`, instead of reading them off
    `console.warn`. Without a sink, the console output is unchanged.
  - `handle.viewIds` is a getter and reflects the views after a `reload`.
  - `findNode` is exported alongside `serializeSnapshot`.

- [#54](https://github.com/zabloo-hub/ui/pull/54) [`21d1476`](https://github.com/zabloo-hub/ui/commit/21d1476f67250f3a01c4003ce5249862ad6f52ee) Thanks [@zamoks95](https://github.com/zamoks95)! - The per-frame cost drops, and `FrameStats` says more:

  - A focused `TextInput`'s caret blink no longer re-runs the whole layout pipeline at 60 fps —
    it is a repaint.
  - `FrameStats` gains `resolved`, `textLayouts`, `bufferGrowths` and `repaintOnly`.
  - Per-frame cost drops across the board: style resolution is cached per node and frame, and
    the pre-layout tree walks are gone.

- [#58](https://github.com/zabloo-hub/ui/pull/58) [`16201d2`](https://github.com/zabloo-hub/ui/commit/16201d24a5fd740ab1443770ed464048525a4c0d) Thanks [@zamoks95](https://github.com/zamoks95)! - Two new `MountOptions`: `dpr` overrides the device pixel ratio the renderer rasterizes at, and
  `onFrame` fires after every painted frame with its `FrameStats`.

### Patch Changes

- [#92](https://github.com/zabloo-hub/ui/pull/92) [`6bc8dfb`](https://github.com/zabloo-hub/ui/commit/6bc8dfbbaf8efb2b71442f003721f7686ffed9c8) Thanks [@zamoks95](https://github.com/zamoks95)! - Pointer events account for a canvas scaled with a CSS `transform`: if your host shrinks the
  canvas to fit, controls now respond where they are painted instead of offset by the zoom
  factor. A resize that does not change the backing store no longer clears the drawing buffer.

- [#94](https://github.com/zabloo-hub/ui/pull/94) [`2697e87`](https://github.com/zabloo-hub/ui/commit/2697e877e44afc4b694cfe4bdd4111a9863cdaa7) Thanks [@zamoks95](https://github.com/zamoks95)! - The renderer reads keyboard input only while the page's focus is on its canvas (or on the
  hidden field a focused `TextInput` types through), and no longer calls `preventDefault()` on
  keys it does not own — buttons and inputs in the UI around the canvas work from the keyboard
  again. The canvas is now focusable (`tabindex="0"` unless you set your own): clicking it takes
  the focus, and Tab moves in and out of the game. If your host relied on the renderer capturing
  keys globally, focus the canvas first.

- [#38](https://github.com/zabloo-hub/ui/pull/38) [`9039edf`](https://github.com/zabloo-hub/ui/commit/9039edfc2c7eca66a19cc4b62fd689d96418f336) Thanks [@zamoks95](https://github.com/zamoks95)! - Every package ships its README, `LICENSE` and complete npm metadata (`repository`,
  `homepage`, `bugs`, `keywords`, `engines`). `@zabloo/cli` and `create-zabloo-app` expose only
  `./package.json` — they are executables, not libraries.

- [#46](https://github.com/zabloo-hub/ui/pull/46) [`b249ed9`](https://github.com/zabloo-hub/ui/commit/b249ed96cc235dc50050321ea1c5afdc1059b098) Thanks [@zamoks95](https://github.com/zamoks95)! - A recycled `Repeat` row no longer animates from the previous item's values when it is reused
  for a new one: the whole subtree settles on the new item's data in its first frame. A change to
  the same item's own data still animates.

- [#48](https://github.com/zabloo-hub/ui/pull/48) [`db76422`](https://github.com/zabloo-hub/ui/commit/db76422970c1de70f8195040fc899206e6994de3) Thanks [@zamoks95](https://github.com/zamoks95)! - Two GPU failure modes that used to leave the canvas blank or scrambled are now handled:

  - The renderer survives WebGL context loss: on `webglcontextrestored` it rebuilds its GPU
    resources and re-uploads atlases and images, instead of staying blank.
  - Geometry no longer scrambles past 65,536 vertices in one batch (a long unvirtualized list):
    indices are 32-bit.

- [#51](https://github.com/zabloo-hub/ui/pull/51) [`c456521`](https://github.com/zabloo-hub/ui/commit/c4565216ce0dc67de5a1503c7a579d8f1284a4b2) Thanks [@zamoks95](https://github.com/zamoks95)! - Text rendering is bounded where it was not, and cheaper per frame:

  - `fontSize` is clamped to 1–512 px; the ceiling is normative. A glyph that cannot be
    rasterized renders blank with one warning instead of throwing inside a frame.
  - Wrapping a very long unbroken word is linear instead of quadratic, `maxLines` stops the work
    early, and kerning and text layout are memoized. Break points and widths are unchanged.

- [#52](https://github.com/zabloo-hub/ui/pull/52) [`a95b8a7`](https://github.com/zabloo-hub/ui/commit/a95b8a7e61cd754a4cfb9b876bdfc8f8317e7fcf) Thanks [@zamoks95](https://github.com/zamoks95)! - Input and focus hold up under cancelled gestures, virtualized scrolling and several mounted views:

  - `pointercancel` ends a gesture: a cancelled touch no longer leaves a button pressed or a
    slider following the pointer. A cancelled `Slider` drag commits, since its value is already
    on screen and in its binding.
  - Focus on a virtualized `Repeat` row survives scrolling out of the window: it is remembered
    by item and restored when the row comes back, instead of jumping to the view's `autofocus`.
  - With several views mounted on one page, keyboard and gamepad go to one owner — the first
    mounted, or the one the player last touched — instead of to all of them.

- [#49](https://github.com/zabloo-hub/ui/pull/49) [`cd2a3d9`](https://github.com/zabloo-hub/ui/commit/cd2a3d924db9090ceb668124c0238fc6153c0c93) Thanks [@zamoks95](https://github.com/zamoks95)! - Four layout fixes, none of which moves a rect in the golden corpus:

  - A `ScrollView` whose children all become `visible: false` resets its scroll extent instead
    of keeping the last populated one.
  - A `Slider` slot with an unresolvable `height` token resolves like every other node instead
    of taking its content's height.
  - Anchored overlays no longer share one rect object with the root.
  - Children outside the layout are no longer measured with stale values.

- [#59](https://github.com/zabloo-hub/ui/pull/59) [`0f42310`](https://github.com/zabloo-hub/ui/commit/0f42310da847fd61219a4c9f4a4f8d67dec2e6f8) Thanks [@zamoks95](https://github.com/zamoks95)! - JSDoc corrections on the public surface: `ToggleControlProps.onChange` now documents that,
  inside a `<RadioGroup>` or `<Select>`, it fires only for the option that takes the selection.
  Remaining non-English comments translated.
- Updated dependencies [[`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`85a1a3a`](https://github.com/zabloo-hub/ui/commit/85a1a3a5de61cb053d291753e491877c26e3f38b), [`7487ef1`](https://github.com/zabloo-hub/ui/commit/7487ef12fc352fa9e35b40a15857e40f5da7da05)]:
  - @zabloo/format@0.2.0
