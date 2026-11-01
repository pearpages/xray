# Tasks

What's open and what's been done. Every change updates this file: tick or add an Open
item, and add a dated line at the top of **Done**.

## Open

- [ ] **Analyses 4 and 5** ([ADR-0008](docs/adr/0008-public-api-analysis.md), [ADR-0009](docs/adr/0009-bundle-size-analysis.md)): built and measured on branch `feat/api-and-bundle`; left: merge to main (release), close pearpages/dummy#6.

### Questions for you

Decisions taken under delegation or waiting on you. Answer any of them in a session; each answer
updates the ADR it names (or starts one).

1. **Versioning.** Every push to `main` changes every project's PR report today (`@main`). Tag
   releases (`v0.1.0`, plus a moving `v0`) and point workflows at `@v0`? *Recommended: yes, before
   adding xray to real projects.* (New ADR.)
2. **A red light never fails the check** (risk, breaking API, bundle over threshold). Keep it that
   way, or add an opt-in `failOn` for some of them? *Recommended: keep for now.* (ADR-0007, 0008, 0009.)
3. **Public API (ADR-0008):** (a) Do any of your projects have route-based endpoints (Express,
   Next.js route handlers) or OpenAPI in YAML worth covering? (b) List internal app exports too, or
   only 📦 package exports? *Current: both.* (c) A new required member on a plain type is 🟡 *to
   review*, not 🔴; agree?
4. **Bundle size (ADR-0009):** (a) Thresholds 10 KB gzip / 5 %: right for your apps? (b) Which repos
   should enable `bundle: "true"`? (c) For Vite projects xray runs `vite build --sourcemap hidden`
   instead of your `build` script (skips the type-check, adds source maps); OK?
5. **Coverage.** Static test evidence only (ADR-0007). Want a project to publish an lcov report so
   xray can read real line coverage? If so, which one first?
6. **Cleanup on GitHub:** delete the merged branches (`feat/interactions`, `feat/skill`,
   `feat/risk`)? Keep pearpages/dummy#3 open as the demo PR?

- [ ] **Dependencies through barrels** (optional): when a neighbour only re-exports (a package's `index.ts`), also show its importers, so a change inside a shared package reaches the apps in the dependency diagram too.

## Done

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
