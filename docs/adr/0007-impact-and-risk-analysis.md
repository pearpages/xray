# 0007. Impact and risk: static test evidence × complexity → traffic light

- **Date:** 2026-11-01
- **Status:** Accepted

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

## Questions settled before acceptance

Settled 2026-11-01; the user asked for the most convenient option on each, recorded here.

1. ~~Coverage reports?~~ **Static evidence only in v1.** Nothing to set up and no PR code executed.
   Reading an `lcov` file when a project's CI publishes one is the natural next step and gets its
   own ADR when a project starts producing one; running the test suites from xray was rejected
   (minutes per PR, executes PR code).
2. ~~Failing the check?~~ **Never.** The light is information for the reviewer. An opt-in
   `risk.failOn` can be added by a later ADR if a team asks for it.
3. ~~Defaults?~~ **As proposed:** `risk.complexityHigh` 15, `risk.complexityJump` 3,
   `risk.indirectDepth` 3, all configurable in `xray.config.json`.

## Consequences

+ Works on every project today, in under a second, without running PR code.
+ Points at the concrete gap: which changed unit, in which feature, has no test and how much more
  complex it got.
− "Tested" means "a test reaches it", not "its lines run": a test that renders a screen without
  touching the changed branch still counts.
− Cyclomatic complexity overrates flat `switch`/JSX conditionals and underrates nesting; it is a
  trend signal (the delta), not a quality score.
