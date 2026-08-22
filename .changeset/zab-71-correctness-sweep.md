---
"@zabloo/renderer-web": patch
---

- A `ScrollView` whose children all become `visible: false` resets its scroll extent instead
  of keeping the last populated one.
- A `Slider` slot with an unresolvable `height` token resolves like every other node instead
  of taking its content's height.
- Anchored overlays no longer share one rect object with the root.
- Children outside the layout are no longer measured with stale values.
