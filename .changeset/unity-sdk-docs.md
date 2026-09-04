---
"create-zabloo-app": patch
---

The scaffolded README now installs the released Unity SDK — the `com.zabloo.sdk` tarball added to `Packages/manifest.json` by path — and shows the C# wiring (`OnAction`, `OnDataChanged`, `SetData` on the `ZablooView` component) beside the Godot one. `pnpm dev:unity` is listed with the other commands.
