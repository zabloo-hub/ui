---
"@zabloo/renderer-web": patch
---

pr: 52

Input and focus hold up under cancelled gestures, virtualized scrolling and several mounted views:

- `pointercancel` ends a gesture: a cancelled touch no longer leaves a button pressed or a
  slider following the pointer. A cancelled `Slider` drag commits, since its value is already
  on screen and in its binding.
- Focus on a virtualized `Repeat` row survives scrolling out of the window: it is remembered
  by item and restored when the row comes back, instead of jumping to the view's `autofocus`.
- With several views mounted on one page, keyboard and gamepad go to one owner — the first
  mounted, or the one the player last touched — instead of to all of them.
