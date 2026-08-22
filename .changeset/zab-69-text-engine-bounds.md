---
"@zabloo/renderer-web": patch
---

- `fontSize` is clamped to 1–512 px; the ceiling is normative. A glyph that cannot be
  rasterized renders blank with one warning instead of throwing inside a frame.
- Wrapping a very long unbroken word is linear instead of quadratic, `maxLines` stops the work
  early, and kerning and text layout are memoized. Break points and widths are unchanged.
