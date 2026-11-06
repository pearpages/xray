---
name: check-diagrams
description: Check that the code-map diagrams in a project's docs (architecture.md, README, docs/) still match the real code, in any language, and offer fixes. Use when asked whether the architecture diagrams are up to date, to check, refresh or fix diagrams after a refactor, a move or a rename, before a release, or on /xray:check-diagrams. Finds every file and folder a Mermaid diagram names and checks it exists; on TypeScript/JavaScript also checks each arrow against xray's real import graph. Reports drift and edits a diagram only after the user agrees.
argument-hint: "[doc or folder, default: every tracked Markdown file]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/xray.sh *) Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/check-diagrams/scripts/diagram-refs.mjs *) Bash(git ls-files *) Bash(git log *) Read Grep Glob Edit
---

# Check that the diagrams still match the code

A code map (a diagram of how a codebase fits together) goes stale silently: a file moves, a
folder splits, an import is dropped, and the picture in `architecture.md` keeps showing the old
shape. This skill finds that drift and offers the fix. It works on **any language**; on
TypeScript/JavaScript it also checks the arrows against the real imports.

**Scope:** reads the repository. Edits only Markdown diagrams, and only after the user agrees to
each change. Never edits accepted ADRs (they are history), and never edits `docs/onboarding/`
(that is `/xray:onboard`'s output: re-run it instead).

## Step 1: the facts

On a TypeScript/JavaScript repository, get xray's import graph first (the first run builds xray,
about a minute; if it fails, carry on without it and say so):

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/xray.sh" "${CLAUDE_PLUGIN_DATA}" quality -C <root> -f graph -o <scratch>/graph.json
```

Then scan the docs (`--files` for one doc or a few; `--graph` only when the step above worked):

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/check-diagrams/scripts/diagram-refs.mjs" <root> [--files <doc>…] [--graph <scratch>/graph.json]
```

It reads every Mermaid flowchart in tracked Markdown (ADRs skipped) and prints JSON with
`version: 1`. Per diagram:

| Field | Means |
|---|---|
| `refs[]` | Each file or folder a node label names: `status` `ok` (with its `path`), `missing`, `ambiguous` (with `candidates`) or `glob`. A node inside a subgraph is resolved relative to the subgraph's folder first. |
| `edges[].imports` | With a graph: `yes`, `type-only` (only type imports), `no` (no import at all), or `n/a` (an end isn't code, or one end contains the other). |
| `importsNotDrawn[]` | Pairs of nodes with real imports between them and no arrow, with the import count. |
| `notShown[]` | For a subgraph that maps a folder: the folder's code files and subfolders no node shows (tests, stories and fixtures left out). |

`summary` totals them. Other diagram kinds (sequence, state…) come back `checked: false`: they
are about behaviour, which this skill doesn't check.

## Step 2: judge

The script reports facts; you decide which ones are drift. Read the diagram, its heading and the
prose around it, and check what changed with `git log --oneline -- <path>`.

- **`missing`**: a real drift when the file was moved, renamed or deleted (find its new place
  with `git log --diff-filter=R --summary` or by name). Not drift when the label names something
  outside the repository on purpose: a config file in the analysed project, a URL, a concept.
- **`ambiguous`**: read the context to pick the candidate; the label should then name a longer
  path.
- **`edges.imports: "no"`**: drift when the dependency was removed. Not drift when the arrow
  means something other than an import (a runtime call over HTTP, "writes", "deploys"): suggest
  a label on that arrow instead.
- **`type-only`**: usually fine; mention it only when the diagram's point is runtime coupling.
- **`importsNotDrawn`**: a map leaves things out on purpose. Flag only the strong ones (many
  imports) and the surprising ones: a cycle (A imports B and B imports A), or a dependency
  pointing the wrong way for the design the docs describe.
- **`notShown`**: flag parts the reader needs to understand the map (a new module, a new
  package), not every helper file.

Also check the drawing against `${CLAUDE_PLUGIN_ROOT}/references/code-maps.md` (one question per
diagram, top to bottom over about four nodes, one node per real thing), but list those as
suggestions, separate from drift.

## Step 3: report, then fix on a yes

Report per diagram (`file:line`, the heading it sits under): drift first, each with what changed
and the proposed edit, then suggestions. When nothing drifted, say so in one line, with how many
diagrams and references were checked and whether the arrows were checked (graph or not).

Ask before changing anything, one diagram at a time. On a yes, edit only that Mermaid block (and
its one-line description when the change makes it wrong), keep its node ids, and re-run the scan
on that file to confirm the drift is gone. Don't commit.
