# zabloo/ui — repo context

**zabloo/ui** is a **UI platform for videogames**: the UI and dynamic content of a game
are authored with zabloo/ui's tools, described in an engine-agnostic **IR**, and an **SDK
inside the game tessellates that IR into GPU geometry** — so content can be hot-updated
without recompiling the game. This repo is the **public, open-source** half: the core, the
format, the SDKs and the base components. (The commercial platform lives in the private
repo `app`; zabloo.com lives in `landing`.)

This repo is **self-contained**: all the context needed to work on it is committed here.

## Read this first

| Read | Before |
|------|--------|
| `docs/internal/project.md` | Anything. Rendering model, scope, authoring path, stack, how we work. |
| `docs/internal/ir-context.md` | Touching the **IR** — the keystone of the system. |
| `docs/internal/decisions-architecture.md` | Proposing architecture changes. Every decision, dated, with its reason and what it supersedes. |
| `docs/internal/roadmap.md` | Planning what comes next. |
| `docs/project-structure.md` | Finding your way around the packages. |

Design docs and implementation plans for past work: `docs/internal/specs/` and
`docs/internal/plans/`. User-facing documentation: `docs/`.

@docs/internal/project.md
@docs/internal/ir-context.md
@docs/internal/decisions-architecture.md
@docs/internal/roadmap.md

## Working agreements

- **Verify before claiming anything is done:** `pnpm typecheck && pnpm test && pnpm lint`
  — all green. Report failures with their output; never call work finished on red.
- **Record decisions.** Architecture → `docs/internal/decisions-architecture.md`
  (append an entry: decision, reason, alternatives, consequences). Product direction →
  `docs/internal/roadmap.md`. Business, brand and organization decisions do **not** belong
  in this public repo — they go to the private `landing` repo.
- **Task flow** (Linear `ZAB-XX` + GitHub): `/start-task`, `/create-pr`, `/end-task` in
  `.claude/skills/`.
- **Language:** conversation and commits in **Spanish**; code, comments, docs and PRs in
  **English**.
- **Never** commit secrets. Never propose embedding a browser (CEF/webview) — that path is
  rejected, and the reason is in the decision log.
- Multi-computer work over GitHub: `git pull` before starting, `commit` + `push` when done.
