---
"@zabloo/renderer-web": minor
---

- A focused `TextInput`'s caret blink no longer re-runs the whole layout pipeline at 60 fps —
  it is a repaint.
- `FrameStats` gains `resolved`, `textLayouts`, `bufferGrowths` and `repaintOnly`.
- Per-frame cost drops across the board: style resolution is cached per node and frame, and
  the pre-layout tree walks are gone.
