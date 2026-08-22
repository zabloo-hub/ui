---
"create-zabloo-app": patch
"@zabloo/renderer-web": patch
"@zabloo/format": patch
"@zabloo/react": patch
"@zabloo/cli": patch
---

Every package ships its README, `LICENSE` and complete npm metadata (`repository`,
`homepage`, `bugs`, `keywords`, `engines`). `@zabloo/cli` and `create-zabloo-app` expose only
`./package.json` — they are executables, not libraries.
