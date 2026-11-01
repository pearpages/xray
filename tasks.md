# Tasks

What's open and what's been done. Every change updates this file: tick or add an Open
item, and add a dated line at the top of **Done**.

## Open

- [ ] **Analysis 2 — interactions**: ts-morph finds functions/components touched by the diff, walks references up to entry points (routes, components, handlers) and 1-2 levels down → Mermaid sequence diagrams per feature, using a versioned feature map JSON (generated once with Claude, updated incrementally).
- [ ] **Analysis 3 — impact and risk**: cross changes with test coverage and complexity → traffic light; warn about features without tests or with growing complexity.
- [ ] **Analysis 4 — public API / contracts**: diff exports (types, functions, props) between base and PR with ts-morph, and endpoints (OpenAPI or routes) → compatible/breaking, list affected usages.
- [ ] **Analysis 5 — bundle size**: build base and PR, compare chunks (gzip/brotli), flag over a configurable threshold and name the causing dependency/import.
- [ ] **Claude skill** on top of the CLI that explains the diagrams and risks.
- [ ] Run the Action on a real PR (needs a GitHub remote) and check the Mermaid diagram renders in the comment.

### Scaffold follow-ups

- [ ] **Decide ADR-0002 and ADR-0003** — recorded as Proposed from this session's choices — `docs/adr/`.
- [ ] **Vulnerability reporting channel** — security.md has a TODO until the repo is public — enable GitHub private advisories.
- [ ] **Pin third-party actions by SHA** — tags can move — `action.yml`, `.github/workflows/`.
- [ ] **Bundle the Action** (ncc or similar) if the per-run `npm ci` + build gets too slow — ADR-0003 trade-off.

## Done

- [x] 2026-11-01: Report header shows the PR's head commit in CI, not GitHub's temporary merge commit (`--head`).
- [x] 2026-11-01: Report, CLI and README text switched from Spanish to English.
- [x] 2026-11-01: README names the MIT license.
- [x] 2026-11-01: Scaffolded project knowledge files — 11 created (incl. 3 ADRs and LICENSE), 0 fixed, 5 follow-ups.
- [x] 2026-11-01: Analysis 1 (dependencies) with CLI and GitHub Action that upserts one PR comment.
