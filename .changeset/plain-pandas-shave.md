---
"@zabloo/renderer-web": patch
---

A `Slider` being nudged with an arrow key no longer fires `onCommit` when the game
disables it mid-gesture. It is cancelled instead, which is what the pointer's drag
already did and what the component's contract says: the value never settled.
