---
name: features
description: Create or update xray's feature map (xray.features.json), which names a project's user-facing features for the Interactions section of xray PR reports. Use when asked to create, update or fix the feature map, when an xray report says the map is missing, or when it lists changed code not in the feature map.
argument-hint: "[project root, default: current directory]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/xray.sh *) Read Grep Glob
---

# xray feature map

`xray.features.json` tells xray which **features** a product has, so a PR report says "Cart" or
"Finances" instead of `CartPage` or `useGame`. A feature is something a user can do, named the way
the team talks about it. xray reads the map; this skill writes it and the team reviews it like code.

## Run xray

xray runs from a cached build. The first call clones and builds it, which takes about a minute:

```bash
"${CLAUDE_SKILL_DIR}/scripts/xray.sh" "${CLAUDE_PLUGIN_DATA}" --inventory -C <root>
```

It prints the **inventory** as JSON:

- `candidates`: units where a feature can start, each `{ id: "path#name", reasons, callers }`.
  Reasons: `entry-glob` (pages, routes, screens, `main`), `unused-export` (exported, nothing in the
  code uses it: often a root, sometimes dead code), `hub` (used by many units: a store, a layout).
- `packages`: workspace packages, when the root is a monorepo.
- `featureMap`: `missing`, `found` (with the map), or `invalid` (with the error).
- `unknownEntryPoints`: map entry points that no longer exist in the code.
- `uncovered`: `entry-glob` candidates no feature claims.

## Steps

1. **Find the root.** It is the folder the xray Action analyses: the repository root, or its
   `working-directory`. In a monorepo it is the workspace root. Use the argument when given.
   Done when `<root>` has a `package.json` and the inventory command succeeds there.
2. **Take the inventory** with the command above. Done when you have its JSON.
3. **Understand each candidate.** Read every `entry-glob` candidate's file, and the `hub` and
   `unused-export` candidates that look like screens, routes or app roots. Learn what the user sees
   and does there: titles, buttons, routes, the text it renders. Read the README and any product
   docs for the words the team uses. Done when you can say, for every `entry-glob` candidate, which
   user task it serves.
4. **Group into features.** One feature per user task, not per component: a page and its modal
   for the same task are one feature; a page that serves two tasks may start two. For each:
   - `id`: kebab-case, stable. On an update, keep every existing id.
   - `name`: two or three words in the team's language (the language of the UI and README).
   - `description`: one sentence on what the user can do.
   - `entryPoints`: candidate ids copied exactly from the inventory.
   - `files` (optional): narrow globs for code that belongs only to this feature but is reached
     from no entry point, e.g. `src/checkout/**`.
   Leave out what isn't a feature: dev tools, test helpers, dead code. Done when every
   `entry-glob` candidate is in a feature or on your list of omissions with a reason.
5. **On an update**, start from the existing map: keep its ids, names and descriptions (people
   may have edited them), replace each `unknownEntryPoints` entry with the unit it was renamed to
   or drop it, and place every `uncovered` candidate. Done when both lists are handled.
6. **Write `<root>/xray.features.json`**:

   ```json
   {
     "version": 1,
     "features": [
       {
         "id": "cart",
         "name": "Cart",
         "description": "See and pay for what you added",
         "entryPoints": ["src/pages/Cart.tsx#Cart"],
         "files": ["src/cart/**"]
       }
     ]
   }
   ```

7. **Check it** by taking the inventory again. Done when `featureMap.status` is `found`,
   `unknownEntryPoints` is empty, and every id in `uncovered` is one of your reasoned omissions.
8. **Report** to the user: a table of features (name, description, entry points), what changed if
   this was an update, and the omissions with their reasons. The map is theirs to review and
   commit.
