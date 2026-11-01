# 0012. Pilot follow-ups: component entry points, folder diagrams, branch coverage

- **Date:** 2026-11-01
- **Status:** Accepted — decided by Claude under the owner's delegation ("finish the tasks, take
  the decisions you see fit, and document the outcome").
- **Amends:** [0004](0004-interactions-analysis.md) (entry points),
  [0011](0011-barrels-coverage-and-routes.md) (coverage) and the dependency neighbourhood.

## Context

The pilot on futbol-manager (pearpages/futbol-manager#22, a replay of its PR #20: 84 files, 34
changed units, 60 changed modules) left three items in tasks.md:

1. **Entry points.** `interactions.entryGlobs` made every unit of a matching file an entry point:
   73 inventory candidates, most of them helpers next to screens (`CajaScreen.tsx#signed`,
   `MarketScreen.tsx#listingsFor`), and walks that could stop at a helper instead of its screen.
2. **Big PRs.** The dependency diagram held 60 changed files, no neighbours, and left 80 out.
3. **Line coverage** counts a changed line as covered even when a branch on it never ran.

## Decision

1. **In entry-glob files, entry points are components**: PascalCase names (not ALL_CAPS) or the
   default export. In a file without components (`main.tsx`, a Next.js route file), its units that
   nothing in the code calls (`root`, `GET`; the framework calls them) are entry points too; helper
   modules that screens use are not. Applies to the walk and to `--inventory`.
2. **Folder view.** When the changed modules alone would take more than half of
   `dependencies.maxNodes`, the diagram shows one node per folder ("screens: 27 changed of 50
   files"), coloured when it holds changes, with an edge between folders when any file of one uses
   any file of the other. `DependencyAnalysis.level` says which view was drawn.
3. **Branch coverage.** When the lcov report has `BRDA` lines, a changed line counts as covered
   only if it ran **and** every branch on it was taken; the evidence also counts untaken branches
   ("partly covered (5/7 changed lines, 2 branches never taken)").

## Consequences

+ futbol-manager: 73 → 38 inventory candidates, all components or the app root; with its map, 7
  are uncovered, all shared UI. The replay's dependency diagram: 29 folders instead of 60 files
  with 80 left out.
+ A changed `if`/`?:`/`&&` whose other path no test takes no longer reads as covered.
− Branch data only knows about control flow: dummy's `formatPrice(amount, currency = "EUR")` →
  `SYMBOLS[currency]` has no branch for the untested USD case (a default value and a lookup), so it
  still reads as covered. Coverage can't see untested *data*.
− A PR just over the threshold loses per-file detail; `maxNodes` can be raised to keep it.
− PascalCase is a convention: a lowercase component (rare in React) wouldn't be an entry point.
