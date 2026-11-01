# 0008. Public API: syntactic export diff, usages through barrels, OpenAPI JSON

- **Date:** 2026-11-01
- **Status:** Accepted — decided by Claude under the owner's delegation ("take the decisions you
  consider fit, document them"); the open points are listed in tasks.md for the owner to answer.

## Context

Analysis 4: diff exports (types, functions, props) and endpoints between base and PR, classify
them as compatible or breaking, and list the affected usages. The target repos are mostly React
apps without a backend; their real contracts are what workspace packages export to each other
(futbol-manager's `@fm/domain`, imported 45 times by the app) and, in libraries, their entry
points. The base version of a file is only available as text (`git show`), not as a typed program.

## Decision

- **Every changed code file's exports are compared** (tests and stories excluded). An export is
  marked 📦 **public** when a workspace package's entry point reaches it, directly or through
  `export … from` barrels. Internal exports of an app are still listed: they are contracts between
  its modules.
- **Signatures are read from the source text** on both sides with the same code, so the base needs
  no type checker: function parameters (name, optional/default/rest, written type), return type,
  props when a component's single parameter has a type written in the same file, members of
  interfaces and object type aliases, class and enum members, re-exports.
- **Classification:**
  - 🔴 *breaking*: export removed; kind changed; new required parameter; parameter removed or made
    required; prop or member removed; new required prop.
  - 🟡 *review*: a written type changed; return type changed; a plain type gained a required member
    (fine for producers, breaking for code that builds it).
  - 🟢 *compatible*: export added; new optional parameter, prop or member; parameter made optional.
- **Usages** come from one index of imports over the loaded project, following barrels, so
  `import { total } from "@fm/domain"` counts as a use of `packages/domain/src/cart.ts#total`.
  Test files are counted apart ("1 file, 1 test").
- **Endpoints:** changed OpenAPI/Swagger **JSON** files (`openapi*.json`, `swagger*.json`) are
  compared by `METHOD path`: removed → breaking, added → compatible. YAML specs get a warning, not a
  comparison (no YAML parser without a new dependency).
- Section `📜 Public API`; `XrayResult.api` carries every change, its reasons and its users. It never
  fails the check, like the risk light.

## Consequences

+ Works with no type information on the base and no dependency installed; ~0.1 s on top of a PR.
+ Package APIs in monorepos are the main case and are covered through barrels.
− Types written elsewhere (`props: ButtonProps` imported from another file) compare by name only: a
  change inside that imported type shows on its own file's export, not on the component.
− Inferred types (no annotation) aren't compared; changing what an un-annotated function returns
  isn't seen.
− Route-based endpoints (Express, Next.js route handlers) and OpenAPI YAML are not covered yet.
