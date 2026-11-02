# 0016. Quality phase 2: coverage, duplication, lint and types as built

- **Date:** 2026-11-02
- **Status:** Proposed — built and measured on xray, dummy, futbol-manager and bitepals; awaiting
  the owner's review.
- **Amends:** [0014](0014-project-quality-tool.md) (phase 2 metrics), [0015](0015-quality-phase-1-tuning.md).

## Context

ADR-0014 designed three phase 2 metrics. Building them and running them on four repositories
raised five questions the design left open, or answered in a way that didn't hold.

1. **jscpd changed.** jscpd 5 is a Rust binary (41 MB, one optional dependency per platform) with
   no JavaScript API, so "run in-process" is not possible with it. jscpd 4.3.0 (August 2026, still
   released) is JavaScript, 18 MB, but its ES module build imports `colors/safe` without an
   extension, which Node rejects.
2. **A broad tsconfig is not how a package compiles.** bitepals' root `tsconfig.json` only extends
   Expo's base, so `tsc -p tsconfig.json` checked every app without its `@/` alias: 1 953 "cannot
   find module" errors, none real. Its apps type-check with `tsc -p tsconfig.build.json` (no tests).
3. **`tsc --noEmit` can still write.** An `incremental` or `composite` project writes a
   `.tsbuildinfo` even with `--noEmit`.
4. **Hotspots took 138 s on bitepals.** Core's `unitsOf` called ts-morph's `isDefaultExport()`,
   which starts the type checker; the per-file project rebuilt a program for each file.
5. **`pnpm audit --json` (pnpm 9) printed 269 MB on bitepals** in 57 s, past the 64 MB buffer and
   near the 60 s timeout.

## Decision

1. **Duplication uses jscpd 4.3.0 through its CommonJS build** (`createRequire`), in-process on the
   code files, `reporters: []`, nothing written. Clones ≥ 50 tokens are low, ≥ 200 medium; the score
   is `100 − 4 × duplicated %` over each duplicated line counted once.
2. **Lint and types follow the project's own setup:**
   - ESLint runs from every folder with an ESLint config (flat or legacy), with that folder's
     installed `eslint`; a parent run ignores sub-folders that have their own config.
   - TypeScript checks every tracked `tsconfig.json`; a folder whose `typecheck` (or `type-check`,
     `check-types`, `types`, `tsc`) script runs `tsc -p <config>` is checked with that config, and
     a solution-style config (`files: []` + `references`) stands for its references.
   - **A file's errors count only from the run of its nearest `tsconfig.json`**, the rule of
     [ADR-0013](0013-per-package-tsconfig.md): a broader config's opinion of a package's file is
     noise.
   - ESLint errors and TypeScript errors are medium, ESLint warnings low; findings formula.
3. **tsc runs with `--noEmit --incremental false --composite false`**, so no `.tsbuildinfo` is
   written. Checked on every run of the four repositories: `git status --ignored` and every
   `.tsbuildinfo` timestamp unchanged.
4. **`unitsOf` reads default exports from the syntax** (`export default`, `export default X;`,
   `export { X as default }`), no type checker. Same units, same flags; covered by new core tests.
5. **Dependencies:** 1 GiB output buffer, a 180 s default timeout, and an *unavailable* reason that
   says what happened (output too large, timed out) instead of "isn't available".
6. **Coverage** (as ADR-0014) counts a line covered only when it ran with every branch taken
   ([ADR-0012](0012-pilot-follow-ups.md)). Code files missing from the lcov report aren't counted
   (they have no instrumented lines) but are listed and named in the summary; a report older than
   the last commit is flagged.
7. **Each metric records `durationMs`** in the report (optional field; report `version` stays 1).
8. **The Action no longer installs the root's dev dependencies** (`--include-workspace-root`
   dropped): core, cli and action declare `@types/node` themselves (TypeScript is already core's).
   Vitest lists `jsdom` and `@vitest/coverage-v8` as optional peers, and npm installs them next to
   vitest once they're in the lockfile, even with `--omit=peer`: through the root, the UI's test
   tooling would have reached every PR run (91 → 138 packages). Test-only tools (`eslint`,
   `@vitest/coverage-v8`) are dev dependencies of `@xray/quality`, never installed by the Action.

## Consequences

+ Lint and types agrees with the projects' own CI: bitepals 100 (its CI runs `eslint
  --max-warnings=0` and each app's typecheck), not 0 from 2 001 phantom errors.
+ Hotspots on bitepals: 0.6 s instead of 138 s; the PR report's interactions analysis gets the
  same speed-up.
+ The Action installs 58 packages (49 MB) instead of 91 (84 MB); install + build 2 s on a clean
  copy, measured on pearpages/dummy before release (P6).
+ Whole runs: xray 4 s, dummy 1 s, futbol-manager 11 s, bitepals 172 s (124 s are pnpm's `audit`
  and `outdated`, 42 s its ESLint and tsc).
− jscpd 4 may stop being released; moving to jscpd 5 would mean running its binary and reading a
  JSON report from a temporary folder.
− A `typecheck` script that runs something other than `tsc -p …` (a shell script, `vue-tsc`) isn't
  followed; that folder's `tsconfig.json` is checked instead.
− Running ESLint executes the project's config (code), as running its own lint would
  ([security.md](../../security.md)).
