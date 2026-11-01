# 0014. Project quality: a whole-repository report next to the PR report

- **Date:** 2026-11-01
- **Status:** Proposed — for the owner's review before any code.

## Context

xray reports on one pull request. The owner wants a second tool in this repo that reports on the
quality of a **whole repository**, scores it 0–100 per metric and overall, and shows it in a UI;
reports must be comparable over time (one per commit). It runs from outside: it gets a path and
never modifies the analysed repo. `packages/core` already has most of the machinery: the
dependency graph with per-package tsconfig resolution (ADR-0002, 0013), ts-morph units and
cyclomatic complexity (ADR-0007), lcov reading with branches (ADR-0011, 0012), lockfile detection
(ADR-0009) and the `xray.config.json` loader. Principle P1 already says core stays independent of
its callers: the quality tool was the reason for it.

## Decision

### Packages

```
packages/
  core/         unchanged behaviour; a few internals become public exports (below)
  quality/      @xray/quality — analyzers, scoring, report, CLI `xray-quality`
  quality-ui/   @xray/quality-ui — React 19 + Vite app (private, not published)
```

- **Core exports added** (additive, nothing renamed or removed, `xray [base]` unaffected):
  `buildDependencyGraph(cwd, config)` (today's private `cruiseProject` + `toGraph`),
  `cyclomaticComplexity`, `loadCoverage`, `detectPackageManager`, and `loadProject` / `unitsOf` for
  per-file complexity. They get the same tests as today, through the existing callers.
- **The Action stays lean:** `action.yml` installs only the workspaces it needs
  (`npm ci --workspace @xray/core --workspace @xray/cli --workspace @xray/action`), so React,
  Vite and pulp never reach a PR run. Measured on dummy before release (principle P6).
- **quality-ui** uses pulp from npm: `@pearpages/pulp-react` (components imported per entry, e.g.
  `@pearpages/pulp-react/card`), `@pearpages/pulp-tokens`, `@pearpages/pulp-css`. All layout and
  styling through pulp components, its tokens and plain `.css` files (no inline styles). pulp has
  no line chart, so the score-evolution chart is a small SVG component in quality-ui, coloured with
  pulp tokens.

### Analyzer contract

```ts
interface Analyzer {
  id: string;                     // "hotspots"
  name: string;                   // "Hotspots"
  phase: 1 | 2;
  analyze(root: string, config: QualityConfig): Promise<MetricResult>;
}

interface MetricResult {
  id: string;
  name: string;
  score: number | null;           // 0–100; null when unavailable
  summary: string;                // one sentence
  findings: Finding[];
  status: "ok" | "unavailable";   // e.g. no network for the audit, no lcov report
  reason?: string;                // why unavailable
  data?: unknown;                 // metric-specific detail for the UI (hotspot rows, violations)
}

interface Finding {
  file: string;                   // root-relative POSIX path; "package.json" for dependency findings
  line?: number;
  severity: "high" | "medium" | "low";
  message: string;
}
```

This is the requested contract plus three optional-to-use fields: `status`/`reason` so a metric
that can't run (no network, no lcov) is reported as unavailable instead of failing, and `data` for
the tables the UI needs. Analyzers live in `packages/quality/src/analyzers/<id>.ts` and are listed
in one `registry.ts`; adding a metric is one file plus one line.

### Report

```ts
interface QualityReport {
  version: 1;
  repo: { path: string; name: string; commit: string; branch?: string; dirty: boolean };
  generatedAt: string;            // ISO date
  score: number | null;           // global, 0–100
  weights: Record<string, number>;
  metrics: MetricResult[];
}
```

`commit` is `git rev-parse HEAD`; `dirty` warns that uncommitted changes were analysed, so two
reports of the same commit can differ. The CLI: `xray-quality --cwd <dir> -o <file> [-c <config>]`
writes this JSON (stdout without `-o`), exit 0 even with a low score.

### Scoring

**Findings-based metrics** (hotspots, architecture, ESLint/TypeScript) share one formula, so a
score means the same everywhere:

```
penalty = 10 × high + 3 × medium + 1 × low
size    = max(1, codeFiles / 100)          // per 100 files of code
score   = clamp(round(100 − penalty / size), 0, 100)
```

One high finding per 100 files costs 10 points; ten low ones cost the same. Severity weights are
configurable.

| Metric | Findings and severity | Score |
|---|---|---|
| **1. Hotspots** | Per code file: `churn` = commits touching it in the window (default 12 months, `git log --since`), `complexity` = sum of its units' cyclomatic complexity, `hotspot = churn × complexity`. Files with `churn ≥ 2` and `complexity ≥ 10` are findings: **high** if `hotspot ≥ 1000`, **medium** if `≥ 300`, **low** if `≥ 100` (configurable). | Findings formula. `data`: every file with churn, complexity, hotspot, ordered. |
| **2. Architecture** | Features: from `xray.features.json` when it declares `files` (a feature owns the files its globs match; its **public API** is its entry-point files plus any `index.*` at the root of its globs), else folders matching `quality.architecture.features` (default `**/src/features/*`, public API = the folder's `index.*`). Each import from one feature into another feature's non-public file is a **medium** finding (deep import); an import cycle between two features is **high**. Built on the core dependency graph, so aliases and workspaces resolve as in the PR report. | Findings formula. `data`: violations grouped by importing feature → imported feature. With no features found: unavailable ("no features defined"). |
| **3. Dependencies** | Package manager from the lockfile (core). Read-only commands in the analysed repo: `<pm> audit --json` and `<pm> outdated --json` (never install). Vulnerabilities: critical/high → **high**, moderate → **medium**, low → **low**; outdated direct dependencies: a major behind → **low**. | `score = clamp(100 − (15 × high + 5 × medium + 1 × low), 0, 100)`: not size-normalised, one critical vulnerability matters in any repo. Unavailable when a command can't reach the registry. |
| **4. Coverage** *(phase 2)* | lcov via core (`quality.coverage.files`, default as in the PR report). Never runs tests. Files under `thresholds.coverage.file` (default 50 %) lines covered: **medium**; under 20 %: **high**. | `score = round(line coverage %)` over instrumented lines (branches folded in as in ADR-0012). Unavailable without a report. |
| **5. Duplication** *(phase 2)* | jscpd (a dependency of `@xray/quality`, run in-process on the analysed files, read-only). Each clone ≥ 50 tokens: **low**; ≥ 200 tokens: **medium**. | `score = clamp(round(100 − 4 × duplicated %), 0, 100)`: 5 % → 80, 25 % → 0. |
| **6. Lint and types** *(phase 2)* | The project's own ESLint (`eslint --format json`) and `tsc --noEmit -p <each tsconfig>`, resolved from the analysed repo's `node_modules`. ESLint errors and TS errors: **medium**; ESLint warnings: **low**. | Findings formula. Unavailable when the repo has no installed ESLint/TypeScript (xray doesn't install). |

**Global score:** the weighted average of the **available** metrics' scores, weights renormalised
over what ran: `Σ wᵢ·sᵢ / Σ wᵢ`. Default weight 1 each. `null` when nothing ran.

### Configuration

An optional `quality` section in the analysed repo's `xray.config.json` (or the file given by
`-c`), merged over defaults like the rest of the config:

```json
{
  "quality": {
    "weights": { "hotspots": 1, "architecture": 1, "dependencies": 1, "coverage": 1, "duplication": 1, "lint": 1 },
    "severityPenalty": { "high": 10, "medium": 3, "low": 1 },
    "hotspots": { "windowMonths": 12, "minChurn": 2, "minComplexity": 10, "thresholds": { "high": 1000, "medium": 300, "low": 100 } },
    "architecture": { "features": ["**/src/features/*"], "publicApi": ["index.{ts,tsx,js,jsx}"], "useFeatureMap": true },
    "dependencies": { "outdated": true, "timeoutSeconds": 60 },
    "coverage": { "files": ["coverage/lcov.info"], "fileThreshold": 50 },
    "duplication": { "minTokens": 50 },
    "lint": { "eslint": true, "typescript": true },
    "ignore": ["**/*.generated.*"]
  }
}
```

Every field documented in the README, like the existing config.

### UI

A static Vite app; reports are opened with a file picker or by drag-and-drop (no server, nothing
uploaded). For one report: the global score, a score card per metric (unavailable ones say why),
the hotspots table ordered by hotspot (pulp data grid), architecture violations grouped by feature,
and all findings filterable by severity and metric. With several reports of the same repo (same
`repo.name`), a score-evolution chart by commit, ordered by `generatedAt`.

### Safety

The analysed repo is read only: git read commands, file reads, and `audit`/`outdated` (phase 1);
ESLint and `tsc --noEmit` (phase 2), which read but don't write. No install, no build, no writes
under the analysed root; the report goes to `-o`. ESLint configs are code and run in-process, the
same trust as running the project's own lint; security.md gets that line.

## Open points for review

1. **Contract extension** (`status`, `reason`, `data`) instead of the bare 5-field shape: needed for
   "unavailable" and for the UI tables.
2. **The scoring formulas and thresholds** above: the hotspot thresholds especially are a first
   guess, to be tuned on futbol-manager and bitepals in phase 1.
3. **Features from `xray.features.json`** only when they declare `files`: futbol-manager's map
   describes screens, not vertical slices, so without `files` its features can't define module
   boundaries and the folder default applies.
4. **Action install narrowed to three workspaces**, so the UI's dependencies never slow PR runs.

## Consequences

+ One repo, one core: the PR report and the quality report agree on what a module, an alias or
  coverage is.
+ Every metric is one file; scores share one formula where they can, so they read the same.
− `@xray/quality` adds jscpd (phase 2); `quality-ui` adds React, Vite and pulp to the repo's dev
  dependencies (not to the Action).
− Dependency and lint metrics depend on the environment (network, an installed `node_modules`);
  they report "unavailable" rather than a wrong score.
