# 0013. Each workspace package resolves imports with its own tsconfig

- **Date:** 2026-11-01
- **Status:** Accepted — fix requested by the owner after bitepals' first report.
- **Amends:** [0004](0004-interactions-analysis.md) ("they share the root's compiler options") and
  the dependency analysis.

## Context

bitepals (pearpages/fourpass) is a pnpm monorepo whose apps each map `@/*` to their own folder
(`apps/web` and `apps/pass` to `./*`, `apps/mobile` to `./src/*`, through `extends:
"expo/tsconfig.base"`). Its root tsconfig only extends `expo/tsconfig.base`, which isn't installed
in CI. On its PR #134, xray couldn't resolve `@/lib/places/responses` from the photo route, so the
changed `createPhotoResponse` showed as its own entry point "not in the feature map" instead of
**Place page**, and the dependency analysis warned `Could not read tsconfig.json`. The README
documented the limit; for this layout it breaks almost every PR.

## Decision

- **Interactions:** each package's compiler options are read from its own `tsconfig.json`
  (following `extends` as far as installed; a missing base is skipped and the file's own options,
  `paths` included, still apply). A file resolves imports with the options of the package that
  contains it; workspace package names still resolve to their source first.
- **Dependencies:** at a workspace root, dependency-cruiser runs once per package with that
  package's tsconfig, plus once for the files outside packages with the root's, and the results are
  merged. Each run stops at other packages' folders (their files are leaves there; their own run
  resolves their imports). `paths` are always passed as resolver aliases too, because
  dependency-cruiser's tsconfig plugin ignores them without a `baseUrl` and can't read a file whose
  `extends` is missing. An unreadable root tsconfig is no longer a warning.

## Consequences

+ bitepals #134: the change reaches **Place page**; no warning; the dependency diagram resolves the
  route's `@/…` imports (5 → 11 modules).
+ futbol-manager: unchanged results (it uses relative imports and package names).
− One dependency-cruiser run per package: a little slower on big workspaces (bitepals ~3 s).
− Aliases are built from `paths` patterns of the form `prefix/*` → `dir/*` and exact keys; other
  patterns (a `*` in the middle) and `baseUrl`-relative bare imports aren't covered when
  dependency-cruiser can't read the tsconfig itself.
