# Tasks

What's open and what's been done. Every change updates this file: tick or add an Open
item, and add a dated line at the top of **Done**.

## Open

- [ ] **Analysis 2 — interactions** ([ADR-0004](docs/adr/0004-interactions-analysis.md)): built and measured on branch `feat/interactions`; left: decide [ADR-0005](docs/adr/0005-interactions-refinements.md), merge to main (release).
- [ ] **Analysis 1 in workspaces**: resolve workspace package imports without `node_modules`, so the dependency diagram and interactions agree on monorepos (ADR-0004).
- [ ] **Analysis 3 — impact and risk**: cross changes with test coverage and complexity → traffic light; warn about features without tests or with growing complexity.
- [ ] **Analysis 4 — public API / contracts**: diff exports (types, functions, props) between base and PR with ts-morph, and endpoints (OpenAPI or routes) → compatible/breaking, list affected usages.
- [ ] **Analysis 5 — bundle size**: build base and PR, compare chunks (gzip/brotli), flag over a configurable threshold and name the causing dependency/import.
- [ ] **Claude skill** on top of the CLI that explains the diagrams and risks.

## Done

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
