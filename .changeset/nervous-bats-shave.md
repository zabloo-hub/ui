---
"@zabloo/renderer-web": patch
---

An `Overlay` with `anchor.trigger: "press"` no longer times out: `autoCloseMs` is ignored on
a popover, as it already was on a `"hover"` one — a menu is dismissed, not timed out. An
anchored overlay whose trigger is `manual` is unaffected and still counts down.
