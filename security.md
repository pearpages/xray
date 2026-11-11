# Security

The security surface of xray and the rules that protect it. General rules are in
[principles.md](principles.md); how the pieces fit in [architecture.md](architecture.md).
Update this file whenever the surface changes (new input, endpoint, secret, dependency,
permission).

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the **Report a vulnerability** button in the
[Security tab](https://github.com/pearpages/xray/security) of pearpages/xray. Only the maintainer
sees the report. Never open a public issue for an unfixed vulnerability.

## Surface

- **Input is untrusted PR content.** xray reads the PR's files, paths and `tsconfig.json`, but only
  parses them statically (git, dependency-cruiser, ts-morph). It never runs the analysed project's
  code, scripts or package installs, **except in the opt-in bundle analysis** (next item). Base
  versions of files are read with `git show`, not checked out. Test evidence for analysis 3 comes
  from reading test files, never from running them. Workspace `package.json` files and
  `pnpm-workspace.yaml` are read as data (JSON, and a minimal line parser for the YAML). Any new
  analysis that executes the project must be reviewed here first, as the bundle analysis was.
- **Bundle analysis runs PR code (opt-in).** With `--bundle` / `bundle: "true"`, xray installs the
  project's dependencies (their install scripts run) and runs its build, on the base and on the PR,
  in throwaway git worktrees ([ADR-0009](docs/adr/0009-bundle-size-analysis.md)). That is the same
  exposure as the project's own CI. Rules: enable it only on `pull_request` (never
  `pull_request_target`); check out with `persist-credentials: false` so the build can't read the
  checkout's token; the GitHub token is only given to the comment step, after the builds.
- **The quality tool** (`xray-quality`) reads the analysed repository: git, file contents, lcov
  reports, and its package manager's `audit` and `outdated`, which contact the registry and don't
  install or change anything. It also runs the repository's **own** ESLint and `tsc --noEmit` from
  its `node_modules`: ESLint configs are code, so this is the same trust as running the project's
  lint; tsc runs with `--incremental false --composite false` so no `.tsbuildinfo` is written
  ([ADR-0016](docs/adr/0016-quality-phase-2.md)). The only thing written under the analysed root is
its cache, `.xray/cache/` (git churn keyed by commit, window and day) with `.xray/.gitignore`
(`*`), so it is never committed or reported as a change; a missing, unreadable or corrupt entry is
recomputed, never trusted, and `--no-cache` turns it off ([ADR-0021](docs/adr/0021-agent-mode.md)).
The report goes where `-o` says. `--snapshots <dir>` writes a copy of each committed report into
`<dir>`, the folder the caller names (the plugin passes its own data folder, outside the analysed
repository), through a temp file and a rename, and deletes only snapshot-named files there
(`<time>-<sha>.json`) beyond the newest 30; a damaged snapshot is skipped, never trusted;
`compare` reads two report files and writes only where `-o` says
([ADR-0027](docs/adr/0027-quality-snapshots.md)). The UI is a
  static page that reads report files locally and keeps the open ones in the browser's localStorage
  (that origin only; *Close all* removes them).
- **Write token in CI.** The Action uses `GITHUB_TOKEN` with `pull-requests: write` to create or
  update one comment, via the REST API at `GITHUB_API_URL`. It is meant for `pull_request` events,
  where fork PRs get a read-only token (the comment step then only warns; the report stays in the
  job summary); using it on `pull_request_target` would give fork code a
  write token alongside the checkout and is not supported.
- **Graph format** (`xray-quality -f graph`) prints file paths and imports the report already reads,
  with no new input; `xray.sh quality` runs the same built clone as the plugin's skills
  ([ADR-0023](docs/adr/0023-data-for-other-skills.md)).
- **Agent format** (`--format agent`, both CLIs) prints the same findings as the other formats,
  with no new input. `--only bundle` does not enable the bundle analysis: running the project's
  scripts still needs `--bundle` (ADR-0021). `--files` values are matched against tracked paths and
  handed to the project's own ESLint as file arguments, without a shell.
- **Shell injection.** `action.yml` passes inputs (`base`, `config`) to scripts through `env`, never
  by interpolating workflow expressions into `run:` bodies.
- **Report content.** File paths from the PR end up in the comment's Markdown and Mermaid labels.
  Mermaid labels are quoted and `"` is escaped; in Markdown, file names are always inside a code
  span whose fence is longer than any backtick run in the name, so they cannot inject Markdown.

- **The Claude Code skills** run on the user's machine. Its script clones `pearpages/xray` (or
  `XRAY_REPO`) into the plugin's data folder, runs `npm ci` and the build there, and runs the CLI's
  read-only modes (`--inventory`, `--format json`). That is the same trust as installing the plugin.
  `features` may run that script plus Read, Grep and Glob, and writes only `xray.features.json`
  for the user to review and commit. `explain-pr` may also run read-only `gh pr view`/`gh pr diff`
  and `git diff`; it writes nothing and never posts to the PR. `onboard` and `check-diagrams` run
  their bundled Node scripts (read-only `git ls-files` and `git log`, no network, no
  dependencies) and `xray.sh quality`; `onboard` writes only `docs/onboarding/`, and
  `check-diagrams` edits Markdown diagrams only after the user agrees to each change
  ([ADR-0024](docs/adr/0024-language-agnostic-skills-in-the-plugin.md)).

## Secrets

- Never committed. The only secret is the workflow's `GITHUB_TOKEN`, passed as the `github-token`
  input (defaults to `github.token`) and read from the environment by `packages/action`.
- `.env*` files are gitignored; an example file lists names only.
- No other credentials exist; nothing to rotate.

## Dependencies

- Runtime dependencies are kept minimal: `dependency-cruiser`, `ts-morph`, `typescript` (core) and
  `commander` (cli); the quality tool adds `jscpd` 4 and `ts-morph`, never installed by the Action.
  The comment script uses Node's built-in `fetch`, no Octokit.
- The quality UI also depends on `@pearpages/modals`, `@pearpages/heatmap` and `@pearpages/pulp-icons`
  (pulp's own packages, at the versions pulp uses), for their stylesheets and the info icon.
- Development only, never installed by the Action: React, Vite and pulp (quality-ui), vitest with
  `@vitest/coverage-v8`, and `jsdom` + Testing Library for the UI's component tests.
- `package-lock.json` is committed; CI and the Action install with `npm ci`.
- Third-party actions (`actions/checkout`, `actions/setup-node`) are pinned by commit SHA, with the
  version in a comment, on their Node 24 releases.
- Dependabot (`.github/dependabot.yml`) proposes npm and GitHub Actions updates weekly: minor and
  patch updates grouped per ecosystem, each major in a PR of its own, and never TypeScript 7 ([ADR-0002](docs/adr/0002-typescript-6-for-dependency-cruiser.md)).

## Known risks

- The Action installs xray's dependencies from npm on every run
  ([ADR-0003](docs/adr/0003-action-builds-at-runtime.md)), so a compromised dependency release
  would run in consumers' CI — mitigated only by the committed lockfile.
