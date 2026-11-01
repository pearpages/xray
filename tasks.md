# Tasks

What's open and what's been done. Every change updates this file: tick or add an Open
item, and add a dated line at the top of **Done**.

## Open

- [ ] **Analysis 2 — interactions**: ts-morph finds functions/components touched by the diff, walks references up to entry points (routes, components, handlers) and 1-2 levels down → Mermaid sequence diagrams per feature, using a versioned feature map JSON (generated once with Claude, updated incrementally).
- [ ] **Analysis 3 — impact and risk**: cross changes with test coverage and complexity → traffic light; warn about features without tests or with growing complexity.
- [ ] **Analysis 4 — public API / contracts**: diff exports (types, functions, props) between base and PR with ts-morph, and endpoints (OpenAPI or routes) → compatible/breaking, list affected usages.
- [ ] **Analysis 5 — bundle size**: build base and PR, compare chunks (gzip/brotli), flag over a configurable threshold and name the causing dependency/import.
- [ ] **Claude skill** on top of the CLI that explains the diagrams and risks.

### Scaffold follow-ups

- [ ] **Decide ADR-0003** (Action builds on every run) — still Proposed — `docs/adr/`.
- [ ] **Vulnerability reporting channel** — security.md has a TODO until the repo is public — enable GitHub private advisories.

## Done

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
