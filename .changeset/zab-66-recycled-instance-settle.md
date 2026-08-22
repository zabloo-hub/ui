---
"@zabloo/renderer-web": patch
---

A recycled `Repeat` row no longer animates from the previous item's values when it is reused
for a new one: the whole subtree settles on the new item's data in its first frame. A change to
the same item's own data still animates.
