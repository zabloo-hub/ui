---
"@zabloo/format": patch
---

`readEnvelope` accepts `text: ""` on a `Text` node instead of dropping the node as
`invalid-node` — an empty label keeps its one-line height and its slot in the layout. A `Text`
with no `text` field at all is still rejected.
