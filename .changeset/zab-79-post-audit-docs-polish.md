---
"@zabloo/renderer-web": patch
"@zabloo/react": patch
"@zabloo/cli": patch
---

pr: 59

JSDoc corrections on the public surface: `ToggleControlProps.onChange` now documents that,
inside a `<RadioGroup>` or `<Select>`, it fires only for the option that takes the selection.
Remaining non-English comments translated.
