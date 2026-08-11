# Shared fonts

The TTF every zabloo target rasterizes. It lives at the repo root, not inside a
package, because **the point is that all targets ship the same file**: the web
renderer embeds it (`packages/renderer-web/src/generated/font.ts`) and the Unity
SDK will read this very same file (ZAB-16).

Rasterization is core-owned (decision of 2026-08-11, ZAB-15): one algorithm —
stb_truetype — over one font, so metrics and bitmaps converge across targets
instead of drifting per engine.

## LiberationSans-Regular.ttf

- Version 2.1.5, SIL Open Font License 1.1 — see `LICENSE-LiberationSans-OFL.txt`.
- sha256 `bade59d822652f76e6941aa87b40a87c13d1cc70db98ededb5011127efafd1d3`
- Chosen because it is **metric-compatible with Arial**, which is what the web
  renderer's Canvas2D fallback and Unity's LegacyRuntime font both used before
  the shared rasterizer — so the switch barely moves existing layouts.

Replacing or adding a font means re-running
`packages/renderer-web/native/build.sh` and committing the regenerated
`src/generated/font.ts` along with it.
