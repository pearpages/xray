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
  code, scripts or package installs; base versions of files are read with `git show`, not checked
  out. Test evidence for analysis 3 is found by reading test files, never by running them.
  Workspace `package.json` files and `pnpm-workspace.yaml` are read as data (JSON, and a
  minimal line parser for the YAML) to map package names to folders. Analyses that need to execute the project (planned: tests coverage,
  bundle builds) change this and must be reviewed here first.
- **Write token in CI.** The Action uses `GITHUB_TOKEN` with `pull-requests: write` to create or
  update one comment, via the REST API at `GITHUB_API_URL`. It is meant for `pull_request` events,
  where fork PRs get a read-only token (the comment step then only warns; the report stays in the
  job summary); using it on `pull_request_target` would give fork code a
  write token alongside the checkout and is not supported.
- **Shell injection.** `action.yml` passes inputs (`base`, `config`) to scripts through `env`, never
  by interpolating workflow expressions into `run:` bodies.
- **Report content.** File paths from the PR end up in the comment's Markdown and Mermaid labels.
  Mermaid labels are quoted and `"` is escaped; in Markdown, file names are always inside a code
  span whose fence is longer than any backtick run in the name, so they cannot inject Markdown.

- **The Claude Code skill** runs on the user's machine. Its script clones `pearpages/xray` (or
  `XRAY_REPO`) into the plugin's data folder, runs `npm ci` and the build there, and runs the CLI's
  read-only `--inventory`. That is the same trust as installing the plugin. The skill's allowed
  tools are that script plus Read, Grep and Glob; it writes only `xray.features.json`, and the user
  reviews and commits it.

## Secrets

- Never committed. The only secret is the workflow's `GITHUB_TOKEN`, passed as the `github-token`
  input (defaults to `github.token`) and read from the environment by `packages/action`.
- `.env*` files are gitignored; an example file lists names only.
- No other credentials exist; nothing to rotate.

## Dependencies

- Runtime dependencies are kept minimal: `dependency-cruiser`, `ts-morph`, `typescript` (core) and
  `commander` (cli). The comment script uses Node's built-in `fetch`, no Octokit.
- `package-lock.json` is committed; CI and the Action install with `npm ci`.
- Third-party actions (`actions/checkout`, `actions/setup-node`) are pinned by commit SHA, with the
  version in a comment.
- No automated update/audit job yet.

## Known risks

- The Action installs xray's dependencies from npm on every run
  ([ADR-0003](docs/adr/0003-action-builds-at-runtime.md)), so a compromised dependency release
  would run in consumers' CI — mitigated only by the committed lockfile.
