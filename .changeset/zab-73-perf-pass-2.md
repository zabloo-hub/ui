---
"@zabloo/renderer-web": minor
---

The six hot paths ZAB-55 left out, plus the hole in its own budgets.

- **A blinking caret no longer runs the full pipeline at 60fps.** A focused `TextInput` marked
  the view `animating`, so the whole thing ran sync → resolve → measure → arrange → tessellate →
  draw to blink a 2px rectangle. But `caretVisible` is a closed form of the time since the last
  edit: neither the tree, its values nor its boxes depend on it. The frame is now requested on
  the flip and is a **repaint** — everything before tessellation is skipped. Leaving a field
  focused goes from 0.157 ms and 46.4 KB per 16 ms tick to 0.003 ms and 1.2 KB.
- `effectiveStyle` was recomputed three times per node per frame; it is cached on the node
  stamped with the frame counter.
- Five full tree walks per frame before layout are gone.

`FrameStats` gains `resolved`, `textLayouts`, `bufferGrowths` and `repaintOnly`, and the
performance budgets are asserted against realistic scenes at realistic sizes rather than
fifteen 480×320 ones on the first frame after mount.
