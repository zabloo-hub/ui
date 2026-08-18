---
"@zabloo/renderer-web": minor
"@zabloo/react": minor
"@zabloo/cli": minor
---

Close seven gaps and asymmetries in the renderer's public surface before the freeze — things
the renderer knows and would not let you read, or exposed two different ways.

- **`onDiagnostic` in `MountOptions`.** `@zabloo/format` produces *structured* diagnostics —
  stable code, path into the envelope — and `loadEnvelope` dumped them to `console.warn`, where
  that structure died: a dev server overlay, the preview and the future editor cannot scrape a
  console. The sink receives warns and fatals, on both `mount` and `reload`, and the fatals
  arrive before the throw. Without a sink the console lines are exactly what they always were.
- The preview stops depending on the console: a repaired `warn` takes the fading log line, a
  `fatal` takes the overlay and the red dot.
- **`handle.viewIds` is a getter.** It was `Object.keys()` evaluated once when the handle was
  built, so after a `reload` the caller still listed the views from before the save — a save
  that added a view left it invisible until a manual page reload.
- **`findNode` is exported**: `serializeSnapshot` was there, but reading a `ViewSnapshot` needs
  the single node.
