# Releasing

How a version of the `@zabloo/*` packages gets from a merged PR to npm. This page is
for maintainers; nothing here is needed to *use* zabloo/ui.

> **Nothing is published yet.** The pipeline exists and has been rehearsed dry, but the
> roadmap decision stands: the SDK is feature-complete *before* anything is published.
> Publishing is deliberately behind two locks (see [The publish gate](#the-publish-gate)).

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
   on the registry yet, and tags the release commit.

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

The dry-run job has neither lock, because `--dry-run` cannot reach the registry's write side. That
is the job to use for rehearsals.

## One-time setup on GitHub

None of this is configured yet. It is needed before step 5 above can work:

- [ ] **Secret `NPM_TOKEN`** (repo settings → Secrets and variables → Actions). A *granular access
      token* limited to the `@zabloo` scope with **read and write** permission. The publish job
      fails immediately with a clear message if it is missing, before building anything.
- [ ] **Environment `npm-publish`** (repo settings → Environments) with at least one **required
      reviewer**. Without it the publish job would run unattended once dispatched.
- [ ] **Allow GitHub Actions to create and approve pull requests** (repo settings → Actions →
      General → Workflow permissions). The `version` job cannot open the Version Packages PR
      without it.

Note that the Version Packages PR is created with the default `GITHUB_TOKEN`, and PRs created that
way [do not trigger other workflows](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow) —
CI will not run on it. Closing and reopening the PR runs CI; a PAT would fix it permanently, at the
cost of keeping a PAT around. Not worth it until the first real release.

## npm provenance

The publish job requests `id-token: write` and sets `NPM_CONFIG_PROVENANCE=true`, so packages are
published with a [provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
linking each tarball to the workflow run and commit that built it. It costs nothing and npm shows
it on the package page.

## Before the first publish

Nothing under `@zabloo` has been published yet, and an unpublished scope is indistinguishable
from the outside from one that was never registered: every package name returns a 404 either
way. So the registry side has to be confirmed while authenticated, and it is worth doing ahead
of the first release rather than on the day of it.

- [ ] **The scope exists and we own it.** `npm whoami` against an authenticated session, then
      `npm org ls zabloo` (or `npm access list packages @zabloo`).
- [ ] **2FA is set to a level automation tokens can publish under** — "2FA *and* automation
      tokens", not "require 2FA for every publish", which would block CI.
- [ ] **A granular token scoped to `@zabloo` can actually publish.** Provable only on the first
      real release, or against a throwaway scoped package.

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
