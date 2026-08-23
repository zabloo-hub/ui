# Internal context (`docs/internal/`)

The working context of **zabloo/ui**: what the product is, how the IR is designed, every
architecture decision and why, where it's going, and the design/plan trail of the work
already done. It lives **in the repo, on purpose** — clone `ui` and you have everything
needed to understand it, with no companion repo required (decision 2026-08-23).

`CLAUDE.md` at the repo root imports the first four files, so Claude Code loads them on
start.

| File | What |
|------|------|
| `project.md` | What zabloo/ui is: rendering model, scope, authoring, stack, how we work. **Start here.** |
| `ir-context.md` | Design of the **IR** — the keystone of the system. Read before touching it. |
| `decisions-architecture.md` | **Decision log** (architecture only): what was decided, when, why, and what it supersedes. |
| `roadmap.md` | Where the product is going. Living document. |
| `specs/` | Design docs, one per piece of work (`YYYY-MM-DD-<slug>-design.md`). |
| `plans/` | Implementation plans, one per piece of work (`YYYY-MM-DD-<slug>.md`). |

## For readers of the public repo

This is **internal working context**, not user documentation — for that, see
[`docs/`](../README.md) (getting started, format spec, components, theming). It's public
because there's nothing to hide about how the pipeline is built; business, brand and
organization context is kept elsewhere, in a private repo.

Documents dated before **2026-08-23** mention a private repo `ai-docs`, which used to
hold this content. It no longer exists — the content is here. File paths were rewritten;
the narrative was left as it was written at the time.
