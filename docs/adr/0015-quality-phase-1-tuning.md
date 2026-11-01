# 0015. Quality phase 1: what running it on real repositories changed

- **Date:** 2026-11-01
- **Status:** Accepted — tuning done while building phase 1, as ADR-0014 planned ("to be tuned on
  futbol-manager and bitepals").
- **Amends:** [0014](0014-project-quality-tool.md).

## Context

Phase 1 ran on four repositories: xray, dummy, futbol-manager (pnpm, 5 packages) and bitepals
(pnpm, Expo + Next.js, 3 apps). Three results were wrong for reasons the design didn't foresee.

1. **Architecture was unavailable everywhere.** The default feature folder `**/src/features/*` missed
   bitepals, whose apps keep features in `apps/<app>/features/*` (no `src/`).
2. **`_shared` was a feature.** bitepals has `features/_shared`; every import of shared code (24 of
   64 findings) counted as a deep import into another feature.
3. **Dependencies scored 0 on both pnpm repos.** `audit` counted every advisory of every package,
   dev tooling included, one entry per advisory: futbol-manager 25 vulnerable packages, bitepals
   215. At 15 points per high finding, seven of them reach 0, so the score said nothing.

## Decision

1. Default `architecture.features` is `**/features/*`, which matches `src/features/*` and
   `apps/web/features/*` alike.
2. Folders among the features whose name matches `architecture.shared` (default `_*`, `shared`,
   `common`) are shared code: not features, importable by any feature.
3. `audit` covers **production dependencies** by default (`pnpm audit --prod`, `npm audit
   --omit=dev`); `dependencies.dev: true` includes devDependencies. Each package counts once, at its
   worst severity. The formula stays as in ADR-0014.

## Consequences

+ futbol-manager: Dependencies 97 (no production vulnerabilities, 3 majors behind) instead of 0.
+ bitepals: Architecture runs: 21 features, 40 deep imports, 2 cycles (82); Dependencies stays at 0
  with 40 vulnerable production packages, 22 high or critical, a real signal for the app.
− Vulnerabilities in build tooling no longer lower the score unless `dev` is on.
− A feature folder literally named `shared` or starting with `_` can't be a feature without
  changing `shared`.
