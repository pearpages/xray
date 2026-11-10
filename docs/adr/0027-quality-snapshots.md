# 0027. Quality snapshots: kept in the plugin's data folder, compared by finding identity

- **Date:** 2026-11-10
- **Status:** Accepted — by the owner, 2026-11-10

## Context

ADR-0014 asks for quality reports "comparable over time", and the quality UI compares the
reports a user opens in it. Nothing keeps those reports or compares them for a skill: xray#20
plans `/xray:quality-report`, which measures a repository, says what changed since last time and
files issues for new problems. That needs a place for the history, a rule for "the same problem"
in two reports, and a command that compares two reports.

Where the history lives had three real options:

- **The plugin's data folder** (`~/.claude/plugins/data/xray-xray/snapshots/<repo>/`), where
  `xray.sh` already keeps its clone: survives deleting a clone, never shows in git; one person's
  history only.
- **`.xray/` in the analysed repository**, ignored like the cache: simplest, but lost with the
  clone, and each clone has its own history.
- **Committed** (`docs/quality/`): shared with the team, but every run adds a large JSON file.

## Decision

- **Snapshots live outside the analysed repository, in a folder the caller names**
  (`xray-quality --snapshots <dir>`). The skill passes
  `<plugin data>/snapshots/<owner>-<name>` (from the `origin` remote, else the folder name). One
  file per commit, `<generatedAt>-<sha>.json`; a report of the same commit replaces it; a dirty
  tree is compared but not saved; the newest 30 are kept.
- **A finding's identity** is its metric id, file and message with every number removed, so a
  hotspot whose churn grew, or a lint error that moved line, is the same finding; anything else
  that changed is a new finding and the old one fixed.
- **`xray-quality compare <old.json> <new.json>`** prints a `QualityComparison` (score changes
  per metric, added and fixed findings), and `--snapshots` adds it to the report as an optional
  `comparison` field. JSON stays `version: 1` (additive, ADR-0019 and ADR-0021). A metric
  unavailable in either report is "not comparable", never a drop to 0.

## Consequences

- (+) The history survives clones and never touches the analysed repository or its git status.
- (+) One identity rule covers every metric without a per-metric matcher.
- (+) `compare` is usable without the skill, on any two saved reports.
- (−) The history is per machine; a team that wants a shared one needs another decision.
- (−) A finding message reworded in a later xray release reads as one problem fixed and one
  new, once, on the first comparison after the upgrade.
