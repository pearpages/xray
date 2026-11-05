# 0022. xray itself uses npm, not pnpm

- **Date:** 2026-11-05
- **Status:** Accepted

## Context

xray has always used npm workspaces, but the choice was never recorded, and pnpm is the obvious
alternative: the main target repositories (futbol-manager, bitepals) are pnpm monorepos, and pnpm
offers a strict `node_modules`, a shared store and `workspace:*` links.

xray's own package manager runs in three places:

- **The Action, in every consumer's CI run.** `action.yml` installs and builds xray in
  `github.action_path` on each run ([ADR-0003](0003-action-builds-at-runtime.md)), filtered to the
  three workspaces a PR run needs: `npm ci --workspace @xray/core --workspace @xray/cli --workspace
  @xray/action`, then `build:action` ([ADR-0014](0014-project-quality-tool.md),
  [ADR-0016](0016-quality-phase-2.md)). It sets `package-manager-cache: false`, so xray never
  caches anything inside the consumer's repo. `npm ci` took ~2 s of a ~12 s job on pearpages/dummy.
- **The Claude Code plugin, on users' machines.** `plugins/xray/scripts/xray.sh` clones and builds
  xray with `npm ci` on first use; the skills require only Node.js, git and npm.
- **This repository's CI and local development.**

This is separate from the package manager of the project being analysed: xray already handles pnpm
projects (`pnpm-workspace.yaml`, `pnpm audit`/`outdated`, `corepack enable` before bundle builds)
whatever it uses for itself.

pnpm's main gains are install speed and disk use from its store, and strictness. In the Action, the
place that matters most, the store is cold on every run (no cache, by design) and the install is
already ~2 s, so most of the speed gain doesn't arrive. Its costs land there instead: a setup step
(`corepack enable` or `pnpm/action-setup`) on every consumer's run, another prerequisite for plugin
users, and pnpm's isolated `node_modules`, which can break tools that load packages from their own
location — dependency-cruiser loads `typescript` that way, the dependency already pinned by
[ADR-0002](0002-typescript-6-for-dependency-cruiser.md).

## Decision

xray uses **npm** (workspaces, `package-lock.json`, `npm ci`) for its own install and build: in
`action.yml`, in `plugins/xray/scripts/xray.sh`, in CI and in the commands in `AGENTS.md`.

Strictness, pnpm's real advantage here, is sought without switching: a dependency only tests need
goes in a workspace's `devDependencies`, never the root's (ADR-0016), and
`.github/workflows/xray.yml` runs the Action from the PR's own source (`uses: ./`) on every PR, so
its filtered install and `build:action` fail before merge if a PR-run package relies on something
it didn't declare.

Revisit when:

- the Action can cache a pnpm store safely (outside the consumer's repo) and that measurably beats
  `npm ci`;
- npm workspaces block something the project needs (filtering, internal version links);
- an undeclared dependency reaches a release despite the check above.

## Consequences

+ Nothing to install beyond Node: `actions/setup-node`, consumers' runners and plugin users
  already have npm.
+ The Action's install stays as measured in ADR-0003; no extra step or third-party setup action
  in the supply chain ([security.md](../../security.md)).
+ dependency-cruiser, ts-morph and TypeScript resolve each other through a flat `node_modules`, as
  they were tested.
− No strict `node_modules`: an undeclared import works locally until the Action's filtered install
  in `xray.yml` exposes it, and only for the three PR-run packages; elsewhere ADR-0016's rule is
  kept by review, not by the tool.
− Slower installs and a full `node_modules` per clone, compared with pnpm's store.
− Internal versions (`"@xray/core": "0.1.0"`) are kept in step by hand; there is no `workspace:*`.
− Contributors use npm here and pnpm in the main target repositories.
