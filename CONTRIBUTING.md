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
game: a typed field per bound path in the bindings panel, the named actions the UI fires in
the console's **Actions** tab, the validator's diagnostics in **Problems**, and the live
handle on `window.zabloo`. It is the fastest way to see a change.

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

**Your pull request declares its own changes.** The gate looks at the changesets your
branch adds or edits, not at everything sitting in `.changeset/`, so a pending changeset
from someone else's pull request will not cover you even when it names your package.
That is the case it exists for: a real change once shipped with no changelog entry
because an earlier, unreleased changeset happened to name the same package.

### Writing a changeset

The text of a changeset becomes a line of `CHANGELOG.md`, and the person reading it is
running `npm update` — not reviewing your code, not maintaining this repo. Write **what
changed, what it means for their code, and how to migrate**, and stop there:

```md
---
"@zabloo/renderer-web": minor
---

New `onDiagnostic` in `MountOptions`: receive the structured diagnostics `readEnvelope`
produces on `mount` and `reload`, instead of reading them off `console.warn`. Without a
sink, the console output is unchanged.
```

- **One to three sentences, present tense, starting with the thing that changed** — the
  prop, the command, the behavior. Bullets when one changeset genuinely carries several
  independent changes to the same package.
- **One changeset per change a user can notice**, not per ticket or pull request. A PR that
  fixes a bug and adds an option is two changesets.
- **When packages are affected differently, one changeset per package**, each saying only
  what that package's users will see. A single text listed under three packages lands in
  all three changelogs verbatim, including the parts that are not about them.
- **A breaking change opens with `**Breaking:**` and says what to do.** While the packages
  are 0.x, a breaking change is a `minor`; `patch` is for fixes and anything a user does
  not have to react to.
- **No commit hashes, no ticket ids, no "why".** The PR link and the author are added
  automatically; the reasoning belongs in the pull request, and a decision belongs in the
  decision log. Commit messages and PR descriptions are where the house voice explains
  itself — the changelog is where it does not.

Versions move together: `@zabloo/format`, `@zabloo/react`, `@zabloo/renderer-web` and
`@zabloo/cli` share one version number (a `fixed` group in `.changeset/config.json`), so
there is never a question of which `react` goes with which `renderer-web`. A bump to one is
a bump to all four; the changelog of each still lists only its own changes.
`create-zabloo-app` is versioned on its own.

### Docs are part of done

A change is not finished when the code is. What else it has to carry, by kind:

| The change | Carries |
|---|---|
| A new prop, value or state on a component | its `docs/components/` page, the format page if the IR gained a field, a changeset |
| A new CLI command or flag | `packages/cli/README.md`, `docs/project-structure.md`, a changeset |
| A behavior change a user can observe | the normative page that describes it, a changeset — and a decision-log entry when it was a decision, not a fix |
| A bug fix with no contract change | a changeset (and a test) |
| An internal refactor, a test, a CI change | nothing — no changeset, no docs |

The root `README.md` describes the product and changes only when the product does; a
package `README.md` is install + the minimal usage + a link to `docs/`, and never
duplicates a docs page.

## Branches and commits

Branches are named after the task they close: `zab-<number>-<kebab-case-title>` (for
example `zab-77-g4batch-7-oss-ready-polish`). Contributions from outside the team can use
any descriptive branch name.

Commit messages are written in the imperative and say what the commit *does*, with the
task reference at the end when there is one:

```
Abarata el frame de caret y mide presupuestos sobre escenas reales (ZAB-73)
```

## Code style

Biome owns formatting and most style rules (`pnpm format` writes, `pnpm lint` checks).
Two house conventions are enforced as errors, and knowing them beats meeting them as CI
failures:

- **Exports go at the end of the file.** Declare above, export below, in one
  `export { … }` / `export type { … }` block — no inline `export` on a declaration.
  Biome's `useExportsLast` only sees a file that MIXES the two styles, so
  `scripts/lint/exports-last.mjs` (part of `pnpm lint`) covers the one where every
  declaration is an inline export. Its header says why it is a script and not a
  Biome plugin, and carries the list of files still waiting to be swept.
- **`const`, never `let` — no exceptions**, not even `for (let i = 0; …)`. The
  reassignment is the smell, not the keyword: an accumulator is a `reduce`, a
  transformed sequence is a `map`, a counter loop is `entries()` or `keys()`, a
  conditionally-built value is a function that returns it, and a slot some external API
  insists on owning is a field of a `const` holder. Enforced by a GritQL plugin
  ([`scripts/lint/no-let.grit`](scripts/lint/no-let.grit)).

One caution that came out of the sweep that introduced these rules: in the hot paths
(`layout.ts`, `text.ts`, `tessellator.ts`) do not materialize a range inside a loop that
runs per node and per frame — hoist it to a module constant, and check the frame budgets
(`budgets.test.ts`) before and after, not just the suite.

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
packages/preview/       the chrome around that canvas — private, but its build ships in the CLI
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
