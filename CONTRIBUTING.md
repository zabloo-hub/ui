# Contributing to zabloo/ui

Thanks for looking. This page is everything you need to get the repo running, make a
change and open a pull request that CI will like.

> **Status: pre-release.** The packages are not on npm yet and the IR is still moving in
> places. Small fixes and documentation are always welcome; before starting anything
> large, open an issue so we can check it against where the format is heading.

## Getting set up

Node ≥ 22 and pnpm (the repo pins its version through `packageManager`, so
`corepack enable` is enough).

```bash
git clone https://github.com/zabloo-hub/ui.git
cd ui
pnpm install
pnpm build      # do this first — see below
pnpm typecheck
pnpm test
pnpm lint
```

**Why `build` comes first.** Two reasons, and the second one will bite you if you skip it.

`typecheck` and `test` resolve workspace dependencies to their **sources**, so most
packages need no build at all. `packages/cli` is the exception, because two of its tests
run the real thing instead of a stand-in: the dev server serves the preview page's own
bundle, and the export tests run a project's code through jiti, which resolves
`@zabloo/react` from that project. Both want `pnpm build` to have run.

The other reason is the `zabloo` command itself. It is a **bin** of `@zabloo/cli`, and
pnpm links bins at *install* time — it can only link one whose target file already exists.
On a fresh clone `packages/cli/dist/cli.js` does not exist yet, so the shim is skipped
with nothing but a `WARN` in the install log, and the first thing you try to run gets:

```
sh: 1: zabloo: not found
```

`pnpm build` is written to close that gap on its own: it builds the packages, re-runs
`pnpm install` to link the workspace's bins now that their targets exist, and only then
exports the examples. So `pnpm install && pnpm build` leaves a clone fully working,
`pnpm dev` included. If you ever see `zabloo: not found`, a plain `pnpm install` is the
fix — you are looking at a shim that was skipped.

The examples building is deliberate too: `pnpm build` runs `zabloo export` in each of
them, so a change that breaks an example's export fails the build rather than going
unnoticed.

## Running things

```bash
pnpm --filter showcase-example dev     # the web preview at http://localhost:5078
pnpm --filter <name>-example build     # export one example's envelope to dist/

pnpm --filter @zabloo/renderer-web test   # one package's suite
pnpm verify:pack                          # the publish dry run (pack → install outside
                                          # the workspace → import → typecheck)
```

`pnpm dev` re-exports on every save into the live preview, which plays the part of the
game: a data panel for the envelope's bindings, a log of the named actions the UI fires,
and the live handle on `window.zabloo`. It is the fastest way to see a change.

## The golden corpus

[`golden/`](golden/README.md) is a cross-target artifact, not a fixture of one test suite:
the same envelopes must produce the same metrics in the web renderer and in the Unity SDK.
A change to layout, style resolution, motion or hit-testing will move it.

```bash
pnpm --filter @zabloo/renderer-web test          # compare against the corpus
pnpm --filter @zabloo/renderer-web test -- -u    # accept new metrics
```

Never accept new metrics without reading the diff. A moved number is either a bug you
just fixed or a bug you just introduced, and the corpus cannot tell you which — the diff
is the review.

## Changesets

**Every change that touches a package under `packages/` carries a changeset.** It is what
writes the changelog and picks the version bump, and CI has no way to recover one after
the fact.

```bash
pnpm changeset   # pick the packages, pick the bump, commit the generated file
```

Skip it only for changes that touch nothing publishable — documentation, examples, CI
config, this file. If you are unsure, add one: an unnecessary patch bump costs nothing.
The full pipeline is in [`docs/releasing.md`](docs/releasing.md).

## Branches and commits

Branches are named after the task they close: `zab-<number>-<kebab-case-title>` (for
example `zab-77-g4batch-7-oss-ready-polish`). Contributions from outside the team can use
any descriptive branch name.

Commit messages are written in the imperative and say what the commit *does*, with the
task reference at the end when there is one:

```
Abarata el frame de caret y mide presupuestos sobre escenas reales (ZAB-73)
```

## Opening a pull request

Before you push, run the four commands CI runs — `pnpm build && pnpm typecheck &&
pnpm test && pnpm lint`. Then:

- Say **what** changed and **why** it changed. A diff explains itself; a decision does not.
- Note anything you deliberately left out, and why.
- If the change is visible on screen, a screenshot or a short clip of the preview is worth
  more than a paragraph.
- If it moved the golden corpus, say what moved and why that is correct.

Formatting and linting are Biome's job, not yours: `pnpm format` writes, `pnpm lint`
checks. There is no style debate to have in review.

## Where things live

```
packages/format/        the IR types and the envelope reader/validator
packages/react/         the authoring bindings (React reconciler → IR)
packages/renderer-web/  the WebGL2 self-renderer used by the preview
packages/cli/           `zabloo` / `zb` — export, dev
packages/create-zabloo-app/  the project scaffolder
sdk/unity/              the UPM package (UI Toolkit custom geometry)
docs/                   the format spec and the component catalog
golden/                 the cross-target corpus
examples/               runnable authoring projects
```

The **golden rule** the architecture is built on: the shared core never knows about any
specific engine. Anything engine-specific belongs in that engine's SDK, never in
`packages/`.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you
are expected to uphold it.
