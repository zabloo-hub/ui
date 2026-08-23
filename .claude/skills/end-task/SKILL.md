---
name: end-task
description: Use when a task's PR has been merged — moves the Linear issue to Done with a closing summary comment, reminds about pending decision-log updates, and cleans up the local branch.
---

# End Task

Close out a finished task: Linear to Done + summary, docs reminder, cleanup.

## 1. Resolve the task

- Run `git branch --show-current` and extract the issue ID with the pattern
  `ZAB-\d+` (case-insensitive).
- If you are on `main` (typical right after a merge), ask the user which
  issue to close (e.g. `ZAB-12`).
- Fetch the issue with the Linear MCP `get_issue` tool. If it doesn't exist,
  say so and ask the user for the right ID.
- If the Linear MCP tools are unavailable, stop with a clear message.

## 2. Verify the PR is merged — gate

- Check with `gh pr list --search "ZAB-XX" --state merged` (or
  `gh pr view <branch> --json state,mergedAt`).
- If the PR is not merged (or doesn't exist), warn the user and STOP — this
  skill only runs after merge.

## 3. Close in Linear

- Resolve the status by NAME: `list_issue_statuses` for the issue's team →
  find "Done". Never hardcode status IDs.
- Update the issue with `save_issue` to that status.
- Add a closing comment with `save_comment`, written in the task's language
  (Spanish), covering:
  - qué se hizo (resumen real, no la descripción original),
  - decisiones tomadas por el camino,
  - desviaciones respecto a la descripción de la task, si las hubo.

## 4. Decision-log reminder

- If architectural decisions were made during the task, remind the user (or
  offer to do it) to record them in `docs/internal/decisions-architecture.md`
  (or `docs/internal/roadmap.md` for product direction), per the project's
  standing rule.

## 5. Cleanup

Check where you are first: `git worktree list`.

### In a Superset worktree (the normal case)

The cwd is under `~/.superset/worktrees/`. Here `main` is checked out by the
primary worktree, so `git checkout main` fails, and git will not let you delete
the branch you are standing on. **The user deletes the workspace themselves —
always. Do not ask, and do not work around it** (no detaching HEAD, no `-D`, no
deleting the branch from the primary worktree while this one holds it).

- Update main where it actually lives:
  `git -C <primary worktree> pull --ff-only` — find the path with
  `git worktree list` (the entry marked `[main]`).
- Then state, as a fact and not a question: the workspace is ready to delete
  from Superset. Its `teardown.sh` frees the port and removes the worktree, and
  the branch checkout goes with it.

### In a normal clone

- `git checkout main && git pull`.
- Delete the local branch: `git branch -d <branch>` (only `-d`, never `-D` —
  if git refuses, the branch isn't fully merged; surface that instead of
  forcing).
- If you started from `main` (no task branch checked out), find the branch to
  delete via `git branch --list '*zab-<number>*'` — use the issue ID
  lowercased, since branch names are lowercase (e.g. `'*zab-12*'`). If
  nothing matches, there is nothing to clean up.
