# 0019. The JSON outputs are a versioned contract for outside tools

- **Date:** 2026-11-04
- **Status:** Proposed

## Context

The agents kit (`~/Projects/agents`, a separate repository) wants to use xray in its loop: an
xray report of each task's change for its reviewer, and a quality report at its final pass
(its ADR 0017). P1 and P2 already make data the product, but nothing says which data an outside
tool may rely on. `xray-quality`'s report has `version: 1`; `xray -f json` prints `XrayResult`
with no version, so a renamed field would break a consumer silently.

Three ways to connect the kit:

- **Move the kit into this monorepo.** Rejected: xray is distributed (MIT, a GitHub Action
  rebuilt in every consumer repo, P6), the kit is a personal macOS tool that drives Claude Code
  with wide permissions. It would grow the Action's workspace, this repo's security surface and
  its audience for no gain to xray.
- **The kit imports `@xray/core` as a library.** Rejected: core re-exports most of its modules
  (`export *`), so every internal rename would become a breaking change.
- **The kit runs the CLIs and reads their JSON.** Chosen.

## Decision

1. **The contract is the JSON the CLIs print**: `xray <base> -f json` (`XrayResult`) and
   `xray-quality` (`QualityReport`). Importing `@xray/core` or `@xray/quality` from outside this
   repo is not supported.
2. **`XrayResult` gains `version: 1`**, as `QualityReport` already has.
3. **Adding a field is not a breaking change.** Removing or renaming a field, or changing what
   one means, bumps that output's `version` and is stated in the release notes. Consumers ignore
   fields they don't know and refuse a `version` they don't know.
4. **A test pins each contract**: the top-level keys and `version` of both JSON outputs, run on
   the built CLIs, so a breaking change fails CI until the version is bumped on purpose.
5. **Consumers find xray by path** (a built checkout) until publishing the CLIs to npm is
   decided separately.

## Consequences

+ The agents kit, and later the planned Claude skill, can depend on xray without reaching into
  its internals; xray stays free to restructure everything behind the JSON.
+ The Action is unaffected: no new dependency, so P6 does not apply.
− Every change to a result field now needs a moment's thought about consumers.
− Until the CLIs are on npm, a consumer depends on a local checkout being present and built.
