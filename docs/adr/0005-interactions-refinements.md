# 0005. Interactions: lookup tables, hubs and shallower callees

- **Date:** 2026-11-01
- **Status:** Accepted
- **Amends:** [0004](0004-interactions-analysis.md) (the rest of it stands)

## Context

Building ADR-0004 and running it on futbol-manager (commit 15d1220, four changed functions in
`packages/domain`, 153 files across four workspace packages) showed three things ADR-0004 didn't
plan for:

1. **Lookup tables.** `const SCREENS = { player: PlayerScreen }` is an object, not a function, so
   it wasn't a unit; nothing linked a screen to the `App` that mounts it through the table.
2. **Hubs.** All four changes reach the app through `useGame`, the store hook about 25 screens use.
   Following every caller produced **37 features** that differ only in which screen sits on top.
3. **Callees.** Two levels down from four functions put **32 participants** in one diagram.

## Decision

- **Top-level object and array literals are units** (`kind: "table"`). They appear on the way up
  (`App -reads-> SCREENS -mounts-> Account`), never on the way down, where they are just data. A new
  relation, `reads`, marks code using a table as a value, so the arrow doesn't claim the table is
  mounted. A changed table (`SYMBOLS = { EUR: "€" }`) counts as a touched unit.
- **Without a feature map, the walk stops at hubs**: a unit with more than `interactions.hubCallers`
  (default 8) callers becomes the root, shown once as "`useGame` (shared by 25)" with the list of
  its users. With a map the walk goes through hubs, because the map already bounds the features.
- **One level of callees by default** (`interactions.depthDown`, was 2; the spec allows 1–2) and at
  most `interactions.maxCallees` (default 6) per unit, the rest counted in the diagram
  ("and 12 more").

## Consequences

+ futbol-manager's report goes from 37 features and 19 KB to 3 features and 7 KB, and the shared
  path (`useGame → reduce → startNewSeason → rolloverSeason`) is visible once.
+ Route tables and screen registries connect screens to their app, which is how many apps mount them.
− Without a map, a hub hides which screens sit above it beyond the "used by" list; the feature map is
  the way to see per-feature paths through a hub.
− One level down shows less of what a change calls; teams that want more set `depthDown: 2`.
− Tables add units for every top-level object/array; they only show up when they are on a path.
