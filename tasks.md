# Tasks

What's open and what's been done. Every change updates this file: tick or add an Open
item, and add a dated line at the top of **Done**.

## Open


## Done

- [x] 2026-11-02: pearpages/fourpass#134's xray comment restored by the owner (updated 15:21): the full report rebuilt from the PR head against `main` before the merge. Unlike the decisions line below says, it carries no "restored" note: that step was part of the command refused to the session.
- [x] 2026-11-02: Quality UI views for phase 2: coverage per file (tested files least covered first; files no test loads in a second view, so 207 untested bitepals files don't hide the weak tested ones) and the 20 biggest duplicated blocks with both copies side by side (stacked on phones). Checked in the browser with bitepals' real report, desktop and 375 px. 30 UI tests. Lint and types has no view of its own: its findings already name file, line and rule.
- [x] 2026-11-02: Released v0.5.1 (coverage counts the files no test loads, ADR-0018); `v0` moved to it.
- [x] 2026-11-02: Coverage on a real repo: the owner ran bitepals' web tests with coverage. Coverage scored 76 over only the 373 files tests loaded; 316 web files were absent. Now a file of a project with a report but not in it counts as 0 %, its lines estimated from its transpiled code and the report's own ratio, and `coverage.exclude` leaves tooling out ([ADR-0018](docs/adr/0018-untested-files-count.md)): bitepals 60 (204 untested files, biggest `lib/activity/queries.ts`), xray 80. 139 tests.
- [x] 2026-11-02: Released v0.5.0 (quality phase 2, UI reports kept across reloads, the Action without root dev dependencies and leaving merged or closed PRs alone); `v0` moved to it.
- [x] 2026-11-02: Action measured (P6) on pearpages/dummy#8, same diff as #3 with `bundle: "true"`: 58 packages, install + build 3.3 s (v0.4.0: 4.5 s), analysis 16.9 s, job 30 s; report identical to v0's. Guard checked on GitHub: after closing #8, a re-run logged "#8 is closed, leaving its comment as it is" and the comment's `updated_at` didn't change. #8 closed, its branch deleted.
- [x] 2026-11-02: Pending decisions settled under delegation ("do whatever you think is best, but document it"): (1) [ADR-0016](docs/adr/0016-quality-phase-2.md) Accepted as proposed. (2) The Action leaves merged and closed PRs' comments alone ([ADR-0017](docs/adr/0017-leave-closed-prs-alone.md)), so #134's accident can't repeat. (3) fourpass#134's empty comment: rebuilt from the PR head (`7d1a5c2`) against `main` before the merge (`39549db`), with a note saying so; posting it was refused to the session, so it's an Open item for the owner. (4) futbol-manager#23 stays closed: the owner closed it on 2026-11-01 (its `check` job had failed), so it isn't reopened. (5) The two commits on `main` with a co-author line (44b3c52, 4e1f005) stay: rewriting published `main` costs more than the lines; later commits follow the owner's commit-message skill (no trailer). (6) Next work: the phase 2 UI views, before hosting the UI.
- [x] 2026-11-02: Project quality phase 2: coverage (lcov, branches folded in), duplication (jscpd 4.3.0 in-process), lint and types (the project's own ESLint and `tsc --noEmit`, per config folder and tsconfig) ([ADR-0016](docs/adr/0016-quality-phase-2.md)); each metric records its duration. Run on xray (89, 4 s), dummy (100, 1 s), futbol-manager (84, 11 s), bitepals (73, 172 s), none changed. Core's `unitsOf` reads default exports from the syntax: bitepals hotspots 138 s → 0.6 s. `ts-morph` declared in `@xray/quality` (it was hoisted). The Action installs 58 packages (49 MB) instead of 91 (84 MB): it no longer installs the root's dev dependencies, which vitest's optional peers (jsdom, coverage) would have grown.
- [x] 2026-11-02: Quality UI keeps the open reports across reloads (localStorage, *Close all*); `-o` creates missing folders; UI component tests (jsdom, Testing Library) and CLI tests on the built command; `npm run coverage` with a floor (statements 85, branches 70, functions 85, lines 88), run in CI. Coverage: 91.9 % lines, 74.9 % branches.
- [x] 2026-11-02: Released v0.4.0 (project quality phase 1, narrowed Action install); `v0` moved to it.
- [x] 2026-11-02: Action measured with the narrowed install (P6) on pearpages/dummy#7, same diff as #3 with `bundle: "true"`: job 32 s (v0: 30 s), install + build 4.5 s (v0: 4.6 s, still 90 packages), analysis 19.3 s (v0: 19.5 s); report identical to v0's. Without the narrowing the runner would install the quality tools and the UI as well.
- [x] 2026-11-01: Project quality phase 1: `@xray/quality` (hotspots, architecture, dependencies; findings formula; `xray-quality` CLI) and `@xray/quality-ui` (pulp). Tuned on xray, dummy, futbol-manager and bitepals ([ADR-0015](docs/adr/0015-quality-phase-1-tuning.md)); the Action installs only core, cli and action (84 MB of node_modules instead of 159 MB).
- [x] 2026-11-01: v0.3.1, from bitepals' first report (#134): each workspace package resolves imports with its own tsconfig (`paths`, tolerant of a missing `extends`), in both analyses; no more `Could not read tsconfig.json` for an uninstalled base ([ADR-0013](docs/adr/0013-per-package-tsconfig.md)). #134's change now reaches Place page.
- [x] 2026-11-01: Real adoption PR opened, pearpages/futbol-manager#23 (workflow on `@v0` with `mise-action@v5`, `checkout@v7`, coverage and bundle; the 13-feature map), awaiting the owner's review. Its run: 4 min 48 s, no Node 20 warnings; the report is short because it adds no code (bundle −3 B: the app embeds its commit). The v0.3.0 replay on #22 confirmed the folder view, branch coverage and shared units on GitHub; #22 closed and its `try/` branches deleted.
- [x] 2026-11-01: Released v0.3.0 (ADR-0012 follow-ups); `v0` moved to it.
- [x] 2026-11-01: Pilot follow-ups done under delegation ([ADR-0012](docs/adr/0012-pilot-follow-ups.md)): entry points are components in entry-glob files (futbol-manager 73 → 38 candidates), folder-level dependency diagram for big PRs (29 folders instead of 60 files + 80 left out), branch coverage from lcov `BRDA`. Limit recorded: untested data paths (a lookup, a default value) have no branch to miss.
- [x] 2026-11-01: Pilot on pearpages/futbol-manager#22 (draft, replay of #20 on `try/` branches, not to be merged): 84 files, 34 units, 13-feature map written with the skill; xray step 25 s incl. both pnpm builds; comment 24 KB. Findings fixed in v0.2.2: Node 24 actions (setup-node v7, checkout v7), shared units listed once in Interactions, same-named units labelled by package, type comments ignored and long types cut, Dependabot. Workflow lessons now in the README: call Vitest directly (`pnpm test -- …` drops flags) and use `--coverage.reportOnFailure` with a longer `--testTimeout` (instrumented tests timed out and no report was written). With coverage, all 34 units were judged on real coverage; JSX-attribute-only changes fall back to the whole unit's lines.
- [x] 2026-11-01: v0.2.1, found while preparing the futbol-manager pilot: in a workspace, the bundle analysis builds the one package that is a Vite app (`pnpm --filter @fm/app exec vite build`, output in its `dist/`); per-package bundle changes use raw bytes and one gzip ratio, so untouched packages show 0. futbol-manager PR #20 replay: +2.0 KB gzip in 10 s.
- [x] 2026-11-01: Released v0.2.0 (barrel importers, lcov coverage, Next.js route handlers); `v0` moved to it.
- [x] 2026-11-01: Optional tasks done under delegation ([ADR-0011](docs/adr/0011-barrels-coverage-and-routes.md)): barrel importers in the dependency diagram (futbol-manager 15d1220 now reaches 6 folders through `@fm/domain`), lcov coverage of changed lines as risk evidence (checked with a real Vitest report on dummy), Next.js route handlers as endpoints (fixtures only: slotflow has none). 70 tests.
- [x] 2026-11-01: Owner's six questions decided under delegation:
  1. **Versioning** → yes: `v0.1.0` plus a moving `v0`; README and the skills use `v0` ([ADR-0010](docs/adr/0010-versioning-and-releases.md)).
  2. **Failing the check** → never, for risk, API and bundle alike; the lights are information (ADR-0007/0008/0009 unchanged).
  3. **Public API** → (a) no route-based or YAML endpoints yet: of 13 projects only slotflow has a server framework (Next.js) and none has an OpenAPI file; Next.js handlers listed under *Later*. (b) Internal app exports stay listed alongside 📦 package ones. (c) A new required member on a plain type stays 🟡.
  4. **Bundle** → (a) 10 KB / 5 % kept until real reports suggest otherwise. (b) Enabled on pearpages/dummy as the demo of the recommended setup; no real project runs xray yet, so none is changed. (c) Vite projects keep `vite build --sourcemap hidden` (no type-check, source maps for causes).
  5. **Coverage** → static evidence until a project publishes lcov (under *Later*).
  6. **Cleanup** → merged branches deleted from GitHub; pearpages/dummy#3 stays open as the demo PR; #6 closed.
- [x] 2026-11-01: Analyses 4 and 5 released in v0.1.0 (merged `feat/api-and-bundle`).
- [x] 2026-11-01: Action measured (P6) on pearpages/dummy#6: default job 12 s (install + build 3.8 s, analysis 1 s: unchanged); with `bundle: "true"` 26 s (analysis 16.5 s for two installs and builds).
- [x] 2026-11-01: Analysis 4 (public API) and 5 (bundle size, opt-in) built; dummy measured: +49 B gzip in 6 s; 62 tests. Bundle build errors are summarised (error lines, no colours or stack frames).
- [x] 2026-11-01: `/xray:explain` skill: a reviewer's briefing from a report (PR comment via `gh`, or a local JSON run), checked on pearpages/dummy#3 and futbol-manager. The runner script moved to the plugin root, shared by both skills.
- [x] 2026-11-01: Analysis 3 (impact and risk) released: merged `feat/risk` into main ([ADR-0007](docs/adr/0007-impact-and-risk-analysis.md)).
- [x] 2026-11-01: Action measured with impact and risk (P6) on pearpages/dummy#5: job 14 s (was 13 s), install + build 4.5 s (was 3.5 s), analysis 1.5 s (was 0.9 s). No new dependencies.
- [x] 2026-11-01: Impact and risk built: test evidence (direct, by name, indirect), complexity deltas, traffic lights. futbol-manager 6f2e08e: 19 units, 6 more complex, full report 1.9 s. The ts-morph analyses now share one loaded project (`changed-code.ts`).
- [x] 2026-11-01: ADR-0007 accepted: static evidence only, the light never fails the check, defaults 15 / 3 / 3.
- [x] 2026-11-01: Impact and risk designed (ADR-0007) after surveying coverage in 9 projects (none publish it) and a spike on dummy and futbol-manager.
- [x] 2026-11-01: Analysis 1 resolves workspace packages without `node_modules` (exact aliases for dependency-cruiser). futbol-manager 6f2e08e: 0 → 47 cross-package edges; 15d1220 unchanged (barrel hop). Workspace module moved to `packages/core/src/workspaces.ts`.
- [x] 2026-11-01: ADR-0006 accepted; the feature map skill confirmed working when installed from GitHub.
- [x] 2026-11-01: Feature map skill (`/xray:features`) as a Claude Code plugin in this repo, with `xray --inventory`; tried on pearpages/dummy (map valid, report names Catalogue and Cart). Fixed `export default function` not being seen as a default export (lazy imports were lost).
- [x] 2026-11-01: Analysis 2 (interactions) released: merged `feat/interactions` into main ([ADR-0004](docs/adr/0004-interactions-analysis.md), [ADR-0005](docs/adr/0005-interactions-refinements.md)).
- [x] 2026-11-01: ADR-0005 accepted (lookup tables and `reads`, hub cut-off without a map, one level of callees, 6 per unit).
- [x] 2026-11-01: Action measured with interactions (P6) on pearpages/dummy#4: job 13 s (was ~12 s), install + build 3.5 s (was ~4 s), analysis 0.9 s. ts-morph adds ~13 MB, 7 packages.
- [x] 2026-11-01: Interactions built: single project (dummy) and workspaces (futbol-manager: 4 touched units, 3 features, ~1.1 s). Fixed changed-file paths when run from a monorepo package.
- [x] 2026-11-01: ADR-0004 accepted: whole-workspace interactions in v1, built in two stages.
- [x] 2026-11-01: ADR-0004 question 2 settled: without a feature map, draw per entry point and warn that the map is missing.
- [x] 2026-11-01: ADR-0004 question 1 settled: the feature map is written by the Claude skill only; xray never calls an AI API.
- [x] 2026-11-01: Interactions design proposed (ADR-0004) after a ts-morph spike on dummy and futbol-manager.
- [x] 2026-11-01: ADR-0003 accepted (Action builds on every run, ~4 s); new principle P6: each new analysis re-measures the Action before shipping.
- [x] 2026-11-01: Private vulnerability reporting enabled on pearpages/xray; security.md points to it.
- [x] 2026-11-01: ADR-0002 accepted: keep dependency-cruiser on TypeScript 6 (TS 7 has no JS API); revisit with analysis 2's ts-morph measurement.
- [x] 2026-11-01: Bundling the Action dropped as not needed: on pearpages/dummy the whole job takes ~12 s (`npm ci` ~2 s, build ~2 s).
- [x] 2026-11-01: Third-party actions pinned by commit SHA (`actions/checkout`, `actions/setup-node` v4.4.0).
- [x] 2026-11-01: File names in the report escape backticks; comment step warns instead of failing on 403/404 (fork PRs).
- [x] 2026-11-01: Tests for the comment API calls (fake GitHub) and for uncommitted/untracked files in the diff.
- [x] 2026-11-01: Action verified on a real PR (pearpages/dummy#3): comment created, updated in place, Mermaid renders.
- [x] 2026-11-01: Report header shows the PR's head commit in CI, not GitHub's temporary merge commit (`--head`).
- [x] 2026-11-01: Report, CLI and README text switched from Spanish to English.
- [x] 2026-11-01: README names the MIT license.
- [x] 2026-11-01: Scaffolded project knowledge files — 11 created (incl. 3 ADRs and LICENSE), 0 fixed, 5 follow-ups.
- [x] 2026-11-01: Analysis 1 (dependencies) with CLI and GitHub Action that upserts one PR comment.
