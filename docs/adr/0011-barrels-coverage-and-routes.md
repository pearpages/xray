# 0011. Barrel importers, lcov coverage and Next.js route handlers

- **Date:** 2026-11-01
- **Status:** Accepted — decided by Claude under the owner's delegation ("do the optional tasks,
  take the decisions that you think fit, but document them").
- **Amends:** the dependency neighbourhood (architecture.md), [0007](0007-impact-and-risk-analysis.md)
  (test evidence) and [0008](0008-public-api-analysis.md) (endpoints).

## Context

Three follow-ups were parked under *Later, if needed*:

1. In a monorepo, a change inside a package stopped at the package's `index.ts` in the dependency
   diagram (direct neighbours only), although the app imports the package through that file.
   futbol-manager's `@fm/domain` is imported by 59 files.
2. Risk evidence was static only; a project that runs its tests with coverage had no way to tell
   xray which lines actually ran.
3. Endpoints covered OpenAPI JSON only; slotflow uses Next.js (although, checked on 2026-11-01, it
   has no route handlers today).

## Decision

1. **Barrels bring their importers.** A neighbour whose statements are all `export … from`
   (checked with TypeScript's parser) and that re-exports a changed module is drawn as
   `index.ts (re-exports)`, together with the files that import it: one more hop, ranked below
   direct neighbours. Past 8 importers they become one rounded node per folder ("32 files"), so a
   package imported everywhere can't flood the diagram. One level only: a barrel re-exporting
   another barrel isn't followed further.
2. **lcov coverage is the strongest evidence where it exists.** xray reads `risk.coverage` (a list
   of lcov files) or, by default, `coverage/lcov.info` at the root and in each workspace package.
   The workflow must produce them before the xray step; xray still runs no tests. For each touched
   unit in a covered file it counts covered lines among the unit's **changed** lines (all its lines
   when no changed line is instrumented). All covered counts like *direct*, some like *indirect*,
   none like *none* in the [ADR-0007](0007-impact-and-risk-analysis.md) table. Files the report
   doesn't mention keep static evidence. `SF:` paths are resolved relative to the project that made
   the report, or, when absolute from another machine, by their longest suffix that exists.
3. **Next.js route handlers are endpoints.** App Router `route.(ts|js)` files are compared by the
   HTTP methods they export (`GET`, `POST`, …); Pages Router `pages/api/*` files as `ANY` when they
   have a default export. The URL comes from the path: route groups `(x)` and `@slots` removed,
   `[params]` kept, `index` dropped. Removed method → 🔴, added → 🟢; a moved file is a removed URL
   plus a new one.

## Consequences

+ futbol-manager 15d1220 (changes inside `@fm/domain`): the dependency diagram now reaches the
  app, data and persistence packages through 6 folder nodes instead of stopping at `index.ts`.
+ dummy with a real Vitest lcov report: `ActionButton`, `ProductCard` and `Cart` show "not
  covered (0/1 changed lines)", `formatPrice` and `SYMBOLS` "covered".
− Line coverage, not branch coverage: a changed line that ran counts as covered even if a branch on
  it didn't (dummy's `formatPrice` ran only with the euro default, yet its changed lines are
  covered). lcov's `BRDA` branch data could refine this later.
− Route handlers are tested on fixtures only: no target project has any yet. Handler signatures
  and request/response types are not compared, only which methods exist.
