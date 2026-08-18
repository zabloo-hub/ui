<!--
  Thanks for the contribution. Keep whatever sections are useful and delete the rest —
  a small fix does not need a long form. CONTRIBUTING.md has the full workflow.
-->

## What this does

<!-- One or two sentences. What changed, and why it changed — the diff explains itself,
     a decision does not. -->

## Why

<!-- The problem this solves, or the issue it closes: `Fixes #123`. -->

## How it was verified

<!-- What you ran and what you looked at. -->

- [ ] `pnpm build && pnpm typecheck && pnpm test && pnpm lint` all pass
- [ ] Tests cover the change (or: why they don't)
- [ ] Checked in the preview (`pnpm --filter <name>-example dev`)

## Checklist

- [ ] **Changeset added** (`pnpm changeset`) — required for any change under `packages/`.
      Not needed for docs, examples or CI.
- [ ] **Docs updated** if this changes the format or a component's behavior — the pages
      in `docs/` are normative, not a description of the code.
- [ ] **Golden corpus**: unchanged, or the diff is explained below.

<!-- If `golden/` moved, say which metrics moved and why that is the correct value now.
     A moved number is either a bug fixed or a bug introduced, and the corpus cannot
     tell the reviewer which one. -->

## Screenshots

<!-- If it is visible on screen, show it. Before/after beats a paragraph. -->
