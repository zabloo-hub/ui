---
"@zabloo/renderer-web": patch
---

Harden the renderer against the browser's GPU failures.

- **WebGL context loss is handled.** A backgrounded mobile tab, a GPU reset or a driver hiccup
  used to leave the canvas blank forever, every GL call a silent no-op. `GLRenderer` now listens
  for `webglcontextlost` (with `preventDefault`, without which the restore never fires) and
  `webglcontextrestored`, rebuilding program, buffers, attributes and the white texture — the
  context comes back empty. Dropping the texture map on loss is what makes the next frame
  re-upload atlases and images on its own.
- **16-bit index space overflow.** Past 65,536 vertices in one (clip group × texture) batch the
  index wrapped mod 65536 and the geometry scrambled with no warning — roughly a long
  unvirtualized list. Indices are `Uint32Array` and the draw is `UNSIGNED_INT` (core in WebGL2),
  so the ceiling moves to 4G vertices and no guard is needed.
