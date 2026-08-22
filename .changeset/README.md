# Changesets

Each file here is one entry of a future `CHANGELOG.md`. `pnpm changeset` writes the
frontmatter (which packages, which bump); the text is yours, and it is read by someone
running `npm update` — not by the maintainer, and not by a reviewer.

**Write what changed, what it means for their code, and how to migrate. Nothing else.**

```md
---
"@zabloo/renderer-web": minor
---

New `onDiagnostic` in `MountOptions`: receive the structured diagnostics `readEnvelope`
produces on `mount` and `reload`, instead of reading them off `console.warn`. Without a
sink, the console output is unchanged.
```

- One to three sentences, present tense, starting with the thing that changed.
- One changeset per change a user can notice — not per ticket, not per pull request.
- When packages are affected differently, one changeset per package, each saying only
  what that package's users will see.
- A breaking change opens with `**Breaking:**` and says what to do. In 0.x it is a `minor`.
- No commit hashes, ticket ids or "why": the PR link and author are added automatically,
  and the reasoning belongs in the pull request and the decision log.

Full conventions: [`CONTRIBUTING.md`](../CONTRIBUTING.md#writing-a-changeset) · the release
ritual: [`docs/releasing.md`](../docs/releasing.md).
