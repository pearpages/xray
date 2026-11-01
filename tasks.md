# Tasks

What's open and what's been done. Every change updates this file: tick or add an Open
item, and add a dated line at the top of **Done**.

## Open


## Done

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
