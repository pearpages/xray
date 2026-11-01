# Principles

Every change to this repository, whether code, docs, tests or process, complies with these
rules. When a change would break one, stop and ask the user instead of working around it.
Changing a principle is itself a decision: it needs the user's agreement and an ADR
([decisions.md](decisions.md)). How things are built is in
[architecture.md](architecture.md); security rules in [security.md](security.md).

Each rule has a **Why**, and a **Check** where something enforces it (a test, lint rule,
CI step, hook).

## Core

**P1. `packages/core` knows nothing about GitHub or the CLI.** It takes a repo path and a base
branch and returns data (`XrayResult`); it never reads `process.argv`, `GITHUB_*` variables or
calls the GitHub API.
*Why:* the core will be reused by a project-quality tool that is neither a CLI nor an Action.
*Check:* `packages/core/package.json` does not depend on `@xray/cli` or `@xray/action`; review.

**P2. Analysis and rendering are separate.** Each analysis returns a typed result
(`DependencyAnalysis`, …) and a separate renderer turns it into Markdown; the JSON output
(`--format json`) carries every analysis result.
*Why:* consumers other than the PR comment (the quality tool, the planned Claude skill) need the
data, not the prose. *Check:* review; `analyze.ts` / `render.ts` split per analysis.

**P3. One analysis is one report section.** A new analysis adds a module under
`packages/core/src/<analysis>/`, a field in `XrayResult` and one entry in `reportSections()`.
*Why:* the comment is read section by section and the spec maps each analysis to one section.
*Check:* review.

**P4. Paths in results are repo-relative POSIX paths, whatever the process cwd.**
*Why:* dependency-cruiser mixes `baseDir`-relative and cwd-relative paths; mixing them split one
file into two nodes and lost its dependents. *Check:* the git-fixture test in
`packages/core/src/dependencies/analyze.test.ts` runs with a cwd that is not the analysed repo.

## Tests

**P5. Analyses are tested against a real temporary git repository**, built in the test, not
against mocked git or mocked dependency-cruiser output.
*Why:* the bugs so far came from how git and dependency-cruiser actually behave (merge base,
path resolution, tsconfig aliases). *Check:* `analyze.test.ts`; `npm test -- --run` in CI.

## Action

**P6. Every new analysis re-measures the Action on pearpages/dummy before it ships.** Compare
the install + build time and the whole job time with the figures in ADR-0003; a noticeable jump
reopens that decision (bundling, or trimming dependencies) instead of being accepted silently.
*Why:* the Action rebuilds xray on every PR in every consumer repo, so each new dependency is
paid many times. [ADR-0003](docs/adr/0003-action-builds-at-runtime.md) *Check:* review; the
measurement goes in the analysis's Done line in tasks.md.

## Process

**P7. Knowledge lives in its file.** How to work → `AGENTS.md`; rules → here; how it is
built → `architecture.md`; why → an ADR; work → `tasks.md`; risk → `security.md`.
*Why:* a session log in the agent file hides decisions from the next person.
[ADR-0001](docs/adr/0001-project-knowledge-files.md)
