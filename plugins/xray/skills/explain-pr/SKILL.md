---
name: explain-pr
description: Explain an xray pull request report (dependencies, interactions, impact and risk) in plain language and say what to do about its risks. Use when asked what an xray report or comment means, whether a PR is risky, which features a PR affects, or which tests to add before merging.
argument-hint: "[PR number or URL; default: the current branch]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/xray.sh *) Bash(gh pr view *) Bash(gh pr diff *) Bash(git diff *) Bash(git merge-base *) Bash(git rev-parse *) Read Grep Glob
---

# Explain an xray report

An xray report has three sections. **Dependencies**: changed files and their direct neighbours.
**Interactions**: the functions, components and hooks the PR touches (*units*), grouped into
user-facing *features*, with the path from each feature's entry point down to the change.
**Impact and risk**: for each touched unit, the test evidence (direct, by name, via a caller, or
none), its complexity before → after, and a 🟢🟡🔴 light per unit, feature and PR.

Your job is the reviewer's briefing: what this PR means for users, and what to do before merging.
The report already has the tables; the briefing is what the tables don't say.

## 1. Get the report

- **The PR's branch is checked out here** (no argument, or the argument names the current
  branch's PR): run xray for the full data. The base is the PR's base branch
  (`gh pr view --json baseRefName`), or `main` without a PR:

  ```bash
  "${CLAUDE_PLUGIN_ROOT}/scripts/xray.sh" "${CLAUDE_PLUGIN_DATA}" <base> -C <root> --format json
  ```

  `<root>` is where the xray Action runs: the repository root, or its `working-directory`. The
  first call builds xray (about a minute).
- **Otherwise**, read the xray comment on the PR, the one containing `<!-- xray:report -->`:
  `gh pr view <pr> --json comments,baseRefName,headRefName,title,body`.

Done when you have the report and know the PR's title and intent (its description).

## 2. Read the change

Read the diff (`gh pr diff <pr>`, or `git diff $(git merge-base <base> HEAD)`) for every 🔴 and 🟡
unit, and for each unit whose complexity grew: what branch, condition or case was added. Open the
test files the report names as evidence to see what they actually check. Done when, for each of
those units, you can say what new behaviour it has and whether any test exercises that behaviour.

## 3. Write the briefing

In the user's language, short, in this order:

1. **What it does for users**, in one or two sentences, using the feature names (not file names).
2. **Where it reaches**: for the features with the most touched units (three at most), the path
   from the entry point to the change in plain words ("the Cart page shows prices through
   `PriceTag`, which now formats with the selected currency"). Mention shared units (a hub "shared
   by N") as "every screen that uses `useGame`".
3. **Risks and next steps**, 🔴 first, then 🟡. For each: why (no test reaches it / complexity +N)
   and one concrete action: the test file to add or extend (by-name convention: `Cart.test.tsx`
   next to `Cart.tsx`), and the case it must cover, taken from the new behaviour you read in step 2.
   When a risk is acceptable (a one-line rename, a constant), say so and why.
4. **Loose ends**, only if present: changed units not in the feature map (suggest `/xray:features`),
   removed units, warnings, nodes left out of a diagram.

Done when every 🔴 and 🟡 unit has a next step or a reason it is fine, and every feature in the
report is either described or named in a "also touches" line.

The briefing is for the user here. Posting it on the PR is their call.
