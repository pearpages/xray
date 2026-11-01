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
  "dependencies": { "maxNodes": 60, "includeExternal": false },
  "interactions": {
    "entryGlobs": ["**/src/main.{ts,tsx,js,jsx}", "**/src/{pages,routes,screens,views}/**", "**/app/**/{page,layout,route}.{ts,tsx,js,jsx}", "**/pages/**"],
    "ignore": [],
    "depthUp": 6,
    "depthDown": 1,
    "maxCallees": 6,
    "hubCallers": 8,
    "maxDiagrams": 5,
    "maxTouchedUnits": 40,
    "featureMap": "xray.features.json"
  }
}
```

- `roots`: folders dependency-cruiser scans (default `src` if it exists, otherwise `.`).
- `tsConfig`: used to resolve aliases (`@/…`); defaults to `tsconfig.json` if it exists.
- `dependencies.maxNodes`: node limit for the diagram; neighbours connected to more changed modules
  are kept first, and the report says how many were left out.
- `dependencies.includeExternal`: show npm packages and Node modules as neighbours.
- `interactions.entryGlobs`: files whose functions and components are entry points (pages, routes,
  screens). The feature map's entry points always count too.
- `interactions.ignore`: extra globs left out of the walk. Tests (`*.test.*`, `*.spec.*`,
  `__tests__/`) and stories (`*.stories.*`) are always left out.
- `interactions.depthUp` / `depthDown`: how far to follow callers up and callees down.
- `interactions.maxCallees`: callees drawn per unit; the rest are counted.
- `interactions.hubCallers`: without a feature map, a unit with more callers than this (a store hook,
  a shared layout) ends the walk and is shown once as a shared feature.
- `interactions.maxDiagrams` / `maxTouchedUnits`: limits that keep the comment readable; past
  `maxTouchedUnits` only the list of changed units is shown.

## Feature map (`xray.features.json`)

Optional. It names the product's features so diagrams say "Cart" instead of a component name:

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

- `entryPoints` are `path#name` units where the feature starts; the walk stops there.
- `files` (optional) claims changed code even when no walk reaches an entry point.
- xray only reads this file. It is meant to be written and updated by the xray skill in Claude Code
  and reviewed like code; the report lists changed code no feature covers.
- Without it, every entry point reached is its own feature and the section says the map is missing.

## Monorepos

Run xray from the workspace root (`pnpm-workspace.yaml` or `workspaces` in `package.json`).
Every package with a `tsconfig.json` is analysed together, and workspace imports such as
`@acme/domain` resolve to that package's source (`exports`, `main`, or `src/index.ts`), with no
`node_modules` needed, so a change in a shared package shows up in the screens that use it.

## Analyses

1. **Dependencies** ✅ — changed files (`git diff` against the merge base) plus their direct
   neighbours (what they import and what imports them) according to dependency-cruiser, in a Mermaid
   diagram grouped by folder with the changed modules highlighted. Distinguishes type-only imports,
   dynamic imports and tests.
2. **Interactions** ✅ — with ts-morph, finds the functions, components and hooks the diff touches,
   follows who renders, calls, uses, lazy-loads or mounts them up to entry points, and what they use
   one level down. One Mermaid sequence diagram per feature, named by the feature map when there is
   one. Works across workspace packages.
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

Node 24 (pinned in `mise.toml`). `typescript` stays on the 6.x series: TypeScript 7 has no
JavaScript API, so dependency-cruiser and ts-morph both run on 6
([ADR-0002](docs/adr/0002-typescript-6-for-dependency-cruiser.md)).

## License

[MIT](LICENSE)
