---
"@zabloo/renderer-web": patch
"@zabloo/react": patch
"@zabloo/cli": patch
---

JSDoc corrections on the public surface. `ToggleControlProps.onChange` said it fired
"after every change" without the grouped case: inside a `<RadioGroup>` or `<Select>` it
fires only for the option that TAKES the selection, never for the one that loses it. The
remaining Spanish comments in `export.ts` and the perf scenes are now English.
