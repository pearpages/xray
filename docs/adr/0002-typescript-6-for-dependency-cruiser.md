# 0002. Keep `typescript` on 6.x while dependency-cruiser does not support 7

- **Date:** 2026-11-01
- **Status:** Accepted

## Context

TypeScript 7 (7.0.2, July 2026) is the native rewrite and ships only the `tsc` binary: no
JavaScript API, no `main`, no type definitions. Every tool that reads code through TypeScript's
JS API is therefore limited to 6.x — dependency-cruiser (`>=2.0.0 <7.0.0`), madge and skott (via
`@typescript-eslint/typescript-estree`), and ts-morph, which bundles TypeScript 6.0.2 itself.
With 7 installed, dependency-cruiser silently skips `.ts`/`.tsx` files and the dependency graph
comes back empty while the build and tests still pass.

Alternatives considered for building the graph:

- **ts-morph** — one engine with analysis 2, no separate `typescript` pin, but it is still
  TypeScript 6 inside, we would reimplement import detection (dynamic, type-only, non-code
  imports), and it loads the whole program, so it is likely slower.
- **oxc-parser + oxc-resolver** — no TypeScript at all and very fast, but we would own the graph
  code and analysis 2 would still need ts-morph: two parsers.
- **madge / skott** — same TypeScript 6 limit, no gain.

dependency-cruiser is the most used of these (~7.9 M weekly downloads, 25 releases in 2026), but
almost all of it is written by one maintainer.

## Decision

Keep dependency-cruiser for analysis 1 and pin `typescript` to `~6.0.3`, both as a runtime
dependency of `@xray/core` and as the root dev dependency used by `tsc -b`.

Revisit when TypeScript 7 offers an API for tools, or when analysis 2's ts-morph project can
produce the same import graph at a similar cost (measured in its design), so both analyses
resolve imports the same way.

## Consequences

+ Analysis 1 works on TypeScript/React projects, with dependency-cruiser's handling of aliases,
  type-only, dynamic and non-code imports.
+ One TypeScript version for building and parsing, the same one ts-morph uses.
− We don't get TypeScript 7's faster compiler for our own build.
− Upgrading `typescript` to 7 breaks the graph silently; it needs a new ADR, not a version bump.
− Single-maintainer dependency. Mitigated: MIT licence, versions pinned by the lockfile, and it is
  used only in `cruiseProject` behind our own `Graph` type, so replacing it is one function.
