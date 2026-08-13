# Releasing

How a version of the `@zabloo/*` packages gets from a merged PR to npm. This page is
for maintainers; nothing here is needed to *use* zabloo/ui.

> **Nothing is published yet.** The pipeline exists and has been rehearsed dry, but the
> roadmap decision stands: the SDK is feature-complete *before* anything is published.
> Publishing is deliberately behind two locks (see [The gate](#the-gate)).

## The packages

Five packages are published from this repo:

| Package | What it is |
|---|---|
| `@zabloo/format` | The IR types and the envelope reader/validator. |
| `@zabloo/react` | The authoring bindings (React reconciler → IR). |
| `@zabloo/renderer-web` | The WebGL2 renderer used by the preview. |
| `@zabloo/cli` | `zabloo dev` / `zabloo export`. |
| `create-zabloo-app` | The scaffolder — unscoped, because `npx create-zabloo-app` is the funnel. |

`examples/*` are private and excluded from versioning (`ignore` in `.changeset/config.json`).

## The flow

1. **Every change that touches a package carries a changeset**: `pnpm changeset`, pick the
   packages and the bump, commit the generated file in `.changeset/`.
2. **Merging to `main`** runs the `version` job of [`release.yml`](../.github/workflows/release.yml),
   which opens or updates the **Version Packages** PR: changesets consumed, versions bumped,
   changelogs written. This publishes nothing.
3. **Merging the Version Packages PR** is what makes a version releasable. Still publishes nothing.
4. **Dry run**: Actions → Release → *Run workflow* → `mode: dry-run`. Builds everything, prints
   `changeset status --verbose` (what would be released) and simulates the publish.
5. **Publish**: Actions → Release → *Run workflow* → `mode: publish`. Waits for the environment
   approval, then runs `changeset publish` — which uploads only the packages whose version is not
   on the registry yet, and tags the release commit.

## The gate

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

## The `@zabloo` scope — status

Checked **2026-08-13**, read-only, against the public registry:

- `@zabloo/format`, `@zabloo/react`, `@zabloo/cli`, `@zabloo/renderer-web` and `create-zabloo-app`
  all return **404** — nothing has been published, and the unscoped name `create-zabloo-app` is
  still free.
- A registry search for `scope:zabloo` returns **0 packages**.
- The npm token in the maintainer's local `~/.npmrc` is **expired or invalid** (`npm whoami` → 401),
  so **ownership of the scope could not be confirmed from the outside**.

Still to verify, and it needs an authenticated `npm login`:

- [ ] `npm whoami` works again, and `npm org ls zabloo` (or `npm access list packages @zabloo`)
      confirms the scope exists and who owns it.
- [ ] The account has 2FA on, with the authorization level that still allows automation tokens to
      publish (2FA *and* automation tokens, not "require 2FA for every publish", which would block CI).
- [ ] A granular token scoped to `@zabloo` can publish — provable only on the first real release, or
      against a throwaway scoped package.

A 404 on an unpublished scope looks identical to a scope that was never registered, so this is worth
resolving before F9 rather than on launch day.

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

The one thing it cannot reproduce is the registry: the packed tarballs depend on
`@zabloo/format@0.1.0`, which is not published, so the scaffolded project's zabloo dependencies are
rewritten to `file:` tarball paths. The *versions* are faked; the package *contents* are not, which
is what is being tested.

It runs in CI weekly and on demand ([`smoke.yml`](../.github/workflows/smoke.yml)), not on every PR:
it packs five packages and does a real install, and what it guards against moves on the scale of
days, not commits.
