---
"@zabloo/renderer-web": patch
---

Pointer events are mapped through the scale the canvas is drawn at, so the controls answer
where they are painted.

A host that keeps the canvas at its logical size and shrinks it with a `transform` — which is
what the dev preview does under every fixed viewport — leaves `getBoundingClientRect` reporting
one box and `clientWidth` another. `eventPoint` measured against the visual one and handed the
point to a tree laid out in the other, so at 76% zoom every control fired about 120px away from
itself. The point (and the wheel's deltas, which are screen pixels too) now takes the
`clientWidth / rect.width` factor, read from the rect that was already cached for it.

A resize that did not change the backing store no longer reassigns `canvas.width`, which threw
the drawing buffer away for nothing: it is how a host announces that the canvas was rescaled
rather than resized.
