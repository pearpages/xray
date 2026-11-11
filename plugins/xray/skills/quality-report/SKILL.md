---
name: quality-report
description: Measure a TypeScript/JavaScript repository's quality and say what changed since the last time, then propose issues for the worst new problems. Use when asked how the code quality is, whether a repository got better or worse, what new problems or hotspots appeared, for a quality report, score or health check, or on /xray:quality-report. Runs xray-quality with a snapshot history kept in the plugin's data folder (one per commit, the newest 30), reports the score per metric with its change, the new and fixed problems, and hands at most 5 new high-severity problems to /craft:issue on the user's OK. Never fixes anything.
argument-hint: "[repository root, default: current directory]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/xray.sh *) Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/quality-report/scripts/digest.mjs *) Bash(git remote get-url *) Bash(git rev-parse *) Read
---

# Quality report: how the code is, and what changed

`xray-quality` scores a whole repository from 0 to 100, per metric and overall. One report on its
own says little; this skill keeps a history, so each run says **what got better, what got worse
and which problems are new**, and turns the worst new ones into issues.

**Scope:** reads the repository. Writes only the snapshot history in the plugin's data folder
(`${CLAUDE_PLUGIN_DATA}/snapshots/`) and a scratch copy of the report. Never fixes code, and
files issues only through `/craft:issue`, on the user's OK
([ADR-0025](https://github.com/pearpages/xray/blob/main/docs/adr/0025-plugin-stays-about-analysis.md)).
Works on TypeScript/JavaScript repositories; for another language, say so and suggest
`/xray:onboard`, which ranks hotspots in any language.

## Step 1: measure, against the history

1. **The root:** the argument, else `git rev-parse --show-toplevel`.
2. **The history's name:** from `git -C <root> remote get-url origin`, the owner and repository
   joined by `-` (`git@github.com:pearpages/xray.git` → `pearpages-xray`); with no `origin`,
   the root folder's name. One repository always gets the same name, so its history is found again.
3. **Run** (the first run builds xray, about a minute):

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/xray.sh" "${CLAUDE_PLUGIN_DATA}" quality -C <root> --snapshots "${CLAUDE_PLUGIN_DATA}/snapshots/<name>" -o <scratch>/quality.json
   ```

   Its last stderr line says what happened to the history: `compared with <sha> (…)` or `no
   earlier snapshot to compare with`, then `saved <file>` or `not saved (<why>)`. Keep it for the
   report. If the option is unknown, the build is older than the snapshot history: say xray must
   update and stop.

4. **Read the digest**, never the whole report (it can hold thousands of findings):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/skills/quality-report/scripts/digest.mjs" <scratch>/quality.json
   ```

   It prints JSON with `version: 1`; any other version means the format changed, so stop and say
   why. Fields: `score` and `metrics[]` (`score`, `status`, `summary`) for this run; `comparison`,
   null on the first run, with `previous.commit`, `score` (`before`, `after`, `change`),
   `metrics[]` (the same per metric, `comparable: false` when a metric didn't run on one side),
   `added` and `fixed` (`total`, `bySeverity`, the `worst` 10), and `picks` (at most 5 new
   high-severity problems, worst first).

## Step 2: report in chat

1. **One line:** the score now and its change, e.g. "82/100, up 3 since `a95643f` (Nov 10)".
   First run: the score, and that the next run after a commit will show what changed.
2. **A table of metrics:** name, score, change (`+3`, `−5`, `=`, or "not comparable" with why:
   it didn't run, or it was unavailable on one side). Worst change first.
3. **New problems:** the total per severity, then the worst ones as `file` — message (metric).
   When a metric's score dropped, say which new problems explain it.
4. **Fixed problems:** the total, and the notable ones. Credit is useful.
5. **Not saved?** Say why from the stderr line: uncommitted changes (commit, then run again to
   record this state) or a partial run.

Judge before you repeat: read the file behind a new high-severity problem when the message alone
doesn't say whether it's real (a generated file, a fixture, a vendored copy). Say which ones you
think are noise and why. Don't invent causes the data doesn't show.

## Step 3: propose issues for the worst new problems

Only the `picks`: at most 5, high severity only. None → say there's nothing worth an issue, and
stop. Drop the ones you judged noise in Step 2.

- **With craft installed** (`/craft:issue` is available): show the picks as a numbered list, one
  line each with the proposed issue title, and ask once which to file. Hand the chosen ones to
  `/craft:issue` **in one call**, so it checks for duplicates with one issue list for the
  repository, never one GitHub call per problem. Each issue says the file, the problem, the metric,
  and that it is new since `<previous commit>`.
- **Without craft:** list the picks the same way, ready to copy into the tracker, and say that
  installing the craft plugin lets this skill file them.

Never file anything without the user's OK, and never fix the problems here.
