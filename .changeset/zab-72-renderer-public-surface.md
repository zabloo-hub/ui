---
"@zabloo/renderer-web": minor
---

pr: 50

The renderer's public surface closes three gaps:

- New `onDiagnostic` in `MountOptions`: receive the structured diagnostics (`code`, `path`,
  `level`) `readEnvelope` produces on `mount` and `reload`, instead of reading them off
  `console.warn`. Without a sink, the console output is unchanged.
- `handle.viewIds` is a getter and reflects the views after a `reload`.
- `findNode` is exported alongside `serializeSnapshot`.
