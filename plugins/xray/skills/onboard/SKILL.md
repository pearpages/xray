---
name: onboard
description: Tour an unfamiliar project, in any language, and surface its complicated parts. Use when asked to understand, get onboarded to, tour or map a project or a folder of it, to find the hard, risky or complicated parts or hotspots of a codebase, or on /xray:onboard. Draws only the code maps the evidence earns, ranks hotspot candidates (xray's exact churn × complexity on TypeScript/JavaScript, a bundled script elsewhere), reads the top ones to judge what is actually hard, and writes docs/onboarding/ — an overview, one page per hotspot, and an ordered reading path. Source code is never modified.
argument-hint: "[path] [quick|deep|hotspots]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/xray.sh *) Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/hotspots.mjs *) Bash(git log *) Bash(git ls-files *) Bash(git rev-parse *) Read Grep Glob Write Edit Agent
---

# Onboard: tour a project and find its hard parts

Help someone become productive in a codebase they don't know. A good result lets a new developer
answer three questions in ten minutes: **what is this, how is it put together, and where will it
bite me?** Every diagram answers **one specific question**, never a "complete architecture".

This skill works on **any language**. On a TypeScript/JavaScript repository it uses xray's exact
measurements; elsewhere it uses its own script, and says so.

**Scope:** read-only on source code. Writes only under `docs/onboarding/`. It explains the
hotspots it finds; it doesn't refactor, fix or review them, and it never invents components the
repository doesn't show.

## Step 0: parse the mode

`/xray:onboard [path] [quick|deep|hotspots]`, arguments in any order, all optional.

| Argument | Effect |
|---|---|
| *(none)* | Whole repository, `quick`. |
| `path` | Every step scoped to that folder (a feature, a package, one app of a monorepo). |
| `quick` | One pass, top 3 hotspots. The default. |
| `deep` | One Explore subagent per top-level area or deployable, findings merged, top 5 hotspots. Only worth it on large repositories and monorepos; say so when the repository is small. |
| `hotspots` | Skip Step 2 (the map), for a project the user already knows. |

## Step 1: orient, and check for xray

Read what exists before deriving anything: README, `docs/`, ADRs, `CLAUDE.md`/`AGENTS.md`,
package manifests, top-level folders and entry points, CI and infrastructure, schemas and
migrations. When the repository already has an architecture doc, **link to it and build on it**
instead of repeating it.

Write one short paragraph (what it is, who uses it) and a facts table: stack, entry points, how
to run it, how to test it, where config and secrets come from.

**xray's data** applies when most code files are `.ts`/`.tsx`/`.js`/`.jsx`. Check once:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/xray.sh" "${CLAUDE_PLUGIN_DATA}" quality --help
```

It prints `Usage: xray-quality` when it works (the first run builds xray, about a minute). If it
fails, or the repository is another language, carry on without it and list it as an unavailable
signal. Every xray call below takes `-C <repository root>` and prints JSON with `version: 1`; any
other version means the format changed, so don't use it and say why.

## Step 2: map, only the diagrams the repository earns

Read `${CLAUDE_PLUGIN_ROOT}/references/code-maps.md` and follow it: which code map answers which
question, where the evidence comes from, and the drawing rules. Draw only the maps its table
earns. Two more, outside code maps, when the repository shows them:

| Evidence | Question | Diagram |
|---|---|---|
| schemas, migrations, ORM models | How is the data related? | `erDiagram` |
| queues, topics, workers, webhooks | How do async events move? | `flowchart`, events on the edges |

On a TypeScript/JavaScript repository, the C4 Component map's arrows come from
`xray.sh … quality -C <root> -f graph` (`modules`, `edges: { from, to, typeOnly, dynamic }`).

## Step 3: find hotspot candidates

**TypeScript/JavaScript with xray** (a `path` scope becomes `--files <path>`):

- `quality -C <root> --only hotspots`: `metrics[0].data.rows` gives `{ file, churn, complexity,
  hotspot }` per file, hottest first, from git churn × cyclomatic complexity. Rank by it.
- `quality -C <root> -f graph`: fan-in of a file = distinct `from` with that file as `to`,
  type-only edges ignored.
- `quality -C <root> --only architecture`: deep imports and cycles between features are
  candidates in their own right (`status: "unavailable"` with fewer than two features).

Also run the script below, for its `tested` and `markers` signals as tie-breakers.

**Any other language, or without xray:**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/hotspots.mjs" [path] --json --top 25
```

Optional: `--since "6 months ago"` (default 12 months), `--include-tests`. Its score combines git
churn with nesting-weighted size, boosted by fan-in, missing tests and TODO/FIXME markers.
`fanIn` and `tested` are name-based guesses. Read its `notes`: without git history (or in a
shallow clone) the ranking falls back to size only; tell the user.

Either way these are **candidates, not verdicts.** Expect false positives such as icon sets, big
static tables and fixtures, and drop them.

## Step 4: judge and explain

Read the top ~10 candidates. Then look for what numbers can't see, because conceptually hard code
is often small and stable:

- state machines hidden in booleans and nullable fields
- retries, timeouts, idempotency, ordering, concurrency
- caching and invalidation
- auth, permissions, tenancy boundaries
- money, time zones, units
- implicit rules ("this must be called before that"), load-bearing comments, magic values

Keep the top 3 (`quick`) or 5 (`deep`). For each hotspot write:

1. **A title that is a question**: "How does a retry avoid sending the email twice?", never
   "Notification architecture".
2. **Why it is hard**: the numbers, and the real reason (what you read).
3. **What breaks if you touch it wrong.**
4. **The one diagram that explains it**, picked with the hotspot table in `code-maps.md`.
5. **Read this first**: file and symbol, as `path:line`.

## Step 5: reading path

An ordered list of about six files: read these, in this order, to become productive. One line
each on what the reader learns there. Start at an entry point, end at the first hotspot.

## Step 6: write

- `docs/onboarding/README.md`: the orient paragraph and facts table, the maps, a hotspot summary
  table, a `quadrantChart` of the hotspots (x = complexity, y = churn; skip it without churn),
  and the reading path. Say which source ranked the hotspots (xray or the script).
- `docs/onboarding/hotspots/<slug>.md`: one page per hotspot.
- A `path`-scoped run writes `docs/onboarding/<path-slug>.md` instead of the README.
  `hotspots` mode updates only the hotspot table, chart and pages.

Every file starts with `> Generated at <short-sha> on <YYYY-MM-DD> by /xray:onboard`, so a stale
page is easy to spot. Re-runs **update in place**: no `-v2` files, and hotspot pages that no
longer make the cut are deleted. Never touch anything outside `docs/onboarding/`.

## Final report

List the files written, the hotspots in one line each, and every signal that was unavailable.
**Offer**, without doing it, to add a one-line pointer to `docs/onboarding/` in the project's
`CLAUDE.md` or `AGENTS.md`, and to run `/xray:check-diagrams` on the project's own architecture
docs. When something important can't be read from the code (an external flow, a planned design),
ask the user instead of guessing.
