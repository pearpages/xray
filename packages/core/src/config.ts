import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DependenciesConfig {
  /** Upper bound of nodes in the diagram; neighbours beyond it are summarised. */
  maxNodes: number;
  /** Show npm packages and Node built-ins as neighbours. */
  includeExternal: boolean;
}

export interface InteractionsConfig {
  /** Globs (relative to the analysed root) whose units are entry points. */
  entryGlobs: string[];
  /** Globs of files left out of the walk, on top of tests and stories. */
  ignore: string[];
  /** How many callers up to follow before giving up on reaching an entry point. */
  depthUp: number;
  /** How many levels of callees to show below each touched unit. */
  depthDown: number;
  /** Callees shown per unit; the rest are counted. */
  maxCallees: number;
  /**
   * Without a feature map, a unit with more callers than this (a store hook, a
   * shared layout) ends the walk and stands for all of them, instead of one
   * near-identical feature per caller.
   */
  hubCallers: number;
  maxDiagrams: number;
  /** Above this many touched units, only the table is shown (diagrams would not be readable). */
  maxTouchedUnits: number;
  /** Feature map path, relative to the analysed root. */
  featureMap: string;
}

export interface RiskConfig {
  /** Complexity at or above which an untested unit is red. */
  complexityHigh: number;
  /** Complexity growth at or above which an untested unit is red. */
  complexityJump: number;
  /** How many callers up a test may sit and still count as indirect evidence. */
  indirectDepth: number;
  /**
   * lcov reports to read, relative to the analysed root. Default: `coverage/lcov.info` at the
   * root and in each workspace package, when they exist. The workflow must produce them first.
   */
  coverage?: string[];
}

export interface BundleConfig {
  /** Off by default: it installs dependencies and runs the build, on the base and on the PR. */
  enabled: boolean;
  /** Install command; default from the lockfile (`pnpm install --frozen-lockfile`, `npm ci`, …). */
  install?: string;
  /** Build command; default `vite build --sourcemap hidden` for Vite projects, else the `build` script. */
  build?: string;
  /** Build output folder, relative to the analysed root; default `dist`, then `build`, then `out`. */
  outDir?: string;
  /** Total gzip growth (bytes) that turns the light red. */
  thresholdBytes: number;
  /** Total gzip growth (percent) that turns the light red. */
  thresholdPercent: number;
  /** Per command. */
  timeoutMinutes: number;
}

export interface XrayConfig {
  /** Folders dependency-cruiser scans, relative to the repo root. */
  roots: string[];
  /** tsconfig used to resolve path aliases; undefined if the repo has none. */
  tsConfig?: string;
  /** Regular expressions of paths to leave out of the graph. */
  exclude: string[];
  dependencies: DependenciesConfig;
  interactions: InteractionsConfig;
  risk: RiskConfig;
  bundle: BundleConfig;
}

export const CONFIG_FILE = "xray.config.json";

const DEFAULT_EXCLUDE = ["(^|/)node_modules/", "(^|/)(dist|build|coverage|\\.next)/"];

export const DEFAULT_ENTRY_GLOBS = [
  "**/src/main.{ts,tsx,js,jsx}",
  "**/src/{pages,routes,screens,views}/**",
  "**/app/**/{page,layout,route}.{ts,tsx,js,jsx}",
  "**/pages/**",
];

export type XrayConfigInput = Partial<Omit<XrayConfig, "dependencies" | "interactions" | "risk" | "bundle">> & {
  bundle?: Partial<BundleConfig>;
  dependencies?: Partial<DependenciesConfig>;
  interactions?: Partial<InteractionsConfig>;
  risk?: Partial<RiskConfig>;
};

export function resolveConfig(cwd: string, input: XrayConfigInput = {}): XrayConfig {
  const defaultTsConfig = existsSync(join(cwd, "tsconfig.json")) ? "tsconfig.json" : undefined;
  return {
    roots: input.roots ?? (existsSync(join(cwd, "src")) ? ["src"] : ["."]),
    tsConfig: input.tsConfig ?? defaultTsConfig,
    exclude: input.exclude ?? DEFAULT_EXCLUDE,
    dependencies: {
      maxNodes: input.dependencies?.maxNodes ?? 60,
      includeExternal: input.dependencies?.includeExternal ?? false,
    },
    interactions: {
      entryGlobs: input.interactions?.entryGlobs ?? DEFAULT_ENTRY_GLOBS,
      ignore: input.interactions?.ignore ?? [],
      depthUp: input.interactions?.depthUp ?? 6,
      depthDown: input.interactions?.depthDown ?? 1,
      maxCallees: input.interactions?.maxCallees ?? 6,
      hubCallers: input.interactions?.hubCallers ?? 8,
      maxDiagrams: input.interactions?.maxDiagrams ?? 5,
      maxTouchedUnits: input.interactions?.maxTouchedUnits ?? 40,
      featureMap: input.interactions?.featureMap ?? "xray.features.json",
    },
    risk: {
      complexityHigh: input.risk?.complexityHigh ?? 15,
      complexityJump: input.risk?.complexityJump ?? 3,
      indirectDepth: input.risk?.indirectDepth ?? 3,
      ...(input.risk?.coverage ? { coverage: input.risk.coverage } : {}),
    },
    bundle: {
      enabled: input.bundle?.enabled ?? false,
      ...(input.bundle?.install ? { install: input.bundle.install } : {}),
      ...(input.bundle?.build ? { build: input.bundle.build } : {}),
      ...(input.bundle?.outDir ? { outDir: input.bundle.outDir } : {}),
      thresholdBytes: input.bundle?.thresholdBytes ?? 10_240,
      thresholdPercent: input.bundle?.thresholdPercent ?? 5,
      timeoutMinutes: input.bundle?.timeoutMinutes ?? 10,
    },
  };
}

/** Reads `xray.config.json` (or `configPath`) and fills in defaults. */
export function loadConfig(cwd: string, configPath?: string): XrayConfig {
  const file = join(cwd, configPath ?? CONFIG_FILE);
  if (!existsSync(file)) {
    if (configPath) throw new Error(`Config file not found: ${file}`);
    return resolveConfig(cwd);
  }
  return resolveConfig(cwd, JSON.parse(readFileSync(file, "utf8")) as XrayConfigInput);
}
