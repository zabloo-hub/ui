---
name: create-pr
description: Use when the work on a Linear task branch is ready for review — verifies checks, pushes, creates the GitHub PR (English, with Description/Changes/Testing sections and the Fixes magic word), and moves the Linear issue to In Review with the PR link attached.
---

# Create PR

Create the pull request for the current task branch and sync Linear.

## 1. Resolve the task

- Run `git branch --show-current` and extract the issue ID with the pattern
  `ZAB-\d+` (case-insensitive).
- If there is no ID (or you are on `main`), stop: tell the user this skill
  runs on a task branch (see `/start-task`).
- Fetch the issue with the Linear MCP `get_issue` tool for title and context.
  If it doesn't exist, say so and ask the user for the right ID.
- If the Linear MCP tools are unavailable, stop with a clear message.

## 2. Pre-flight

- `git status` must be clean. If there are uncommitted changes, propose a
  commit (repo style: Spanish, imperative) and get the user's OK first.
- Run `pnpm typecheck && pnpm test && pnpm lint`. If anything fails, report
  it and stop — do not open a PR on red checks.
- Push the branch: `git push -u origin <branch>`.

## 3. Create the PR — everything in English

- Title: `ZAB-XX: <short summary in English>` (matching the task).
- Body structure (all English, regardless of the task's language):

```markdown
## Description

What this PR does and why — the problem/goal from the Linear task, the
approach taken, and any decisions worth knowing at review time.

## Changes

- Key change 1
- Key change 2

## Testing

How this was validated (commands run, what was checked manually, targets
exercised).

Fixes ZAB-XX
```

- Create it with `gh pr create --title "..." --body "..."`.

## 4. Sync Linear

- Resolve the status by NAME: `list_issue_statuses` for the issue's team →
  find "In Review". Never hardcode status IDs.
- Update the issue with `save_issue` to that status.
- Attach the PR URL to the issue with `create_attachment` (title: the PR
  title; url: the PR URL).

## 5. Report

- Give the user the PR URL and confirm the Linear issue is In Review.
- Remind the user: once the PR is merged, run `/end-task` to close the loop
  (Linear to Done + branch cleanup).
