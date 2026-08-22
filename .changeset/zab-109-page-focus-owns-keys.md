---
"@zabloo/renderer-web": patch
---

The renderer reads keyboard input only while the page's focus is on its canvas (or on the
hidden field a focused `TextInput` types through), and no longer calls `preventDefault()` on
keys it does not own — buttons and inputs in the UI around the canvas work from the keyboard
again. The canvas is now focusable (`tabindex="0"` unless you set your own): clicking it takes
the focus, and Tab moves in and out of the game. If your host relied on the renderer capturing
keys globally, focus the canvas first.
