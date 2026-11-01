# 0002. Keep `typescript` on 6.x while dependency-cruiser does not support 7

- **Date:** 2026-11-01
- **Status:** Proposed

## Context

The latest TypeScript is 7.x. dependency-cruiser 18 only loads `typescript` in the range
`>=2.0.0 <7.0.0`; with 7 installed it silently skips `.ts`/`.tsx` files and the dependency graph
comes back empty. The core needs `typescript` at runtime for that parser, and the workspace uses the
same version to compile.

## Decision

Pin `typescript` to `~6.0.3`, both as a runtime dependency of `@xray/core` and as the root dev
dependency used by `tsc -b`. Revisit when dependency-cruiser widens its supported range.

## Consequences

+ Analysis 1 works on TypeScript/React projects.
+ One TypeScript version for building and parsing; no surprises between them.
− We don't get TypeScript 7's faster compiler for our own build.
− The upgrade has to be tracked by hand; nothing fails loudly if the range changes.
