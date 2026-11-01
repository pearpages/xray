import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DependenciesConfig {
  /** Upper bound of nodes in the diagram; neighbours beyond it are summarised. */
  maxNodes: number;
  /** Show npm packages and Node built-ins as neighbours. */
  includeExternal: boolean;
}

export interface XrayConfig {
  /** Folders dependency-cruiser scans, relative to the repo root. */
  roots: string[];
  /** tsconfig used to resolve path aliases; undefined if the repo has none. */
  tsConfig?: string;
  /** Regular expressions of paths to leave out of the graph. */
  exclude: string[];
  dependencies: DependenciesConfig;
}

export const CONFIG_FILE = "xray.config.json";

const DEFAULT_EXCLUDE = ["(^|/)node_modules/", "(^|/)(dist|build|coverage|\\.next)/"];

export type XrayConfigInput = Partial<Omit<XrayConfig, "dependencies">> & {
  dependencies?: Partial<DependenciesConfig>;
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
