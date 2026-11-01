# Decisions

Architecture Decision Records for xray. Each ADR in `docs/adr/` records one choice, its
context and its trade-off. The rules that follow from them are in
[principles.md](principles.md).

New ADR: copy the format below, take the next number, and add a line here. An accepted ADR
is not edited; reversing it means a new ADR whose status says `Supersedes NNNN`, and the old
one's status becomes `Superseded by NNNN`. ADRs are proposed to the user before they are
accepted.

| # | Decision | Status | Date |
|---|---|---|---|
| [0001](docs/adr/0001-project-knowledge-files.md) | Project knowledge lives in principles, architecture, decisions, tasks and security | Accepted | 2026-11-01 |
| [0002](docs/adr/0002-typescript-6-for-dependency-cruiser.md) | Keep `typescript` on 6.x while dependency-cruiser does not support 7 | Accepted | 2026-11-01 |
| [0003](docs/adr/0003-action-builds-at-runtime.md) | The composite Action builds xray on each run instead of committing `dist/` | Accepted | 2026-11-01 |
| [0004](docs/adr/0004-interactions-analysis.md) | Interactions analysis: ts-morph walk, feature map and sequence diagrams | Accepted | 2026-11-01 |
| [0005](docs/adr/0005-interactions-refinements.md) | Interactions: lookup tables, hubs and shallower callees (amends 0004) | Accepted | 2026-11-01 |
| [0006](docs/adr/0006-feature-map-skill-plugin.md) | The feature map skill ships as a Claude Code plugin from this repo | Accepted | 2026-11-01 |
| [0007](docs/adr/0007-impact-and-risk-analysis.md) | Impact and risk: static test evidence × complexity → traffic light | Accepted | 2026-11-01 |
| [0008](docs/adr/0008-public-api-analysis.md) | Public API: syntactic export diff, usages through barrels, OpenAPI JSON | Accepted (delegated) | 2026-11-01 |
| [0009](docs/adr/0009-bundle-size-analysis.md) | Bundle size: opt-in builds of base and PR in throwaway worktrees | Accepted (delegated) | 2026-11-01 |
| [0010](docs/adr/0010-versioning-and-releases.md) | Versioned releases: `vX.Y.Z` tags and a moving `v0` | Accepted (delegated) | 2026-11-01 |
| [0011](docs/adr/0011-barrels-coverage-and-routes.md) | Barrel importers, lcov coverage and Next.js route handlers | Accepted (delegated) | 2026-11-01 |

## Format

```md
# NNNN. Title

- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Superseded by NNNN

## Context
What forces the choice.

## Decision
What we do.

## Consequences
What gets better (+) and what it costs (−).
```
