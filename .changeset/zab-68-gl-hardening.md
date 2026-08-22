---
"@zabloo/renderer-web": patch
---

pr: 48

Two GPU failure modes that used to leave the canvas blank or scrambled are now handled:

- The renderer survives WebGL context loss: on `webglcontextrestored` it rebuilds its GPU
  resources and re-uploads atlases and images, instead of staying blank.
- Geometry no longer scrambles past 65,536 vertices in one batch (a long unvirtualized list):
  indices are 32-bit.
