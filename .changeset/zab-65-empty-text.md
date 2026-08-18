---
"@zabloo/format": patch
---

Accept the empty string as `Text` content. `@zabloo/react` emits `text: ""` routinely — a
`<Select>` label whose value is not a binding, a `<Badge>` with no count, `<Text></Text>` — and
`readEnvelope` was dropping those nodes with `invalid-node`. What sinks a node is the field
being **absent**, not empty; they are different things and now they say so.

An empty `Text` measures one line (0 × lineHeight), which becomes normative: a `<Row gap={8}>`
keeps its slot and both gaps when a binding empties, instead of collapsing and shifting its
siblings. Purely additive — the set of envelopes that load only grows.
