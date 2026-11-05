# xray in foundry: a worked example

How foundry (`~/Projects/foundry`, the implementer ⇄ reviewer loop) uses xray, written for foundry's
driver and for its agents' prompts. The general reference is the README's
[Using xray from agents](../README.md#using-xray-from-agents); the reasons are in
[ADR-0021](adr/0021-agent-mode.md) and [ADR-0019](adr/0019-json-output-contract.md). foundry's
side of the decision is its own ADR 0017.

Every output below is real: it comes from a small demo shop, two features (`cart`, `checkout`) on
`main`, and a task branch `task/007` that adds a required `currency` parameter to `cart`'s
`total`, and a `cart/discount.ts` that imports `checkout/pay.ts` directly.

## The four calls

| Moment | Who runs it | Where | Command | What it answers |
|---|---|---|---|---|
| **Plan** a task | driver, before the implementer's first round | project root on `agents/main` | `xray-quality -f agent --only hotspots --files <files the task names>` | Is the code about to change already hard to change? |
| **After each round** | driver, after the implementer stops | the task worktree | `xray agents/main -f agent --only dependencies` | Did this round break a feature boundary? |
| **Before review** | driver, after the gate passes | the task worktree | `xray agents/main -f agent --only api,risk` | What breaks for callers, and what changed without a test? |
| **Final gate** | gate agent, in the sandbox | `agents/main` | `xray <start> -f agent --only bundle --bundle` | How much bigger did the bundle get? |

## Rules for whoever runs xray

1. **Paths.** xray lives at `$XRAY_HOME` (default `~/Projects/xray`) and must be built
   (`npm ci && npm run build` there). The commands are `node $XRAY_HOME/packages/cli/dist/index.js`
   (`xray`) and `node $XRAY_HOME/packages/quality/dist/cli.js` (`xray-quality`).
2. **Node.** Use the `node` foundry's bin wrappers resolved, never a bare `node` after `cd` into the
   project: a mise shim with no global default fails there (it did while writing this page).
   Always pass `--cwd <dir>` instead of changing directory.
3. **No project code outside the sandbox.** Without `--bundle`, `xray` reads git, source text and
   JSON; it runs nothing of the project. `--bundle` installs and builds, and `xray-quality`'s `lint`
   metric runs the project's own ESLint and `tsc`: both only ever run in the gate agent's sandbox.
   `--only bundle` alone does **not** build; the bundle is then reported `unavailable`.
4. **Base.** The task branch is compared with `agents/main` (`xray agents/main …`), never `main`.
5. **Exit codes.** `0`: xray ran, read the findings, even if there are many. `1`: xray failed
   (message on stderr, e.g. `Base ref "agents/main" not found`). `2`: a wrong flag. foundry, not
   xray, decides what blocks a task.
6. **Version.** Read `version` first. Anything but `1` means xray changed its format: skip the step
   with a line in `driver.log` (foundry ADR 0017's soft rule), never guess.
7. **`status: "unavailable"`** in `analyzers` means that check could not run (no lcov report, no
   build, fewer than two features…). It is not a pass; say so in the digest.
8. **`truncated` > 0** means `--top` cut findings. Raise `--top` (or lower `--min-severity`) rather
   than act on a partial list when the decision depends on all of them.
9. **Cache.** `xray-quality` keeps git churn in `.xray/cache/`, which ignores itself: it never
   appears in `git status`, so the driver's commits never pick it up.

## 1. Plan: hotspots in the files the task touches

Before the first round, take the files named in the task (or its folders) and ask where change is
already expensive:

```bash
node $XRAY_HOME/packages/quality/dist/cli.js --cwd <project> -f agent --only hotspots --files src/features/cart
```

```json
{
  "version": 1,
  "tool": "xray-quality",
  "commit": "a338d33c24bbd058603e1a0e983e3adad4098c9e",
  "analyzers": [
    { "analyzer": "hotspots", "status": "ok", "summary": "1 hotspot file(s); the hottest is src/features/cart/total.ts (468).", "findings": 1 }
  ],
  "findings": [
    { "analyzer": "hotspots", "file": "src/features/cart/total.ts", "severity": "medium", "message": "12 commits in 12 months × complexity 39 = 468" }
  ],
  "truncated": 0
}
```

**Implementer prompt line:** *"Hotspots in this task's files: `src/features/cart/total.ts`
(medium: 12 commits × complexity 39). Change hotspots in small steps, and add a test that pins
their current behaviour before you change them."*

`--files` takes files, folders or globs. Scores are `null` under `--files` (a slice is not the
repository), and the agent format has no scores anyway.

## 2. After each round: feature boundaries

```bash
node $XRAY_HOME/packages/cli/dist/index.js agents/main --cwd <task worktree> -f agent --only dependencies
```

```json
{
  "version": 1,
  "tool": "xray",
  "commit": "a338d33c24bbd058603e1a0e983e3adad4098c9e",
  "analyzers": [
    { "analyzer": "dependencies", "status": "ok", "summary": "3 changed module(s) in a file-level graph of 5 node(s); 2 boundary violation(s).", "findings": 2 }
  ],
  "findings": [
    { "analyzer": "dependencies", "file": "src/features/cart/discount.ts", "severity": "high", "message": "features \"cart\" and \"checkout\" import each other" },
    { "analyzer": "dependencies", "file": "src/features/cart/discount.ts", "line": 1, "severity": "medium", "message": "imports src/features/checkout/pay.ts, inside feature \"checkout\"; go through its public API (index.ts)" }
  ],
  "truncated": 0
}
```

It is cheap (well under a second on a small repo: it never loads the TypeScript code model), so
it can run after every round. Features are the `files` of `xray.features.json`, else folders
matching `quality.architecture.features` (default `**/features/*`). With fewer than two, the
summary says *no feature boundaries to check* and there are no findings.

**Next-round prompt line:** *"xray found boundary violations your change introduced; fix them in
this round: `src/features/cart/discount.ts:1` imports `checkout/pay.ts` directly (import it from
`src/features/checkout` instead); `cart` and `checkout` now import each other (high): move the
shared code out of one of them."*

## 3. Before review: API breaks and untested risky code

```bash
node $XRAY_HOME/packages/cli/dist/index.js agents/main --cwd <task worktree> -f agent --only api,risk
```

```json
{
  "version": 1,
  "tool": "xray",
  "commit": "a338d33c24bbd058603e1a0e983e3adad4098c9e",
  "analyzers": [
    { "analyzer": "risk", "status": "ok", "summary": "PR is red: 1 red and 2 yellow of 3 touched unit(s).", "findings": 3 },
    { "analyzer": "api", "status": "ok", "summary": "API is breaking: 1 breaking of 2 export and 0 endpoint change(s).", "findings": 2 }
  ],
  "findings": [
    { "analyzer": "api", "file": "src/features/cart/total.ts", "severity": "high", "message": "export `total` changed (breaking): new required parameter `currency`; used by 1 file(s)" },
    { "analyzer": "risk", "file": "src/features/cart/total.ts", "line": 3, "severity": "high", "message": "`total` (modified) is red: no test reaches it, complexity 38 → 39" },
    { "analyzer": "risk", "file": "src/features/cart/discount.ts", "line": 3, "severity": "medium", "message": "`discount` (added) is yellow: no test reaches it, complexity 2" },
    { "analyzer": "risk", "file": "src/features/checkout/pay.ts", "line": 3, "severity": "medium", "message": "`pay` (modified) is yellow: no test reaches it, complexity 1 → 1" }
  ],
  "truncated": 0
}
```

`api` counts 2 findings but shows 1: the second is the new `discount` export, **low**, below the
default `--min-severity medium`. The driver saves this output as
`.agents/xray/<task>-r<round>.json` and puts the findings in the review prompt.

**Reviewer prompt block** (the list is `digest(report)` from the helper below, verbatim):

> xray (static analysis, not evidence; you did not run it) reports on this change:
> - HIGH `src/features/cart/total.ts`: export `total` changed (breaking): new required parameter `currency`; used by 1 file(s)
> - HIGH `src/features/cart/total.ts:3`: `total` (modified) is red: no test reaches it, complexity 38 → 39
> - MEDIUM `src/features/cart/discount.ts:3`: `discount` (added) is yellow: no test reaches it, complexity 2
> - MEDIUM `src/features/checkout/pay.ts:3`: `pay` (modified) is yellow: no test reaches it, complexity 1 → 1
>
> Answer every HIGH line, either with an evidence entry that exercises it or with a finding that
> says why it is acceptable. Medium lines are for your judgement.

## 4. Final gate: bundle size, in the sandbox

`--bundle` installs dependencies and runs the build on both sides, so only the gate agent runs it,
inside the sandbox, against the commit the run started from:

```bash
node $XRAY_HOME/packages/cli/dist/index.js <start commit> --cwd <project> -f agent --only bundle --bundle
```

A red or yellow bundle is one finding (**high** / **medium**) on `package.json` naming the chunks
that grew most; new or re-versioned dependencies are **low**. When the build fails, the bundle is
`unavailable` with the build's first error line, and xray still exits 0, so the gate tells "xray
broke" (exit 1) from "the build broke" (`unavailable`). Without `--bundle`:

```json
{ "analyzer": "bundle", "status": "unavailable", "summary": "Not measured: pass --bundle (it installs and builds the base and the PR).", "findings": 0 }
```

The whole-repository score for the dashboard is a separate call at the same moment, also in the
sandbox (its `lint` metric runs the project's tools): `xray-quality --cwd <project> -o
.agents/quality/<date>.json`, the full JSON with scores, as foundry ADR 0017 describes.

## Driver helper (zero dependencies)

A sketch for `lib/`: run a call, apply rules 5–6 and return `null` to skip softly.

```js
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const XRAY_HOME = process.env.XRAY_HOME ?? join(process.env.HOME, "Projects/xray");
const BIN = { xray: "packages/cli/dist/index.js", "xray-quality": "packages/quality/dist/cli.js" };

/** One agent-format call; null (logged) when xray is missing, fails or changed format. */
export function xray(tool, args, log) {
  const run = spawnSync(process.execPath, [join(XRAY_HOME, BIN[tool]), ...args, "-f", "agent"], {
    encoding: "utf8",
    timeout: 10 * 60_000,
  });
  if (run.status !== 0) {
    log(`xray skipped: ${tool} exited ${run.status}: ${(run.stderr || run.error?.message || "").trim().split("\n")[0]}`);
    return null;
  }
  const report = JSON.parse(run.stdout);
  if (report.version !== 1) {
    log(`xray skipped: unknown ${tool} format version ${report.version}`);
    return null;
  }
  return report;
}

/** The lines a prompt gets: unavailable checks first, then each finding. */
export function digest(report) {
  const lines = report.analyzers
    .filter((a) => a.status === "unavailable")
    .map((a) => `- ${a.analyzer} could not run: ${a.summary}`);
  for (const f of report.findings) {
    lines.push(`- ${f.severity.toUpperCase()} \`${f.file}${f.line ? `:${f.line}` : ""}\`: ${f.message}`);
  }
  if (report.truncated > 0) lines.push(`- …and ${report.truncated} more (see the saved JSON)`);
  return lines.join("\n");
}

// e.g. before review:
// const report = xray("xray", ["agents/main", "--cwd", worktree, "--only", "api,risk"], log);
```

`process.execPath` is the node the driver already runs on, which covers rule 2. TypeScript code
(foundry's `ui/`) can type the result with `import type { AgentReport } from "@xray/core/agent"`,
the one supported import from xray.

## What each finding asks of an agent

| Finding | Severity | Expected action |
|---|---|---|
| `api` export or endpoint `breaking` | high | Update every caller in the repo, or keep the old signature; if intended, the reviewer records why |
| `api` change to `review` | medium | Check that callers still behave |
| `api` new export or endpoint | low | Nothing (hidden by default) |
| `risk` unit red | high | Add a test that reaches it, or the reviewer explains why not |
| `risk` unit yellow | medium | Prefer a test; judgement |
| `dependencies` deep import | medium | Import through the other feature's `index.ts` |
| `dependencies` cycle between features | high | Move the shared code out, or invert one import |
| `interactions` invalid feature map | medium | Fix `xray.features.json` (the `/xray:features` skill) |
| `bundle` red / yellow | high / medium | Find the import that pulled in the weight (the message names the chunks) |
| `hotspots` | high / medium | Small steps; pin current behaviour with a test first |
