# 🩻 xray

Pull request analysis for TypeScript/React projects. It compares the current branch with the base
branch and produces a Markdown report (with Mermaid diagrams) that a GitHub Action publishes as **a
single comment** on the PR, updated on every push.

## Structure

| Package                              | What it is                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)     | Reusable core: git diff, analyses and rendering. Returns data (`XrayResult`) and Markdown.  |
| [`packages/cli`](packages/cli)       | The `xray [base]` CLI, a single command.                                                    |
| [`packages/action`](packages/action) | Creates or updates the PR comment (found by the `<!-- xray:report -->` marker).             |
| [`action.yml`](action.yml)           | Composite GitHub Action that builds xray, runs the CLI and comments.                        |

The core knows nothing about GitHub or the CLI: the upcoming project-quality tool can call
`analyzePullRequest()` and use the JSON directly.

## CLI

```bash
npm ci && npm run build
node packages/cli/dist/index.js main --cwd ../my-project
```

```
xray [base]            base branch of the PR (default main; also tries origin/<base>)
  -C, --cwd <dir>      root of the repository to analyse
  -f, --format <fmt>   markdown | json
  -o, --out <file>     write the report to a file
  -c, --config <file>  config, relative to --cwd (default xray.config.json)
  --head <sha>         commit to report as the PR head (default HEAD; the Action passes the PR's head)
```

When run locally, the diff also includes uncommitted changes and new untracked files.

## GitHub Action

```yaml
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  xray:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # needed to find the merge base with the base branch
      - uses: pearpages/xray@main
        # with:
        #   working-directory: apps/web
        #   config: xray.config.json
        #   comment: "false"   # only produce the report (it also goes to the job summary)
```

The report is also appended to the *job summary* and exposed as the `report-path` output.
On PRs from forks `GITHUB_TOKEN` is read-only: the comment step then logs a warning instead of failing,
and the report is still in the job summary.

## Configuration (`xray.config.json`)

Every field is optional:

```json
{
  "roots": ["src"],
  "tsConfig": "tsconfig.json",
  "exclude": ["(^|/)node_modules/", "(^|/)(dist|build|coverage|\\.next)/"],
  "dependencies": { "maxNodes": 60, "includeExternal": false }
}
```

- `roots`: folders dependency-cruiser scans (default `src` if it exists, otherwise `.`).
- `tsConfig`: used to resolve aliases (`@/…`); defaults to `tsconfig.json` if it exists.
- `dependencies.maxNodes`: node limit for the diagram; neighbours connected to more changed modules
  are kept first, and the report says how many were left out.
- `dependencies.includeExternal`: show npm packages and Node modules as neighbours.

## Analyses

1. **Dependencies** ✅ — changed files (`git diff` against the merge base) plus their direct
   neighbours (what they import and what imports them) according to dependency-cruiser, in a Mermaid
   diagram grouped by folder with the changed modules highlighted. Distinguishes type-only imports,
   dynamic imports and tests.
2. **Interactions** — ts-morph: touched functions/components → references up to entry points and 1-2
   levels down → sequence diagrams per feature, using a feature map versioned in the repo.
3. **Impact and risk** — coverage × complexity → traffic light.
4. **Public API / contracts** — diff of exports and endpoints, compatible/breaking, affected usages.
5. **Bundle size** — build base and PR, gzip/brotli chunks, configurable threshold and cause.

Next: a Claude skill on top of the CLI that explains the diagrams and risks.

## Development

```bash
npm ci
npm run build
npm test -- --run
```

Node 24 (pinned in `mise.toml`). `typescript` stays on the 6.x series: dependency-cruiser does not
support TypeScript 7 yet (`>=2 <7`), and without it it does not analyse `.ts`/`.tsx` files.

## License

[MIT](LICENSE)
