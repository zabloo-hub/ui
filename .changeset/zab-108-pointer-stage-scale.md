---
"@zabloo/renderer-web": patch
---

pr: 92

Pointer events account for a canvas scaled with a CSS `transform`: if your host shrinks the
canvas to fit, controls now respond where they are painted instead of offset by the zoom
factor. A resize that does not change the backing store no longer clears the drawing buffer.
