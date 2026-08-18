---
"@zabloo/renderer-web": patch
---

Bound the text engine's two unbounded inputs and two per-frame hot paths.

- `fontSize` is clamped to 1..512 where style resolves, and the ceiling is normative.
- Rasterization degrades to a blank glyph with one warning per atlas instead of letting
  `zb_malloc`'s throw escape the measure pass into rAF.
- `reserve()` checks width too: a glyph wider than the atlas used to be placed anyway, off the
  edge, with UVs above 1.
- `breakWord` measures each glyph once instead of re-measuring the rest of the line per line
  (2.1 lookups per glyph against ~10⁹ for a 50k token), and `maxLines` stops the work as soon as
  it is satisfied. Kerning is memoized per pair and atlas, `layoutText` per node.

Break points and widths are unchanged.
