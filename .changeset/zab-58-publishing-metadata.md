---
"create-zabloo-app": patch
"@zabloo/renderer-web": patch
"@zabloo/format": patch
"@zabloo/react": patch
"@zabloo/cli": patch
---

Give every package a README and complete npm metadata (`repository` with its monorepo
`directory`, `homepage`, `bugs`, `keywords`, `engines.node`, explicit
`publishConfig.access`), and ship `LICENSE` inside each tarball instead of only at the
repo root. `@zabloo/cli` and `create-zabloo-app` close their `exports` to
`./package.json`: they are executables, not libraries.

Fix the import that made `@zabloo/react` unimportable from Node — `react-reconciler/constants`
has no extension and that package declares no `exports`, so the ESM resolver refused it
(`ERR_MODULE_NOT_FOUND`) for every real consumer.
