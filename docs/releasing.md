# Releasing

How a version of the `@zabloo/*` packages gets from a merged PR to npm, and how the
[Godot addon](#the-godot-addon) gets from the same commit to a GitHub Release. This page is
for maintainers; nothing here is needed to *use* zabloo/ui.

> **First release shipped 2026-08-22** — `@zabloo/*@0.2.0` and `create-zabloo-app@0.1.1`,
> published manually (the [bootstrap](#the-first-publish)). Every release from here goes
> through CI, behind three locks (see [The publish gate](#the-publish-gate)), once the
> Trusted Publishers are configured.

## The packages

Five packages are published from this repo:

| Package | What it is |
|---|---|
| `@zabloo/format` | The IR types and the envelope reader/validator. |
| `@zabloo/react` | The authoring bindings (React reconciler → IR). |
| `@zabloo/renderer-web` | The WebGL2 renderer used by the preview. |
| `@zabloo/cli` | `zabloo dev` / `export` / `validate` / `preview`. |
| `create-zabloo-app` | The scaffolder — unscoped, because `npx create-zabloo-app` is the funnel. |

`examples/*` are private and excluded from versioning by `privatePackages: { version: false }`
in [`.changeset/config.json`](../.changeset/config.json) — their own `"private": true`, not a
name list. The config used to carry `ignore: ["hello-button-example"]`, which named exactly one
of the four examples and read as if it were what kept them all out; it never was.

## The flow

1. **Every change that touches a package carries a changeset**: `pnpm changeset`, pick the
   packages and the bump, commit the generated file in `.changeset/`. CI enforces it — see
   [The changeset gate](#the-changeset-gate).
2. **Merging to `main`** runs the `version` job of [`release.yml`](../.github/workflows/release.yml),
   which opens or updates the **Version Packages** PR: changesets consumed, versions bumped,
   changelogs written. This publishes nothing.
3. **Merging the Version Packages PR** is what makes a version releasable. Still publishes nothing.
4. **Dry run**: Actions → Release → *Run workflow* → `mode: dry-run`. Builds everything, prints
   `changeset status --verbose` (what would be released) and simulates the publish.
5. **Publish**: Actions → Release → *Run workflow* → `mode: publish`. Waits for the environment
   approval, then runs `changeset publish` — which uploads only the packages whose version is not
   on the registry yet, tags the release commit — pushes the tags, and creates **one GitHub
   Release per tag** carrying that package's changelog section. CI authenticates with npm
   through [trusted publishing](#npm-trusted-publishing): there is no npm secret in the repo.

The very first release does not follow step 5 — see [The first publish](#the-first-publish).

Never run `pnpm changeset version` locally: the changelog generator asks GitHub for the PR
and author of each change and needs a token. The `version` job is the only place it runs.

## When to release

**Merging to `main` never publishes.** Every merge only updates the Version Packages PR, and
that PR can sit open for weeks accumulating entries — it is the staging area between "done"
and "released", and it shows the changelog as users will read it before anything ships.

A release is a decision, taken at a **milestone boundary** — the end of a batch, the end of a
phase — not a consequence of merging. Between releases, let the PR accumulate. There is no
development branch to integrate: `main` is always releasable (every PR passes `verify:pack`
and the external smoke test), and the Version Packages PR is the only thing standing between
`main` and the registry.

## Before you merge Version Packages

The Version Packages PR is the one editorial moment: its changelogs are generated from the
changesets as written, and a merged changelog is history. Before merging it:

- [ ] **Read every `CHANGELOG.md` section as a user would.** Anything that explains *why*
      instead of *what* gets rewritten — edit the changeset in `.changeset/`, push to `main`,
      and the PR regenerates. Do not edit the PR's generated files by hand.
- [ ] **Check the bump levels.** A `**Breaking:**` entry under a `patch` is a changeset that
      picked the wrong bump. In 0.x, breaking is `minor`.
- [ ] **Check the boundary.** Is everything that should be in this release merged? Is there a
      half-landed feature that should wait for the next one?
- [ ] `pnpm verify:pack` and `pnpm smoke:external` green on `main`.
- [ ] Merge. Then **dry-run**, then **publish** — steps 4 and 5 of [The flow](#the-flow).

## The Godot addon

The engine SDK does not go to npm — a Godot game installs an addon, not a package. It ships
as **`zabloo-godot-addon-<version>.zip`** attached to a GitHub Release: `addons/zabloo/` with
`plugin.cfg`, the GDScript of the editor plugin and the dev-mode autoload, the
`.gdextension`, and `bin/` with a binary per platform. Unzipping it at the root of a Godot
project is the whole installation.

### Its version is the `fixed` group's

The zip carries the same number as `@zabloo/format` and the rest of the
[fixed group](#the-packages) — read from `packages/format/package.json` at pack time and
stamped into `plugin.cfg`.

It is not an npm package and `changeset publish` never sees it, so this is a convention
rather than a mechanism. The reason to keep it is that **the addon and the packages agree on
one thing, and that thing is the format**: the `zabloo export` that wrote an envelope and the
core that reads it have to implement the same version of it, and the dev loop's transport is
a second contract between the same two halves. One number answers "which addon goes with the
packages I installed"; two numbers would mean maintaining a compatibility table for a
question that has one answer.

> This **amends** the 2026-08-24 decision, which gave the addon "its own cycle, its own
> audience". Its own *cycle* survives — the addon is released when the addon changes, not on
> every npm publish — but the version it carries is the group's.

### Releasing it

The **Godot addon** workflow, dispatched by hand like every other release here. It compiles
the extension for every platform (`template_debug` **and** `template_release` — Godot's
editor is a debug build, so a release-only zip installs and then has no `ZablooView`), packs
them with [`scripts/pack-addon.mjs`](../scripts/pack-addon.mjs), and either uploads the zip as
a workflow artifact (`dry-run`) or attaches it to the Release `godot-addon@<version>`
(`publish`).

What has to be in `bin/` is read from `zabloo.gdextension`, not from a list in the script: a
library Godot will look for and not find is a platform that silently has no addon, so a
missing one fails the pack. **Web is the exception** — experimental, its build never blocks,
and it ships when it built.

Add to [Before you merge Version Packages](#before-you-merge-version-packages), when the
release touches `core/` or `sdk/godot/`:

- [ ] Bump `version=` in `sdk/godot/addons/zabloo/plugin.cfg` to the group's new version.
      The pack stamps it anyway; the committed value is what a developer sees in the Plugins
      panel of a source install, and it should not be a number from three releases ago.
- [ ] After the npm publish, dispatch **Godot addon** in `dry-run`, download the artifact and
      install it in a clean Godot project. Then dispatch it in `publish`.

### The Asset Library

Godot's [Asset Library](https://godotengine.org/asset-library/asset) is the second
distribution channel and deliberately not the first: it is a catalog, and a catalog entry is
worth submitting once there is something to show. When that happens, the submission is a form
on the site (Godot account required) with the repository URL, a `4.x` version, the MIT
license, and a **download commit or a release tarball** — the Asset Library serves what the
form points at, so point it at the Release tag, never at `main`. Each version is reviewed by
hand before it appears, and an update is the same form again on the existing entry.

Nothing about the zip changes for it: the addon is already laid out the way the Asset Library
expects (`addons/<name>/` at the archive root).

## The Unity package

The Unity SDK does not go to npm either — a Unity game installs a UPM package, and the
package carries a native binary per platform. It ships as **`com.zabloo.sdk-<version>.tgz`**
attached to a GitHub Release: the package as checked in (`Runtime/`, `Editor/`, `Tests/`,
their `.meta` files) plus `Runtime/Plugins/` with the native core for macOS (universal),
Windows x64, Linux x64, Android arm64-v8a and iOS, each beside its `.meta`. Adding
`"com.zabloo.sdk": "file:<path to the .tgz>"` to a project's `Packages/manifest.json` is the
whole installation.

### Versioned with the `fixed` group, like the addon

The same rule as [the Godot addon's](#its-version-is-the-fixed-groups), for the same reason:
the SDK and the packages agree on the format, and one number answers "which SDK goes with the
packages I installed". `sdk/unity/package.json` is committed at `0.0.0` and stamped from
`packages/format/package.json` at pack time — the tarball's name comes from `npm pack`, so it
carries the number too.

### Releasing the package

The **Unity SDK** workflow, dispatched by hand. It builds the native core for each of the
five platforms (the same matrix as CI's `unity-plugin`), runs `scons install` on each runner
so the binary lands in its slot **with its `.meta`**, packs them with
[`scripts/pack-upm.mjs`](../scripts/pack-upm.mjs), and either uploads the tarball as a
workflow artifact (`dry-run`) or attaches it to the Release `unity-sdk@<version>`
(`publish`).

What has to be in `Runtime/Plugins/` is read from the `PLATFORMS` table of
`sdk/unity/SConstruct` — the table `scons install` writes each `.meta` from — not from a list
in the script: a slot Unity will look for and not find is a platform that silently has no
SDK, so a missing one fails the pack. A binary without its `.meta` fails it too, because
Unity would import the file with default settings and enable it for every platform. There
is no optional platform; `--allow-partial` exists for a local build you only mean to open on
this machine.

Add to [Before you merge Version Packages](#before-you-merge-version-packages), when the
release touches `core/` or `sdk/unity/`:

- [ ] After the npm publish, dispatch **Unity SDK** in `dry-run`, download the artifact and
      install it in a **clean** Unity project — 2022.3 LTS and Unity 6 — by tarball path.
      Add a `Canvas`, a `ZablooView` with `hello-button`'s envelope, press Play, and check
      that Enter fires `buy` on `OnAction`. That covers the editor; an IL2CPP player built
      from the same project (`sdk/unity/README.md` › *IL2CPP*) covers the other half. Then
      dispatch it in `publish`.

### OpenUPM

[OpenUPM](https://openupm.com/) is the second distribution channel and deliberately not the
first, for the same reason as Godot's Asset Library: it is a catalog, worth an entry once
there is something to show. It serves packages **from git tags** of a public repository, so
listing there would mean committing the native binaries under `Runtime/Plugins/` on a
release branch (the checkout ships none — they are build products, and `scons install` puts
them in place); the `.tgz` route exists because a git URL cannot carry them otherwise. When
it happens, the submission is a form on the site with the repository URL and the tag
pattern, and nothing about the package layout changes.

## Unity in CI

The Unity package's **native core** is built in CI for all five platforms on every PR
(`unity-plugin` in `ci.yml`, one artifact per platform with the binary in its
`Runtime/Plugins/` slot and its `.meta`). **Unity itself does not run in CI**: the editor
needs a license activated on the runner, and the way to get one — [GameCI](https://game.ci/)'s
`unity-builder` and `unity-test-runner` actions with a `UNITY_LICENSE` secret (a personal
license is activated by hand once and its `.ulf` stored as the secret; a Pro or Plus one uses
serial + credentials) — is a piece of infrastructure with its own upkeep: a license that
expires, an editor version pinned in the workflow, an image per platform, and a runner
hour per build.

It is documented here rather than done, for the same reason the Asset Library is: it is
added when it buys something. What it would buy is running the PlayMode suites
(`sdk/unity/Tests/PlayMode/`: the golden corpus inside Unity, the input tests, the
allocation test) and building the IL2CPP players on every PR instead of by hand. What it
costs is above. Until then the suites run in the editor, the players are built by hand
(`sdk/unity/README.md` › *IL2CPP*), and the README says so instead of pretending coverage.

When it is added, the shape is: `game-ci/unity-test-runner@v4` against
`examples/unity-playground` with `testMode: playmode`, after the `unity-plugin` artifact of
the runner's own platform has been downloaded into `sdk/unity/Runtime/Plugins/`; then
`game-ci/unity-builder@v4` with `targetPlatform: StandaloneOSX` / `StandaloneWindows64` and
the playground's IL2CPP settings. The license goes in `UNITY_LICENSE`; nothing else in the
repo changes.

## A hotfix to a published version

`main` may already carry unreleased changes a user of the published version must not get.
Then the fix ships from a branch cut at the tag, not from `main`:

```bash
git checkout -b release/0.2 @zabloo/cli@0.2.0   # any of the fixed group's tags works
git cherry-pick <fix>                             # the fix, with its changeset
```

Open the PR against `release/0.2`, and run the Release workflow from that branch: the
`version` job opens a Version Packages PR against it, and `publish` publishes `0.2.1` with no
trace of what `main` holds. Merge the fix forward into `main` afterwards. The branch lives as
long as that line is supported — which, while the packages are 0.x, is usually not at all:
the next release from `main` supersedes it.

## The changeset gate

A change with no changeset is not a smaller release — it is a release whose changelog does
not mention it. That is how this repo spent ~10 commits, one of them a behavior change across
`format`/`react`/`renderer-web`, with `.changeset/` holding nothing but its README: the first
changelog would have come out empty and nothing would have said so.

[`scripts/changeset-gate.mjs`](../scripts/changeset-gate.mjs) runs on every pull request and
fails it when a **published** package has a changed file that reaches its tarball and no pending
changeset names it. Run it locally the same way CI does:

```bash
node scripts/changeset-gate.mjs --since origin/main
```

It is deliberately narrower than `changeset status --since`, which asks changesets itself which
packages moved and counts a `*.test.ts` edit as one — so a PR that adds a test to one package
and a real fix (with its changeset) to another would be told to write a changeset for the tests.
What ships is `dist/`, built from `src/`, so tests, `vitest.config.ts` and `CHANGELOG.md` are
outside the blast radius. Everything outside `packages/` — docs, workflows, `examples/`,
`golden/`, `scripts/` — needs no changeset at all, and a docs-only PR passes untouched.

The Version Packages PR is skipped by its `changeset-release/` branch prefix: that PR is
changesets *consuming* the changesets, and demanding new ones there would deadlock the release.

## The publish gate

The publish job cannot run by accident:

- It only exists on `workflow_dispatch` with `mode: publish` — no push, schedule or PR reaches it.
- It runs in the `npm-publish` environment, which has a **required reviewer**. Even a deliberate
  dispatch waits for an approval click.
- On the npm side, each package's Trusted Publisher names this repo, this workflow file *and*
  the `npm-publish` environment. Any other workflow, fork or environment that asks npm for a
  publish token gets nothing.

The dry-run job has none of these, because `--dry-run` cannot reach the registry's write side.
It needs no npm identity at all, so it is the job to use for rehearsals — including today, before
anything on npmjs.com is configured.

## npm trusted publishing

There is no `NPM_TOKEN`, and there will not be one. npm is retiring the tokens that could publish
from CI without 2FA (the token-creation UI says so outright: *"For automation or CI/CD uses,
please use Trusted Publishing instead"*, checked 2026-08-18). What replaces them is
[trusted publishing](https://docs.npmjs.com/trusted-publishers): the workflow proves who it is
with a short-lived OIDC token GitHub mints for that run, npm checks it against the Trusted
Publisher configured on the package, and hands back a publish token that dies with the job.
Nothing to store, rotate, or leak.

What the publish job does for it:

- `permissions: id-token: write` — without it the runner has no OIDC endpoint. The job checks
  for the endpoint (`ACTIONS_ID_TOKEN_REQUEST_URL`) before building anything and fails with a
  clear message if it is missing.
- **npm ≥ 11.5.1** — the first npm that knows the OIDC flow. `changeset publish` runs
  `pnpm publish`, and pnpm hands the upload to whatever `npm` is on the `PATH`, so the job runs on
  Node 24 (which ships npm 11.5+) while every other job stays on Node 22, and checks
  `npm --version` up front.
- Nothing else. `npm publish` picks the OIDC context up on its own; there is no `NODE_AUTH_TOKEN`
  in the environment and no flag to pass.

**Provenance** comes with it: for a public repo publishing public packages, trusted publishing
attaches a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
linking each tarball to the workflow run and commit that built it. No `--provenance` flag, no
`NPM_CONFIG_PROVENANCE`; npm shows it on the package page.

The one thing trusted publishing cannot do is create a package: the Trusted Publisher is
configured *on* a package, in its settings, so the package has to exist first. That is why the
first release is manual — next section.

## The first publish

**Done on 2026-08-22**: the five packages were published from a maintainer's laptop exactly as
the bootstrap below describes, tagged, and given their GitHub Releases with
`node scripts/github-releases.mjs`. It stays here as the record of how the first release was
made, and because the second phase — the Trusted Publishers — is what makes every later
release CI's job instead of a laptop's.

### Bootstrap (manual, once — done)

The first version of the five packages goes out from a maintainer's laptop, with the maintainer's
own 2FA. `changeset publish` is the same command CI uses, so nothing about the release differs
except who runs it:

```bash
git checkout main && git pull            # the merged Version Packages commit
pnpm install --frozen-lockfile
pnpm build && pnpm typecheck && pnpm test
pnpm changeset status --verbose          # what is about to go out
pnpm changeset publish                   # asks for the OTP; publishes what is not on npm yet
git push --tags
```

`changeset publish` publishes only what the registry does not have, in dependency order, with
`access: public` from [`.changeset/config.json`](../.changeset/config.json), and tags the commit
per package (`@zabloo/format@0.1.0`, …). Run `pnpm smoke:external` first if it has not run
recently — see [The external smoke test](#the-external-smoke-test).

Once the five packages exist on npm, do the next phase before anything else, so the second
release already goes through CI.

### Trusted Publisher, one per package

For **each** of the five packages — `@zabloo/format`, `@zabloo/react`, `@zabloo/renderer-web`,
`@zabloo/cli`, `create-zabloo-app` — on [npmjs.com](https://www.npmjs.com), signed in as an owner:

1. Open the package page → **Settings**.
2. Under **Trusted Publisher** (npm's docs call the section *Trusted publishing*), choose
   **GitHub Actions** and fill in:
   - **Organization or user**: `zabloo-hub`
   - **Repository**: `ui`
   - **Workflow filename**: `release.yml` — the filename only, not the path, and it is
     case-sensitive; it has to match the file under `.github/workflows/`.
   - **Environment name**: `npm-publish` — this is what ties the publish to the required
     reviewer; leave it empty and any run of the workflow could publish, approval or not.
   - **Allowed actions**: `npm publish`.
3. Save. A package holds exactly one Trusted Publisher at a time.
4. Still in Settings → **Publishing access**, pick **Require two-factor authentication and
   disallow tokens**. It only shuts the door on classic tokens; trusted publishing is not a
   token and keeps working. From then on, the only way to publish is a human with 2FA or this
   workflow with an approval click.

Note that npm matches the workflow against the package's `repository.url`, which every package
sets to `git+https://github.com/zabloo-hub/ui.git` — if the repo ever moves, that field moves
with it or trusted publishing stops.

After that, every release is step 5 of [The flow](#the-flow): dispatch with `mode: publish`,
approve, done. There is no way to verify the Trusted Publisher configuration short of a real
publish, so the first CI release is the test; if it fails, the failure is at the token exchange,
before any upload, and nothing half-publishes.

## One-time setup on GitHub

- [x] **Environment `npm-publish`** (repo settings → Environments) with a **required
      reviewer**. Created 2026-08-18. Without it the publish job would run unattended once
      dispatched, and the Trusted Publisher configuration above names it.
- [ ] **Allow GitHub Actions to create and approve pull requests** (repo settings → Actions →
      General → Workflow permissions). The `version` job cannot open the Version Packages PR
      without it.

Note that the Version Packages PR is created with the default `GITHUB_TOKEN`, and PRs created that
way [do not trigger other workflows](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow) —
CI will not run on it. Closing and reopening the PR runs CI; a PAT would fix it permanently, at the
cost of keeping a PAT around. Not worth it until the first real release.

## The external smoke test

Packing and CI both prove the packages *build*. What they cannot prove is that a package does not
quietly depend on something only the workspace provides — a file left out of `files`, a
devDependency hoisted from the root, a `workspace:*` that never got rewritten. Inside the monorepo
that never fails, because pnpm resolves `@zabloo/*` through the workspace.

`pnpm smoke:external` ([`scripts/smoke-external.mjs`](../scripts/smoke-external.mjs)) runs the real
thing, outside the repo:

```
pnpm -r build → pnpm pack (5 packages) → npm exec --package=<tarball> create-zabloo-app
  → pnpm install (in a tmpdir, no workspace above it) → typecheck → zabloo export
  → readEnvelope() from the packed @zabloo/format
```

Add `--keep` to leave the temporary project on disk for inspection.

The one thing it cannot reproduce is the registry: the packed tarballs depend on a
`@zabloo/format` version that is not published, so the scaffolded project's zabloo dependencies are
rewritten to `file:` tarball paths. The *versions* are faked; the package *contents* are not, which
is what is being tested.

It runs in CI weekly and on demand ([`smoke.yml`](../.github/workflows/smoke.yml)), not on every PR:
it packs five packages and does a real install, and what it guards against moves on the scale of
days, not commits.
