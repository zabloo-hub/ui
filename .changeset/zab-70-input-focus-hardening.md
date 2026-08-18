---
"@zabloo/renderer-web": patch
---

Three input and focus holes, each with its normative rule.

- `pointercancel` was not listened for, so a cancelled pointer left the gesture in flight
  forever — a button frozen pressed, a slider still following the next move. Every gesture now
  terminates and none concludes, except the Slider, which settles: its value is already on
  screen and written to its binding.
- The focus of a virtualized row died when it left the window and the next frame handed it to
  the view's autofocus — a jump across the screen caused by the wheel, a drag or the right
  stick. It is now a **logical** focus, remembered as the item it sat on, and the row recovers
  it when it is realized again.
- Keyboard and gamepad hung off `globalThis` while the pointer was scoped to the canvas, so two
  mounted views each moved their own focus with the same arrow and consumed the same pad. There
  is an owner now: the first mounted, and whichever the player touches takes it.
