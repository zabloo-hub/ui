---
name: start-task
description: Use when starting work on a Linear task — resolves the ZAB-XX issue from the current branch (or asks for it and creates the branch), reviews it, clarifies all doubts, moves it to In Progress, and implements it plan-first.
---

# Start Task

Work a Linear task end-to-end: resolve → understand → clarify → plan → implement.
Do the steps in order. Do not skip the clarification or plan gates.

## 1. Resolve the task

- Run `git branch --show-current` and extract the issue ID with the pattern
  `ZAB-\d+` (case-insensitive; branch names look like `zab-12-some-title`).
- If the current branch is `main` or has no ID:
  1. Ask the user for the issue ID (e.g. `ZAB-12`).
  2. Fetch it with the Linear MCP `get_issue` tool. If it doesn't exist, say so
     and ask again.
  3. Create the branch from up-to-date main:
     `git checkout main && git pull`, then
     `git checkout -b <branchName>` using the branch name suggested by Linear
     (the `branchName`/`gitBranchName` field on the issue). If Linear doesn't
     provide one, build it as `zab-<number>-<kebab-case-title>` truncated to
     ~50 chars.
- If the Linear MCP tools are unavailable, stop with a clear message — never
  guess or fake task state.

## 2. Load context

- Fetch the full issue (`get_issue`) and its comments (`list_comments`).
- If the issue references specs or docs (e.g. files under the private
  `ai-docs` repo), read them.
- Check the issue's project/milestone if it adds relevant context.

## 3. Review and clarify — gate

- Summarize the task back to the user in 3–5 lines: goal, scope, exit
  criteria as you understand them.
- Ask ALL your doubts now (scope boundaries, open decisions, acceptance
  criteria, anything ambiguous), preferably as concrete option questions.
- Do NOT proceed while any doubt is unresolved.

## 4. Move to In Progress

- Resolve the status by NAME: call `list_issue_statuses` for the issue's team
  and find the one named "In Progress". Never hardcode status IDs.
- Update the issue with `save_issue` to that status.

## 5. Plan first — gate

- Present an implementation plan (files to touch, approach, verification).
- Wait for the user's explicit OK. Do not write code before approval.

## 6. Implement

- Follow the approved plan. Surface deviations as they happen.
- Before claiming anything is done, verify:
  `pnpm typecheck && pnpm test && pnpm lint` — all green.
- Commit in the repo's style (Spanish, imperative, reference the task ID like
  the existing history does).
