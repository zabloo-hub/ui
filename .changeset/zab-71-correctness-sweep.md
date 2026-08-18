---
"@zabloo/renderer-web": patch
"@zabloo/format": patch
"@zabloo/react": patch
---

Six surgical correctness fixes; none of them moves a rect in the golden corpus.

- `arrange` returned before the `isScrollView` block when nothing was left in flow, so a
  ScrollView whose children all turned `visible: false` kept the last populated frame's
  `scrollMax` and went on scrolling into nothing.
- `crossOf` read the raw `layout.height` instead of the resolved one — the single place in the
  pass that did — so an unresolvable token took the "declared" branch and gave the slot its
  content's height instead of the whole rail.
- `arrangeOverlay` handed the same `viewRect` object to every anchored overlay and the root.
- `checkRange` returned unless *both* bounds were numbers, letting `{type: "Slider", min: 5}`
  through with an inverted range against the default `max` of 1.
- The Slider branch of `measure` measured children outside layout, whose `resolved` is whatever
  the last frame that painted them left behind.
