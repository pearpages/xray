# 0007. Impact and risk: static test evidence × complexity → traffic light

- **Date:** 2026-11-01
- **Status:** Proposed

## Context

Analysis 3 crosses the PR's changes with test coverage and complexity, shows a traffic light, and
warns about features without tests or with growing complexity.

**Coverage.** None of the target projects produces a coverage report in CI (surveyed 2026-11-01:
futbol-manager, pulp, flashcards, modals, bicing, cv, fit-tracker, rss, dummy). futbol-manager has
`@vitest/coverage-v8` installed but no CI step uses it. Real line coverage therefore needs either
each project to publish a report, or xray to run the test suites, which means installing the
project's dependencies and executing PR code (security.md requires a review before any analysis
does that) and takes minutes instead of about a second.

A spike measured a static alternative on the same PRs as before:

| PR | Touched units | Extra time | What it found |
|---|---|---|---|
| pearpages/dummy#3 | 5 | 0.1 s | `formatPrice` tested directly; `ActionButton`, `ProductCard`, `Cart` untested |
| futbol-manager 15d1220 | 4 | 0.4 s | `rolloverSeason` tested by 5 files; new `renewalYears` (complexity 4) only reached through a tested caller |
| futbol-manager 6f2e08e | 19 | 0.9 s | complexity up in `PlayerScreen` 48 → 50, `MatchResult` 5 → 7; screens tested only "via App" |

The last row shows the weak spot: futbol-manager's screen tests render `<App/>` and navigate, so
references alone say "tested via App" even though `CalendarScreen.test.tsx` sits next to
`CalendarScreen.tsx`.

## Decision

### Test evidence (no tests are run)

Each touched unit (as in [ADR-0004](0004-interactions-analysis.md)) gets the strongest evidence
found, in this order:

1. **direct**: a test file references the unit.
2. **by name**: a test file named after the unit's file sits next to it or in `__tests__/`
   (`CalendarScreen.tsx` ↔ `CalendarScreen.test.tsx`).
3. **indirect**: a test references a caller of the unit, at most `risk.indirectDepth` (default 3)
   levels up; the report names that caller.
4. **none**.

### Complexity

Cyclomatic complexity per unit (1 + branches: `if`, `?:`, `case`, loops, `catch`, `&&`, `||`, `??`),
on the PR and on the base (parsed from `git show`, as for new/removed units). The delta is what
"growing" means; new units have no delta.

### Traffic light

Per unit, then the worst one per feature (features as in Interactions) and for the whole PR:

| Light | When |
|---|---|
| 🔴 | no test evidence **and** (complexity ≥ `risk.complexityHigh`, default 15, **or** it grew by ≥ `risk.complexityJump`, default 3) |
| 🟡 | no test evidence; **or** only indirect evidence and complexity grew; **or** complexity ≥ high and grew |
| 🟢 | anything else |

### Output

Section `🚦 Impact and risk`: the PR's light, a table per feature (light, touched units, test
evidence, complexity before → after), then two lists the spec asks for: *features without tests*
and *growing complexity*. `XrayResult.risk` carries every unit's evidence and complexity as data.

The light is **informational**: it never fails the check.

## Open questions (to settle before Accepted)

1. **Coverage reports.** Proposed: static evidence only in v1. Alternatives: also read an `lcov`
   file when the project's CI produces one (cheap to add; none of the projects do today), or have
   xray run the tests (slow, executes PR code).
2. **Failing the check.** Proposed: never. Alternative: an opt-in `risk.failOn: "red"` that makes
   the Action fail on a red PR.
3. **Defaults.** complexity high 15, jump 3, indirect depth 3: from the spike's numbers (screens at
   20–59 would always be "high"; most helpers stay under 10). Good starting point?

## Consequences

+ Works on every project today, in under a second, without running PR code.
+ Points at the concrete gap: which changed unit, in which feature, has no test and how much more
  complex it got.
− "Tested" means "a test reaches it", not "its lines run": a test that renders a screen without
  touching the changed branch still counts.
− Cyclomatic complexity overrates flat `switch`/JSX conditionals and underrates nesting; it is a
  trend signal (the delta), not a quality score.
