# xray

xray analyses pull requests in TypeScript/React projects. It compares the current branch with the
base branch and produces a Markdown report with Mermaid diagrams, one section per analysis. A GitHub
Action publishes that report as a single PR comment and updates it on every push. It is an npm
workspaces monorepo: a reusable analysis core (`packages/core`), a single-command CLI
(`packages/cli`) and the Action glue (`packages/action` + `action.yml`). The core will also be used
by a future project-quality tool, so it returns data, not just Markdown.

## Project documents — read before working

| File | Holds |
|---|---|
| [principles.md](principles.md) | The rules every change must follow |
| [architecture.md](architecture.md) | How the project is built: modules, data flow, build, deploy |
| [decisions.md](decisions.md) | Index of ADRs in `docs/adr/`: why each choice was made |
| [Issues](https://github.com/pearpages/xray/issues) | Open work, also on the [Backlog](https://github.com/users/pearpages/projects/3) board. Closed issues and git are the record of what was done |
| [security.md](security.md) | Threat surface, secrets, dependency policy, how to report a vulnerability |
| [LICENSE](LICENSE) | MIT |

[README.md](README.md) is the user-facing entry point.

Knowledge standard: craft v2 (`/craft:scaffold check` upgrades it)

## Working rules

1. **Read `principles.md` before changing code or docs.** If a change would break a
   principle, stop and ask; don't work around it.
2. **Work is tracked in GitHub Issues**, not in a file. New work → `gh issue create` with
   `type:*`, `priority:*` and `area:*` labels. Finished work → close the issue from the commit
   or PR (`Fixes #N`).
3. **A structural or behavioural change updates `architecture.md` in the same commit**, and
   the README too when users can see it.
4. **A choice between real alternatives** (API shape, dependency, convention, process) gets
   a new ADR in `docs/adr/` plus a line in `decisions.md`. Propose it to the user before
   marking it Accepted. Never edit an accepted ADR; supersede it with a new one.
5. **Anything touching auth, secrets, input handling or dependencies is checked against
   `security.md`**, and updates it when the surface changes.
6. **At the end of a session, outcomes go to those files, not here.** This file keeps only
   how to work and pointers — never a session log.
7. Confirm before anything outward-facing: pushes, releases, publishing, deploys.

## Development commands

Node 24 is pinned in `mise.toml` (`mise exec -- <cmd>` if the shell has no default Node).

- `npm ci`: install all workspaces.
- `npm run build`: `tsc -b` over core, cli and action (outputs to each `packages/*/dist`).
- `npm test -- --run`: run the vitest suite once. Never plain `npm test`, which starts watch mode.
  Tests in `packages/action` import `@xray/core` from `dist`, and the `xray-quality` CLI tests run
  `packages/quality/dist/cli.js`, so build first. UI component tests run in jsdom
  (`// @vitest-environment jsdom` at the top of the file).
- `npm run coverage`: the suite with v8 coverage; it fails under the floor in `vitest.config.ts`
  (CI runs this).
- `node packages/cli/dist/index.js <base> --cwd <repo>`: run the CLI against another repository
  (`-f json` for the raw `XrayResult`, `--bundle` to build and compare bundles, `--inventory` for
  the feature map skill's data).
- `node packages/quality/dist/cli.js --cwd <repo> -o <file>`: the whole-repository quality report.
- `npm run ui` (= `npm run dev -w @xray/quality-ui`) / `npm run build -w @xray/quality-ui`: the report viewer. The
  Action never installs it (`build:action`, ADR-0014), nor the root's dev dependencies: a tool only
  tests need goes in a workspace's `devDependencies` (`@vitest/coverage-v8` and `eslint` are in
  `@xray/quality`'s), never the root's (ADR-0016).
- Release, after merging to `main` with CI green
  ([ADR-0010](docs/adr/0010-versioning-and-releases.md)):
  `git tag -a vX.Y.Z -m "vX.Y.Z" && git tag -f v0 vX.Y.Z && git push origin vX.Y.Z && git push -f origin v0`,
  then `gh release create vX.Y.Z --title vX.Y.Z --notes-file <notes>` with notes for users
  ([ADR-0026](docs/adr/0026-release-notes-on-github-releases.md)); `/craft:release` does both.

## Pitfalls that have bitten before

- dependency-cruiser finds no `.ts` modules (empty result) → it only accepts `typescript` `<7` →
  keep `typescript` on 6.x ([ADR-0002](docs/adr/0002-typescript-6-for-dependency-cruiser.md)).
- Graph paths come out as `../../private/var/…` and dependents go missing when `--cwd` is not the
  process cwd → dependency-cruiser reports `resolved` relative to the process cwd, not `baseDir` →
  every path goes through `repoPathResolver` in `packages/core/src/dependencies/graph.ts`.
