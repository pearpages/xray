# 0018. Coverage counts the files no test loads

- **Date:** 2026-11-02
- **Status:** Accepted — under the owner's delegation ("do whatever you think is best, but document
  it"), after the first run on a real lcov report.
- **Amends:** [0016](0016-quality-phase-2.md), point 6.

## Context

ADR-0016 listed code files missing from the lcov report without counting them. The owner ran
bitepals' web tests with coverage: Coverage scored **76**, over the 373 files some test loaded.
Vitest (like most runners, without `coverage.all`/`include`) only instruments files a test imports,
so 316 other web files were simply absent: never run by any test. Counting only what tests touch
rewards not testing.

## Decision

1. **A code file inside a project that has a report, but absent from it, is 0 % covered** and a high
   finding ("no test loads it"). The project of a report is the folder holding its `coverage/`
   folder; a report elsewhere covers the root. Files of projects with no report (bitepals' mobile
   and pass apps) stay unknown: listed, not counted.
2. **Its instrumented lines are estimated**: the file is transpiled as the test runner would (types
   erased, TypeScript's `transpileModule`), imports and re-exports dropped, and its remaining lines
   are scaled by the report's own ratio of instrumented lines to such lines over the files it does
   cover (0.41 on bitepals, 0.52 on xray). A types-only file or a barrel has nothing to run and isn't
   counted.
3. **`coverage.exclude`** (default `**/*.config.*`, `**/scripts/**`, `**/testing/**`,
   `**/test-utils/**`, `**/__mocks__/**`, `**/mocks/**`, `**/.storybook/**`) leaves tooling out of the
   metric, as a runner's coverage `exclude` does; xray can't read each runner's config.

Alternatives: keep listing absent files (the 76 above); count them by file instead of by line (a
3-line helper would weigh as much as a 200-line page); read the runner's config (one parser per
runner and config format, and the config is code).

## Consequences

+ bitepals' web coverage: 60 instead of 76, with the untested files named, biggest first
  (`lib/activity/queries.ts`, ≈ 85 lines). xray: 80 (one untested entry file, `main.tsx`).
+ A project that reports every file (`coverage.all`, or `include` in Vitest) gets exact numbers; the
  estimate only fills the gaps.
− The estimate is an approximation (± a few lines per file).
− Tooling outside the default globs counts as untested until it's added to `coverage.exclude`.
