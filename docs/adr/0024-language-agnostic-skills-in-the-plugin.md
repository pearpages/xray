# 0024. The plugin hosts language-agnostic skills: onboard and check-diagrams

- **Date:** 2026-11-06
- **Status:** Accepted — chosen by the owner, question by question, on 2026-11-06
- **Supersedes:** the "skills stay outside xray" part of [0023](0023-data-for-other-skills.md)

## Context

ADR-0023 kept the owner's global skills outside xray, using xray's data when it is there. The owner
then asked to move `/onboard` (tour a project, map it, explain its hard parts) into xray while
keeping it usable on any language. Two things stood in the way:

- `/onboard` read the owner's personal files for its drawing rules: the global `diagram` skill and
  a blog writing guide. Nobody else who installs the plugin has them.
- Code maps (diagrams of how a codebase fits together) go stale silently, and nothing checked them.
  The pointer in AGENTS.md that went stale after #6 is one example.

The alternatives were:

1. Keep everything global (ADR-0023 as it was). Nobody else gets `/onboard`.
2. Move `diagram` and the writing guide into xray too. One copy of each rule, but xray would carry
   a general diagram tool and the owner's blogging rules for every user.
3. Split by job: code maps, the part that benefits from xray's data, move into xray; every other
   kind of diagram stays in the owner's global `diagram` skill. This is the decision.
4. Ship the onboard skill as its own plugin in this repository. Its command would read
   `/onboard:onboard`, and it would still need to find xray on disk.

## Decision

- **`/xray:onboard`** joins the plugin, with its hotspot script
  (`skills/onboard/scripts/hotspots.mjs`). On TypeScript/JavaScript it uses `xray.sh quality`
  (hotspots, import graph, feature boundaries) through `${CLAUDE_PLUGIN_ROOT}`; on any other
  language it uses the script and says so. It writes only `docs/onboarding/`.
- **`/xray:check-diagrams`** is new: it checks the code maps in a repository's Markdown against
  the code, and edits a diagram only after the user agrees.
  - `skills/check-diagrams/scripts/diagram-refs.mjs` (no dependencies, any language) finds the
    files and folders each Mermaid flowchart names and resolves them with `git ls-files`.
  - With `xray-quality -f graph` it also checks every arrow against the imports.
  - Accepted ADRs and `docs/onboarding/` are never edited.
- **`plugins/xray/references/code-maps.md`** holds the plugin's own drawing rules for code maps
  and hotspot diagrams. The owner's global `diagram` skill keeps the other diagram kinds and
  points to these skills for code maps. A few general lines (draw top to bottom, one node per
  thing) exist in both, because a public plugin can't read personal files.
- `xray.sh quality` and `-f graph` keep the contract of ADR-0023 for anything outside the plugin.
- The plugin's scripts are tested with the rest of the suite (`plugins/*/skills/*/scripts/*.test.mjs`).

## Consequences

- (+) Anyone who installs the plugin gets the tour and the diagram check, in any language, and
  exact numbers on TypeScript/JavaScript.
- (+) Each code-map rule lives in one place, and stale code maps now have a check.
- (−) The plugin is no longer only about TypeScript/React PRs; the README says which skills work
  on any language.
- (−) The few general drawing lines kept in both places can drift apart.
