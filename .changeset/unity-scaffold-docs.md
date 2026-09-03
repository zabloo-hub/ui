---
"create-zabloo-app": patch
---

The scaffolded README no longer describes the Unity SDK: that SDK was removed and is being rebuilt as a thin adapter over the native core (F12). `pnpm dev:unity` is still generated and still pushes to `localhost:5077`; it targets the new SDK once it exists.
