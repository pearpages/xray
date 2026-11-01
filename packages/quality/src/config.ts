import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { resolveConfig, type XrayConfig, type XrayConfigInput } from "@xray/core";
import type { Severity } from "./types.js";

export interface QualityConfig {
  /** Per metric id; metrics not listed weigh 1. */
  weights: Record<string, number>;
  /** Points one finding costs in the findings formula (ADR-0014). */
  severityPenalty: Record<Severity, number>;
  hotspots: {
    windowMonths: number;
    minChurn: number;
    minComplexity: number;
    thresholds: Record<Severity, number>;
  };
  architecture: {
    /** Globs of feature folders. */
    features: string[];
    /** Globs, relative to a feature folder, of the files that are its public API. */
    publicApi: string[];
    /** Names of folders among the features that are shared code, importable by any feature. */
    shared: string[];
    /** Use xray.features.json features that declare `files`, when present. */
    useFeatureMap: boolean;
  };
  dependencies: {
    outdated: boolean;
    /** Audit devDependencies too; by default only what ships (production dependencies). */
    dev: boolean;
    timeoutSeconds: number;
  };
  /** Globs left out of every metric, on top of tests, stories, declarations and build output. */
  ignore: string[];
  /** The xray config of the same file, for core (roots, tsconfig, workspaces, feature map). */
  xray: XrayConfig;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type QualityConfigInput = DeepPartial<Omit<QualityConfig, "xray">>;

export const DEFAULT_QUALITY: Omit<QualityConfig, "xray"> = {
  weights: {},
  severityPenalty: { high: 10, medium: 3, low: 1 },
  hotspots: { windowMonths: 12, minChurn: 2, minComplexity: 10, thresholds: { high: 1000, medium: 300, low: 100 } },
  architecture: {
    features: ["**/features/*"],
    publicApi: ["index.{ts,tsx,js,jsx,mts,mjs}"],
    shared: ["_*", "shared", "common"],
    useFeatureMap: true,
  },
  dependencies: { outdated: true, dev: false, timeoutSeconds: 60 },
  ignore: [],
};

export function resolveQualityConfig(input: QualityConfigInput, xray: XrayConfig): QualityConfig {
  const d = DEFAULT_QUALITY;
  return {
    weights: { ...d.weights, ...(input.weights as Record<string, number> | undefined) },
    severityPenalty: { ...d.severityPenalty, ...input.severityPenalty },
    hotspots: {
      ...d.hotspots,
      ...input.hotspots,
      thresholds: { ...d.hotspots.thresholds, ...input.hotspots?.thresholds },
    },
    architecture: {
      features: input.architecture?.features ?? d.architecture.features,
      publicApi: input.architecture?.publicApi ?? d.architecture.publicApi,
      shared: input.architecture?.shared ?? d.architecture.shared,
      useFeatureMap: input.architecture?.useFeatureMap ?? d.architecture.useFeatureMap,
    },
    dependencies: { ...d.dependencies, ...input.dependencies },
    ignore: input.ignore ?? d.ignore,
    xray,
  } as QualityConfig;
}

/** The `quality` section of `xray.config.json` (or of `configPath`), over the defaults. */
export function loadQualityConfig(root: string, configPath?: string): QualityConfig {
  const file = configPath ? (isAbsolute(configPath) ? configPath : join(root, configPath)) : join(root, "xray.config.json");
  if (configPath && !existsSync(file)) throw new Error(`Config file not found: ${file}`);
  const raw = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as XrayConfigInput & { quality?: QualityConfigInput }) : {};
  // The rest of the same file is the xray config core needs (roots, tsconfig, feature map).
  return resolveQualityConfig(raw.quality ?? {}, resolveConfig(root, raw));
}
