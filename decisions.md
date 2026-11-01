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
