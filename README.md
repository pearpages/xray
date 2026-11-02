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
| [`packages/quality`](packages/quality) | `xray-quality`: scores a whole repository (not a PR) and writes a JSON report.            |
| [`packages/quality-ui`](packages/quality-ui) | Opens those reports in the browser (React, Vite, [pulp](https://github.com/pearpages/pulp)). |

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
      - uses: actions/checkout@v7
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
and the report is still in the job summary. A run on a PR that is already merged or closed (a re-run
after the merge, say) leaves its comment as it was: the report it was reviewed with stays.

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
- `interactions.entryGlobs`: files whose components are entry points (pages, routes, screens); in
  a file without components, the units nothing calls (`main`'s root, a route's `GET`). The feature
  map's entry points always count too.
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
  workspace package, when present). Produce them in the workflow before the xray step; xray itself
  never runs tests. With Vitest, call it directly (`pnpm test -- …` passes a literal `--`, after
  which Vitest ignores flags) and keep the report even if a test fails or slows down under
  instrumentation:

  ```yaml
  - run: npx vitest run --coverage --coverage.reporter=lcov --coverage.reportOnFailure --testTimeout=60000
    continue-on-error: true # the project's CI is where tests gate the PR
  ```
- `bundle.enabled`: measure bundle size (also `--bundle`, or the Action's `bundle: "true"`).
  `bundle.install`, `bundle.build` and `bundle.outDir` override what xray detects: the lockfile's
  install command, `vite build --sourcemap hidden` for Vite projects (at a workspace root: in the one
  package that is a Vite app, i.e. depends on `vite` and has an `index.html`) or the `build` script,
  and `dist`/`build`/`out`. `thresholdBytes` / `thresholdPercent` turn the light red on total gzip growth.

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
  package is followed into the screens that use it.
- Each package resolves imports with **its own** `tsconfig.json`, `paths` aliases included (`@/…`
  meaning a different folder in each app), even when an `extends` base isn't installed in CI
  ([ADR-0013](docs/adr/0013-per-package-tsconfig.md)).

## Analyses

1. **Dependencies** ✅ — changed files (`git diff` against the merge base) plus their direct
   neighbours (what they import and what imports them) according to dependency-cruiser, in a Mermaid
   diagram grouped by folder with the changed modules highlighted. Distinguishes type-only imports,
   dynamic imports and tests. When a neighbour is a barrel (a package's `index.ts`), its importers
   are shown too, grouped per folder past 8. When a PR changes more modules than fit, the diagram
   shows folders instead ("screens: 27 changed of 50 files").
2. **Interactions** ✅ — with ts-morph, finds the functions, components and hooks the diff touches,
   follows who renders, calls, uses, lazy-loads, mounts or reads them up to entry points, and what they use
   one level down. One Mermaid sequence diagram per feature, named by the feature map when there is
   one. Works across workspace packages.
3. **Impact and risk** ✅ — for each changed unit, the strongest test evidence (coverage of its
   changed lines, branches included, when an lcov report exists; otherwise a test uses it, a test file is named after
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

## Project quality

A second tool in this repository scores the quality of a **whole repository** from 0 to 100, per
metric and overall, so reports of successive commits can be compared. It reads the repository and
never changes it ([ADR-0014](docs/adr/0014-project-quality-tool.md),
[ADR-0015](docs/adr/0015-quality-phase-1-tuning.md)).

```bash
npm ci && npm run build
node packages/quality/dist/cli.js --cwd ../my-project -o my-project.json
```

```
xray-quality
  -C, --cwd <dir>      root of the repository to analyse
  -o, --out <file>     write the report to a file instead of stdout (folders are created)
  -c, --config <file>  config with a `quality` section (default: xray.config.json in --cwd)
```

The report has the repository path, the analysed commit (and whether the tree had uncommitted
changes), the date, a global score, and one result per metric: score, one-sentence summary and
findings (`file`, `line`, `high`/`medium`/`low`, message) and how long it took. A metric that can't
run (no network, no features defined, no lcov report, ESLint/TypeScript not installed) is
*unavailable* with the reason, and the global score averages the others.

| Metric | What it measures | Score |
|---|---|---|
| **Hotspots** | Per code file, commits in the window × the sum of its functions' cyclomatic complexity. | Findings formula |
| **Architecture** | Features (`xray.features.json` features that declare `files`, else folders matching `features`) import each other only through a public API (`index.*`, or a map feature's entry points). Deep imports are medium, two features importing each other high. | Findings formula |
| **Dependencies** | `audit` of production dependencies and `outdated`, with the package manager the lockfile names (npm, pnpm). Read-only; needs the registry. | `100 − 15·high − 5·medium − 1·low` |
| **Coverage** | Lines covered in your lcov reports (a line with an untaken branch isn't covered). xray never runs the tests: run them with coverage first. A code file of a project with a report that isn't in it was loaded by no test: 0 %, its lines estimated, high. Files under `fileThreshold` % are medium, under `highThreshold` % high. | % of instrumented lines covered |
| **Duplication** | Copied blocks of code ([jscpd](https://github.com/kucherenko/jscpd)), ≥ `minTokens` tokens low, ≥ `mediumTokens` medium. | `100 − 4 × duplicated %` |
| **Lint and types** | Your own ESLint (from each folder with an ESLint config) and `tsc --noEmit` (each `tsconfig.json`, or the config a folder's `typecheck` script names), from your `node_modules`; xray installs nothing. A file's TypeScript errors count from its nearest `tsconfig.json`. Errors medium, warnings low. | Findings formula |

Findings formula: `100 − (10·high + 3·medium + 1·low) / (code files / 100)`, so one high finding per
100 files costs 10 points. Global score: the weighted average of the metrics that ran.

**The UI** (`npm run dev -w @xray/quality-ui`, or `npm run build -w @xray/quality-ui` for a static
build in `packages/quality-ui/dist/`): open one or more reports with the button or by dropping them.
It shows the global score and a card per metric, the hotspots table, architecture violations by
feature, all findings filterable by severity and metric, and, with several reports of one
repository, the score per commit. Reports never leave the browser: it keeps the open ones (in
localStorage) until you press *Close all*, so a reload doesn't lose them.

### Configuration (`quality` in `xray.config.json`)

Every field is optional; the rest of the file (`roots`, `tsConfig`, `interactions.featureMap`) is
read as for the PR report.

```json
{
  "quality": {
    "weights": { "hotspots": 1, "architecture": 1, "dependencies": 1, "coverage": 1, "duplication": 1, "lint": 1 },
    "severityPenalty": { "high": 10, "medium": 3, "low": 1 },
    "hotspots": { "windowMonths": 12, "minChurn": 2, "minComplexity": 10, "thresholds": { "high": 1000, "medium": 300, "low": 100 } },
    "architecture": { "features": ["**/features/*"], "publicApi": ["index.{ts,tsx,js,jsx,mts,mjs}"], "shared": ["_*", "shared", "common"], "useFeatureMap": true },
    "dependencies": { "outdated": true, "dev": false, "timeoutSeconds": 180 },
    "coverage": { "files": ["coverage/lcov.info"], "fileThreshold": 50, "highThreshold": 20, "exclude": ["**/*.config.*", "**/scripts/**", "**/testing/**", "**/test-utils/**", "**/__mocks__/**", "**/mocks/**", "**/.storybook/**"] },
    "duplication": { "minTokens": 50, "mediumTokens": 200 },
    "lint": { "eslint": true, "typescript": true, "timeoutSeconds": 300 },
    "ignore": ["**/*.generated.*"]
  }
}
```

- `weights`: weight of each metric in the global score (default 1; 0 leaves it out).
- `severityPenalty`: points a finding costs in the findings formula.
- `hotspots.windowMonths`: how far back commits count. `minChurn` / `minComplexity`: below either, a
  file is never a finding. `thresholds`: hotspot value from which a file is high, medium or low.
- `architecture.features`: globs of feature folders (the outermost match owns a file).
  `publicApi`: globs, inside a feature folder, of the files other features may import. `shared`:
  names of folders among the features that are shared code, importable by anyone.
  `useFeatureMap`: use `xray.features.json` features that declare `files` when there are two or
  more.
- `dependencies.outdated`: also list direct dependencies a major version behind (low). `dev`: audit
  devDependencies too. `timeoutSeconds`: per command.
- `coverage.files`: lcov reports, relative to the root (default: `coverage/lcov.info` at the root
  and in each workspace package, as in the PR report). `fileThreshold` / `highThreshold`: a file
  under that % of lines covered is a medium / high finding.
  `exclude`: globs left out of coverage, like your runner's coverage `exclude` (tooling no test is
  meant to load). For exact numbers, make your runner report every file (Vitest: `coverage.include`);
  otherwise xray estimates the files no test loaded ([ADR-0018](docs/adr/0018-untested-files-count.md)).
- `duplication.minTokens`: the smallest copied block reported. `mediumTokens`: from this size a
  block is medium instead of low.
- `lint.eslint` / `lint.typescript`: run the project's ESLint / `tsc --noEmit`. `timeoutSeconds`:
  per run.
- `ignore`: globs left out of every metric, on top of tests, stories, declarations and build output.

## Development

```bash
npm ci
npm run build
npm test -- --run
npm run coverage   # the same, with coverage and its floor (as in CI)
```

Node 24 (pinned in `mise.toml`). `typescript` stays on the 6.x series: TypeScript 7 has no
JavaScript API, so dependency-cruiser and ts-morph both run on 6
([ADR-0002](docs/adr/0002-typescript-6-for-dependency-cruiser.md)).

## License

[MIT](LICENSE)
