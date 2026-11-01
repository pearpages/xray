# 0003. The composite Action builds xray on each run instead of committing `dist/`

- **Date:** 2026-11-01
- **Status:** Accepted

## Context

A GitHub Action referenced by git ref runs whatever is in the repository at that ref. JavaScript
actions usually commit a bundled `dist/` (e.g. with ncc) so they start instantly. xray depends on
dependency-cruiser and TypeScript, which load parsers dynamically and are awkward to bundle, and
the project has no release process yet.

## Decision

`action.yml` is a composite action: it runs `npm ci` and `npm run build` in `github.action_path`,
then the CLI and the comment script from the freshly built `dist/` folders. `dist/` stays
gitignored.

Measured on pearpages/dummy (2026-11-01): the whole job takes ~12 s, of which `npm ci` ~2 s and
the build ~2 s.

Revisit when:

- a new analysis adds dependencies or tooling that make the install + build step noticeably
  slower (analysis 5, bundle size, is the likely one) — every new analysis re-measures it on
  pearpages/dummy before it ships;
- someone needs to run the Action without network access to npm.

## Consequences

+ No build artefacts in git; what runs is always the source at that ref.
+ No bundler to configure around dynamic requires.
− Every PR run pays for a dependency install and a `tsc` build (~4 s today).
− Consumers depend on npm being reachable during their CI run.
