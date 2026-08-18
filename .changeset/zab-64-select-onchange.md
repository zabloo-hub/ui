---
"@zabloo/renderer-web": minor
"@zabloo/format": minor
"@zabloo/react": minor
---

`onChange` on `ContainerNode`, meaningful under `group: "exclusive-check"`: the group owns the
value, so the group is what answers "the selection moved". `<Select onChange>` was typed and
documented but never reached the IR, and the renderer only ever fired from the option node —
there was no typed way to get a named action out of a `<Select>`.

It carries no payload beyond the name and ZAB-29's `ActionContext` (the chosen option's); the
value already comes back through the data channel. It fires on the write edge, right after the
new value lands in the bound path, and never when re-picking the option already selected.
