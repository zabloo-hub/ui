---
"@zabloo/cli": minor
---

pr: 58

The CLI gains the commands a studio's own CI needs, and the preview the controls it was missing:

- `zabloo validate [file]` checks an envelope on disk with the same loading contract every
  SDK applies: exit `0` when it loads, `1` on a fatal, `--strict` to fail on repaired warnings
  too, `--json` for machine-readable diagnostics.
- `zabloo preview <envelope.json>` serves the preview for an envelope with no project around
  it, reloading when the file changes.
- `zabloo export --out <file>` writes the envelope where you say; `zabloo dev --open` opens
  the browser.
- The preview gets viewport presets (1920×1080, 1280×720, custom) with a DPR selector, a
  frame-stats badge, and an SSE keepalive so live reload survives proxies.
- The preview refuses requests for a `Host` that is not localhost (DNS-rebinding guard); pass
  `--allow-host <host>` behind a Codespace or a tunnel.
