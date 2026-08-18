# Releasing

How a version of the `@zabloo/*` packages gets from a merged PR to npm. This page is
for maintainers; nothing here is needed to *use* zabloo/ui.

> **Nothing is published yet.** The pipeline exists and has been rehearsed dry, but the
> roadmap decision stands: the SDK is feature-complete *before* anything is published.
> Publishing is deliberately behind three locks (see [The publish gate](#the-publish-gate)).

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
   on the registry yet, tags the release commit — and pushes the tags. CI authenticates with npm
   through [trusted publishing](#npm-trusted-publishing): there is no npm secret in the repo.

The very first release does not follow step 5 — see [The first publish](#the-first-publish).

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

Nothing under `@zabloo` has been published yet, and an unpublished scope is indistinguishable
from the outside from one that was never registered: every package name returns a 404 either
way. The org `zabloo` exists on npm and we own it (checked 2026-08-18, logged in with
`npm login`).

Publishing for the first time is the decision to start F9 — **not something to do while working
on the pipeline**. When that day comes, it is two phases:

### Bootstrap (manual, once)

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
