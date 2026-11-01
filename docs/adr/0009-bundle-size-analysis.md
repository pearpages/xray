# 0009. Bundle size: opt-in builds of base and PR in throwaway worktrees

- **Date:** 2026-11-01
- **Status:** Accepted — decided by Claude under the owner's delegation ("take the decisions you
  consider fit, document them"); the open points are listed in tasks.md for the owner to answer.

## Context

Analysis 5: build the base and the PR, compare chunks (gzip/brotli), flag growth over a
configurable threshold and say which dependency or import causes it. It is the first analysis that
has to **run the project's code**: its install scripts and its build. security.md requires a review
before that, and [ADR-0003](0003-action-builds-at-runtime.md)'s ~4 s install + build becomes
minutes. The target projects are Vite apps (pnpm or npm), none of which emits source maps by default.

## Decision

- **Opt-in.** Off unless `bundle.enabled` (config), `--bundle` (CLI) or `bundle: "true"` (Action).
  The other analyses and their timing are unchanged when it is off.
- **Throwaway worktrees.** The base (merge base) and the PR (`HEAD`; in CI the merge commit) are
  each checked out with `git worktree add --detach` in a temp folder, installed, built, measured and
  removed. The user's working tree and `node_modules` are never touched; uncommitted changes are not
  part of the measurement.
- **What runs:** `bundle.install` / `bundle.build` when set. Otherwise the install comes from the
  lockfile (`pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile`, `npm ci`, or
  `npm install`), and the build is `vite build --sourcemap hidden --emptyOutDir` for Vite projects
  (skips the type-check most `build` scripts run first, and emits source maps without linking them)
  or the `build` script otherwise. Output folder: `bundle.outDir`, else `dist`/`build`/`out`.
- **Measure:** every `.js`, `.mjs`, `.cjs` and `.css` file in the output, raw, gzip (level 9) and
  brotli (quality 11). Chunks are matched across builds by path with the content hash removed
  (`assets/index-BqX3k2aL.js` → `assets/index.js`).
- **Light:** 🔴 when total gzip grows by more than `bundle.thresholdBytes` (10 KB) **or**
  `bundle.thresholdPercent` (5 %); 🟡 when it grows less; 🟢 when it doesn't grow. It never fails
  the check, like the other lights.
- **Causes:** with source maps, each chunk's gzip size is spread over its sources and grouped by npm
  package (or "your code"); the biggest changes are listed. Always: `dependencies` added, removed or
  re-versioned in any changed `package.json`.
- **A failed install or build** is shown in the section with the error lines; the rest of the report
  is unaffected.
- **Safety in the Action:** the token stays in the comment step (as before); consumers should check
  out with `persist-credentials: false` when enabling it, so the PR's build can't read the
  checkout's token. Only for `pull_request` events, where fork PRs get a read-only token anyway.

## Consequences

+ Works with zero config on Vite projects, and with two config lines on anything else.
+ Real numbers from real builds, matched chunk by chunk, with a likely cause.
− Minutes per PR when enabled (two installs and two builds; dummy: 6 s with a warm npm cache).
− It runs PR code: install scripts and the build. Acceptable for a project's own PRs, same as its CI;
  never enable it on `pull_request_target`.
− Per-package numbers are estimates (gzip spread by raw bytes), good for ranking causes, not for
  exact accounting; changes under 64 B are hidden as noise.
