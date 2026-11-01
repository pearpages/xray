# 0006. The feature map skill ships as a Claude Code plugin from this repo

- **Date:** 2026-11-01
- **Status:** Proposed

## Context

[ADR-0004](0004-interactions-analysis.md) decided that a Claude skill writes `xray.features.json`
and xray only reads it. The skill has to run in the user's own projects, where xray is not
installed: it is not published to npm, and the Action builds it from source on each run
([ADR-0003](0003-action-builds-at-runtime.md)). The skill also needs facts only xray has: which
units can start a feature, with ids in xray's `path#name` form, and whether an existing map still
matches the code.

## Decision

- **Distribution:** this repository is also a Claude Code plugin marketplace
  (`.claude-plugin/marketplace.json`) with one plugin, `plugins/xray`, holding the skill
  `features`. Users run `/plugin marketplace add pearpages/xray`, then `/plugin install xray@xray`,
  and invoke `/xray:features`. No plugin `version` is set, so installed copies follow commits, like
  the Action follows `@main`.
- **Running xray:** the skill calls `scripts/xray.sh`, which keeps a shallow clone of
  `pearpages/xray` in the plugin's data folder, builds it on first use and whenever `main` moves,
  and falls back to the last build without network. It needs Node.js 22+, git and npm.
- **What xray gives the skill:** a read-only `--inventory` mode of the CLI that prints JSON:
  entry-point candidates (entry globs, unused exports, hubs) with their caller counts, the feature
  map's status, map entry points that no longer exist, and entry-glob candidates no feature claims.
  The CLI stays one command; `--inventory` is an output mode, like `--format json`.
- The skill reads the code and the docs to name features in the team's language, writes the map,
  checks it with a second inventory, and leaves review and commit to the user.

## Consequences

+ One repository, one install line; the skill and the CLI it calls change together.
+ The skill never guesses ids: it copies them from the inventory, and the second inventory proves
  the map is valid.
+ `--inventory` is also useful on its own to audit a map.
− The first run downloads and builds xray (~1 minute on a cold npm cache); the skill says so.
− The skill runs code downloaded from GitHub on the user's machine, the same trust as installing
  the plugin itself (see [security.md](../../security.md)).
− Publishing xray to npm later would make the script unnecessary (`npx`); that would be a new ADR.
