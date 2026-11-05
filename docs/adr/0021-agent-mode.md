# 0021. Agent mode: selectable analyzers, scoped input and a compact findings format

- **Date:** 2026-11-05
- **Status:** Accepted (amends 0019)

## Context

foundry (the agent pipeline, the "agents kit" of [ADR-0019](0019-json-output-contract.md)) wants
to call xray many times per task, not once per PR: while planning, after each step, before review
and at the final gate. Today each call runs everything. The PR CLI loads ts-morph and walks the
code even when only the dependency graph is wanted, and `xray-quality` scores the whole
repository. Both print large JSON that is mostly diagram and UI data (`config`, `data`, nodes and
edges) that an agent pays for in tokens and never uses.

Humans' Markdown report, the Action's comment and the quality UI must not change.

## Decision

### 1. Selection: `--only <ids>`

- `xray --only dependencies,interactions,risk,api,bundle` and
  `xray-quality --only hotspots,architecture,dependencies,coverage,duplication,lint`. Comma
  separated; an unknown id is an error (exit 2). Default: everything, as today.
- **Work not selected is not done.** In `analyzePullRequest`, `loadChangedCode` (ts-morph) runs
  only when `interactions`, `risk` or `api` is selected; `risk` without `interactions` still
  computes the interactions it needs but does not report them. The ts-morph modules are imported
  dynamically (`await import()`) so `--only dependencies` never loads them. The `@xray/core`
  barrel still re-exports them for library users; the CLI imports a new lean entry
  (`@xray/core/pr`) that only reaches ts-morph through those dynamic imports.
- An unselected PR analysis is absent from the JSON (the fields become optional in
  `XrayResult`), and `reportSections` skips it. Without `--only` the result is exactly today's.
- `--only bundle` still needs `--bundle` (or `bundle.enabled`): it runs the project's install and
  build scripts, so it stays an explicit opt-in (security.md). Without it, the bundle entry is
  reported `unavailable` with that reason.
- Unselected quality metrics are absent from `metrics`; the global score is the weighted average
  of those that ran (the existing formula, unchanged).

### 2. Scoping: `xray-quality --files <paths...>`

- Repo-relative paths (or globs). **Findings** are kept only when `finding.file` is in the set.
  **Work** is limited where the metric allows it: hotspots parses only those files; lint runs
  ESLint on only those files; coverage reads lcov for only those files. Architecture (needs the
  whole graph to know imports into a file), duplication (a clone has two ends) and types (`tsc`
  checks a whole project) run whole and are filtered. Dependencies (audit) ignores `--files`.
- **Scores are `null` under `--files`**, metric and global, with `scope: { files }` in the
  report: a score of a slice would be read as the repository's. The scoring formula itself does
  not change.
- **Cache.** Git churn (`commitLog`) is repo-wide and the slowest input of a scoped call. It is
  cached at `<root>/.xray/cache/churn-<HEAD sha>-<windowMonths>m-<YYYY-MM-DD>.json` (the date
  because the window is relative to today). xray writes `.xray/.gitignore` containing `*`, so the
  cache never shows in `git status` nor makes the report `dirty`. Missing, unreadable or corrupt
  cache = recompute; a write that fails is ignored. `--no-cache` turns it off. This changes
  `xray-quality`'s promise from "never changes the repository" to "only writes its own ignored
  cache folder", stated in the README and security.md.

### 3. `--format agent` on both CLIs

Output: findings only, no diagrams, no `config`, no `data`.

```ts
// packages/core/src/agent/types.ts, exported from @xray/core (and @xray/core/agent)
export type AgentSeverity = "high" | "medium" | "low";
export interface AgentFinding {
  analyzer: string;           // "risk", "api", "hotspots", …
  file: string;               // repo-relative POSIX (P4)
  line?: number;
  severity: AgentSeverity;
  message: string;
}
export interface AgentAnalyzerSummary {
  analyzer: string;
  status: "ok" | "unavailable";
  summary: string;            // one line
  findings: number;           // before filters
}
export interface AgentReport {
  version: 1;
  tool: "xray" | "xray-quality";
  commit: string;             // PR head, or the quality report's commit
  analyzers: AgentAnalyzerSummary[];
  findings: AgentFinding[];   // after filters, high first, then file, line
  truncated: number;          // findings at or above --min-severity cut by --top
}
```

- `--min-severity <high|medium|low>` (default `medium`) and `--top <n>` (default 10, over all
  analyzers) apply to `findings`; `truncated` counts what `--top` dropped. Summaries always list
  every selected analyzer, so an agent knows what ran.
- Quality findings already have this shape (`Finding` + `analyzer`: the metric id).
- **PR results are mapped as follows** (one finding per row; nothing from green/compatible):

| Analyzer | Source | Severity | `file` / `line` |
|---|---|---|---|
| api | export or endpoint `breaking` | high | the changed file |
| api | export or endpoint `review` | medium | the changed file |
| api | added export or endpoint | low | the changed file |
| risk | unit light `red` | high | the unit's file, its first line |
| risk | unit light `yellow` (the "amber" light) | medium | the unit's file, its first line |
| dependencies | an import from a changed file that crosses feature boundaries into another feature's internals | medium | the importing file, the import line |
| dependencies | a changed import that closes a cycle between two features | high | the importing file |
| interactions | feature map `invalid` | medium | the map's path |
| interactions | touched unit no feature covers (`unmapped`) | low | the unit's file |
| bundle | light `red` / `yellow` | high / medium | `package.json`; message names the top chunks |
| bundle | dependency added or re-versioned | low | that `package.json` |
| bundle | build `failed` | — (`unavailable`, with the reason) | — |
| any | analysis `skipped` (too many units) | — (summary says so) | — |

  **Why dependencies needs a rule:** the PR dependency analysis today has no rules, only a
  neighbourhood graph, so there is no "rule severity" to map. The boundary rules already exist in
  `xray-quality`'s architecture metric (deep import = medium, cycle between features = high).
  Their feature detection and edge check move into core (`dependencies/boundaries.ts`); quality
  calls the moved code with no change in behaviour or score, and the PR analysis applies it only to
  edges whose `from` is a changed file. Without `architecture` features (fewer than two), the
  dependencies entry is `ok` with no findings and says so. The unit's first line needs a new
  `line` field on `UnitRisk` (additive).

### 4. Contract (amends 0019)

- Every JSON output names its layout number **`version`**: `XrayResult` gains `version: 1` (as
  0019 proposed), `AgentReport` has `version: 1`, `QualityReport` keeps its existing `version: 1`.
  One name, so a consumer checks the same field on every output. (`schemaVersion` was considered
  and dropped: it would give two names for one idea, or a rename of quality's field.)
- 0019 said importing `@xray/core` from outside is unsupported. Narrowed: **the agent types
  (`AgentReport`, `AgentFinding`, `AgentAnalyzerSummary`, `AgentSeverity`) are the one supported
  import**, types only, from `@xray/core/agent`, a file with no runtime code. Its reason (the
  `export *` barrel is not a contract) still holds for everything else.
- The 0019 contract test also pins `AgentReport`'s keys and `version`, and the mapping table
  above is part of the agent contract: changing a severity bumps `version`.
- **Exit codes:** 0 when the analysis ran, whatever it found; 1 when xray failed (not a git repo,
  unknown base, crash); 2 for a usage error (unknown flag value). foundry decides the gate.

## Consequences

+ An agent asks one question per call and gets an answer of a few hundred tokens; `--only
  dependencies` skips the ts-morph load, the slowest part of a PR run.
+ The PR comment, the Action and the quality UI see the same data as today (no `--only`, no
  `--files`, `markdown`/`json`): no new dependency, so P6 doesn't apply.
+ The PR report's dependencies analysis gains boundary findings in JSON, shared with quality's
  architecture metric instead of a second implementation.
− `XrayResult`'s analysis fields become optional, so a consumer must handle an absent analysis
  (only when it passes `--only`).
− `xray-quality` writes a cache into the analysed repository; a stale or wrong key would serve old
  churn, so the key includes the commit, window and day.
− The severity mapping is a second contract to keep stable next to the JSON.
