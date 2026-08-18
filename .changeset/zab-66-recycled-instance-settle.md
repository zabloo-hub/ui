---
"@zabloo/renderer-web": patch
---

Settle the whole subtree of a recycled `Repeat` instance, not just its bound nodes.
`applyBindings(node, true)` promised "this starts ON this data, so there is nothing to animate
from" and did not keep it: it settled the value but left `node.anim` alone, so the next resolve
pass read the previous row's value from there, saw a different target and re-targeted — the
settle was undone and the row animated.

The walk covers the subtree rather than the bound set because no `style` value is bindable in
v1: per-item variation arrives through state flags, and the heaviest case is an **inherited**
`disabled` whose label reads no data at all. A change to the item's own data still animates —
the settle is for the change of identity.
