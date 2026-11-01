# Security

The security surface of xray and the rules that protect it. General rules are in
[principles.md](principles.md); how the pieces fit in [architecture.md](architecture.md).
Update this file whenever the surface changes (new input, endpoint, secret, dependency,
permission).

## Reporting a vulnerability

TODO: the repository has no public remote yet. Once it is on GitHub, enable private vulnerability
reporting and report through a GitHub private security advisory. Never open a public issue for an
unfixed vulnerability.

## Surface

- **Input is untrusted PR content.** xray reads the PR's files, paths and `tsconfig.json`, but only
  parses them statically (git, dependency-cruiser). It never runs the analysed project's code,
  scripts or package installs. Analyses that need to execute the project (planned: tests coverage,
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

## Secrets

- Never committed. The only secret is the workflow's `GITHUB_TOKEN`, passed as the `github-token`
  input (defaults to `github.token`) and read from the environment by `packages/action`.
- `.env*` files are gitignored; an example file lists names only.
- No other credentials exist; nothing to rotate.

## Dependencies

- Runtime dependencies are kept minimal: `dependency-cruiser`, `typescript` (core) and `commander`
  (cli). The comment script uses Node's built-in `fetch`, no Octokit.
- `package-lock.json` is committed; CI and the Action install with `npm ci`.
- Third-party actions (`actions/checkout`, `actions/setup-node`) are pinned by commit SHA, with the
  version in a comment.
- No automated update/audit job yet.

## Known risks

- The Action installs xray's dependencies from npm on every run
  ([ADR-0003](docs/adr/0003-action-builds-at-runtime.md)), so a compromised dependency release
  would run in consumers' CI — mitigated only by the committed lockfile.
