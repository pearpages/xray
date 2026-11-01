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
  --bundle             also install and build base and PR to compare bundle sizes
  --inventory          print entry point candidates and feature map checks as JSON (ignores base)
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
          persist-credentials: false # recommended; required if you enable bundle
      - uses: pearpages/xray@v0 # or @v0.1.0 to pin, @main for unreleased work
        # with:
        #   working-directory: apps/web
        #   config: xray.config.json
        #   comment: "false"   # only produce the report (it also goes to the job summary)
        #   bundle: "true"     # also measure bundle size (runs install + build twice; see below)
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
  },
  "risk": { "complexityHigh": 15, "complexityJump": 3, "indirectDepth": 3, "coverage": ["coverage/lcov.info"] },
  "bundle": { "enabled": false, "thresholdBytes": 10240, "thresholdPercent": 5, "timeoutMinutes": 10 }
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
  `maxTouchedUnits` only the list of changed units is shown, and risk is not assessed.
- `risk.complexityHigh` / `complexityJump`: an untested unit at or above this complexity, or whose
  complexity grew by at least this much, is red.
- `risk.indirectDepth`: how many callers up a test may sit and still count as evidence.
- `risk.coverage`: lcov reports to read (default: `coverage/lcov.info` at the root and in each
  workspace package, when present). Produce them in the workflow before the xray step, e.g.
  `npx vitest run --coverage --coverage.reporter=lcov`; xray itself never runs tests.
- `bundle.enabled`: measure bundle size (also `--bundle`, or the Action's `bundle: "true"`).
  `bundle.install`, `bundle.build` and `bundle.outDir` override what xray detects: the lockfile's
  install command, `vite build --sourcemap hidden` for Vite projects or the `build` script, and
  `dist`/`build`/`out`. `thresholdBytes` / `thresholdPercent` turn the light red on total gzip growth.

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
- xray only reads this file. The xray skill for Claude Code writes and updates it; review it like
  code. The report lists changed code no feature covers, which is the cue to run the skill again.
- Without it, every entry point reached is its own feature and the section says the map is missing.

### The xray skills for Claude Code

Install the plugin from this repository:

```
/plugin install xray --marketplace pearpages/xray
```

On older Claude Code versions: `/plugin marketplace add pearpages/xray`, then
`/plugin install xray@xray`. The skills need Node.js 22+, git and npm: on first use they download and
build xray into the plugin's data folder (about a minute), then reuse that build.

- **`/xray:features`** (or "create the xray feature map"): reads your code, writes
  `xray.features.json`, checks it, and leaves it for you to review and commit.
- **`/xray:explain`** (or "explain this xray report", "is this PR risky?"): turns a PR's report
  into a reviewer's briefing: what the PR does for users, where it reaches, and for every 🔴/🟡
  unit a concrete next step (which test to add and which case it must cover), read from the diff
  and from what the existing tests actually check. It reads the report from the PR comment, or runs
  xray locally when the branch is checked out; it never posts to the PR.

To audit a map yourself, `xray --inventory` prints the entry point candidates, the map's status,
entry points that no longer exist and pages no feature claims.

## Monorepos

Run xray from the workspace root (`pnpm-workspace.yaml` or `workspaces` in `package.json`).
Workspace imports such as `@acme/domain` or `@acme/ui/theme.css` resolve to that package's files
(`exports`, `main`, or `src/index.ts`) with no `node_modules` needed, in both analyses:

- **Dependencies** shows a changed file's imports from, and importers in, other packages.
  When a package is imported through its `index.ts`, a change deeper in that package also shows
  who imports that `index.ts`, grouped per folder.
- **Interactions** analyses every package with a `tsconfig.json` together, so a change in a shared
  package is followed into the screens that use it. They share the root's compiler options: a
  package's own `paths` aliases (`@/…` inside one package) are not applied; relative imports and
  workspace package names are.

## Analyses

1. **Dependencies** ✅ — changed files (`git diff` against the merge base) plus their direct
   neighbours (what they import and what imports them) according to dependency-cruiser, in a Mermaid
   diagram grouped by folder with the changed modules highlighted. Distinguishes type-only imports,
   dynamic imports and tests. When a neighbour is a barrel (a package's `index.ts`), its importers
   are shown too, grouped per folder past 8.
2. **Interactions** ✅ — with ts-morph, finds the functions, components and hooks the diff touches,
   follows who renders, calls, uses, lazy-loads, mounts or reads them up to entry points, and what they use
   one level down. One Mermaid sequence diagram per feature, named by the feature map when there is
   one. Works across workspace packages.
3. **Impact and risk** ✅ — for each changed unit, the strongest test evidence (line coverage of its
   changed lines when an lcov report exists; otherwise a test uses it, a test file is named after
   its file, or a test uses a caller) and its complexity before and after.
   A traffic light per unit, per feature and for the PR, plus *features without tests* and *growing
   complexity*. No test is run; it never fails the check
   ([ADR-0007](docs/adr/0007-impact-and-risk-analysis.md)).
4. **Public API** ✅ — exports of every changed file, base vs PR, read from the source text
   (parameters, props, members, re-exports): 🔴 breaking, 🟡 to review, 🟢 compatible, with the
   files that use them (through package barrels too) and 📦 on what workspace packages expose.
   Endpoints: changed OpenAPI JSON specs and Next.js route handlers (`app/**/route.ts`,
   `pages/api/*`), compared by method and URL
   ([ADR-0008](docs/adr/0008-public-api-analysis.md), [ADR-0011](docs/adr/0011-barrels-coverage-and-routes.md)).
5. **Bundle size** ✅ (opt-in) — installs and builds the base and the PR in throwaway worktrees,
   compares chunks raw/gzip/brotli, flags growth over the threshold, and names the cause: per
   package from source maps, plus dependency changes. It runs your project's scripts: enable it with
   `bundle: "true"` and check out with `persist-credentials: false`
   ([ADR-0009](docs/adr/0009-bundle-size-analysis.md)).

Claude skills: ✅ `/xray:features` writes and updates the feature map; ✅ `/xray:explain` explains
a report and its risks.

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
