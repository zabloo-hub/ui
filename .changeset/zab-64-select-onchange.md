---
"@zabloo/renderer-web": minor
"@zabloo/format": minor
"@zabloo/react": minor
---

`onChange` on a `Container` with `group: "exclusive-check"` fires a named action when the
group's selection moves — `<Select onChange>` and `<RadioGroup onChange>` now reach the IR and
fire, where before the prop was accepted and silently dropped. The action carries the chosen
option's `ActionContext`; the value itself still arrives through `onDataChanged`. Re-picking
the option already selected does not fire.
