# 0023. xray supplies data to other skills: `xray.sh quality` and `-f graph`

- **Date:** 2026-11-05
- **Status:** Accepted; its "skills stay outside xray" part superseded by [0024](0024-language-agnostic-skills-in-the-plugin.md)

## Context

The owner's global Claude Code skills work on any repository and any language. Two of them need
data xray already computes, but get it by approximation:

- `/understand` ranks hotspots with indentation depth as complexity and import lines found with
  grep as fan-in. `xray-quality --only hotspots` measures churn × cyclomatic complexity exactly.
- `/diagram` draws a project's components from grep. xray resolves the real import graph
  (`buildDependencyGraph`: aliases, workspaces, per-package tsconfigs), but no output contains it:
  the architecture metric reports only violations.

The alternatives were:

1. Move those skills into the xray plugin. That would limit them to TypeScript/React projects and
   tie the plugin to the quality tool.
2. Keep them global and have xray supply the data, which is this decision.
3. Have the skills import `@xray/core` as a library. That would need an install in every
   repository they run on, and ADR-0019 says nothing but the agent types is a supported import.

## Decision

- **The skills stay outside xray.** They use xray when the repository is TypeScript/JavaScript
  and xray is available, and fall back to their own scripts otherwise. xray doesn't know they
  exist; the dependency points one way.
- **`xray.sh <data-dir> quality <args…>`** runs `xray-quality` from the plugin's clone. The
  clone already builds `packages/quality` (root `npm run build`) and follows `v0`, so it adds no
  install. A global skill finds the script in that clone,
  `~/.claude/plugins/data/xray-xray/xray/plugins/xray/scripts/xray.sh`, and passes
  `~/.claude/plugins/data/xray-xray` as the data dir.
- **`xray-quality -f graph`** prints the whole repository's import graph and runs no metric:

  ```json
  { "version": 1, "tool": "xray-quality", "commit": "…",
    "modules": ["src/a.ts", "src/b.ts"],
    "edges": [{ "from": "src/a.ts", "to": "src/b.ts", "typeOnly": false, "dynamic": false }] }
  ```

  Paths are repo-relative POSIX (principle P4); `modules` is sorted; external packages appear as
  edge targets (package names) only when `dependencies.includeExternal` is on. The contract rules
  of [ADR-0019](0019-json-output-contract.md) apply: `version` changes only when a field is
  removed, renamed or changes meaning.

## Consequences

- (+) The skills get exact complexity, churn and imports on the repositories xray understands.
- (+) No new package, dependency or install: one shell branch and one output format.
- (−) A third versioned JSON output to keep stable.
- (−) The skills depend on the plugin's data folder path, which is Claude Code's layout, not
  xray's. When it moves, they fall back to their own scripts.
