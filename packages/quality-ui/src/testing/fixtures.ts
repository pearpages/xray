import type { MetricResult, QualityReport } from "../reports";

export const hotspotsMetric = (score = 72): MetricResult => ({
  id: "hotspots",
  name: "Hotspots",
  score,
  summary: "2 hotspots in 12 months.",
  status: "ok",
  findings: [
    { file: "src/cart/reduce.ts", severity: "high", message: "18 commits × complexity 216" },
    { file: "src/cart/total.ts", severity: "low", message: "4 commits × complexity 30" },
  ],
  data: {
    windowMonths: 12,
    rows: [
      { file: "src/cart/reduce.ts", churn: 18, complexity: 216, hotspot: 3888 },
      { file: "src/cart/total.ts", churn: 4, complexity: 30, hotspot: 120 },
      { file: "src/app.ts", churn: 9, complexity: 2, hotspot: 18 },
    ],
  },
});

export const architectureMetric = (): MetricResult => ({
  id: "architecture",
  name: "Architecture",
  score: 82,
  summary: "1 deep import, 1 cycle.",
  status: "ok",
  findings: [
    { file: "src/features/cart/Cart.tsx", line: 3, severity: "medium", message: "Cart imports Catalogue's internals" },
    { file: "src/features/cart/Cart.tsx", severity: "high", message: "Cart and Catalogue import each other" },
  ],
  data: {
    source: "folders",
    features: [
      { id: "cart", name: "Cart", files: 3, publicApi: ["src/features/cart/index.ts"] },
      { id: "catalogue", name: "Catalogue", files: 4, publicApi: ["src/features/catalogue/index.ts"] },
    ],
    violations: [{ from: "cart", to: "catalogue", imports: [{ file: "src/features/cart/Cart.tsx", imports: "src/features/catalogue/list.ts", line: 3 }] }],
    cycles: [["cart", "catalogue"]],
  },
});

export const unavailableMetric = (): MetricResult => ({
  id: "dependencies",
  name: "Dependencies",
  score: null,
  summary: "Not measured: the registry can't be reached",
  status: "unavailable",
  reason: "the registry can't be reached",
  findings: [],
});

export const coverageMetric = (stale = false): MetricResult => ({
  id: "coverage",
  name: "Coverage",
  score: 60,
  summary: "60 % of 20 instrumented lines covered.",
  status: "ok",
  findings: [{ file: "src/cart/total.ts", severity: "high", message: "no test loads it (≈ 8 lines)" }],
  data: {
    files: ["coverage/lcov.info"],
    percent: 60,
    lines: 20,
    covered: 12,
    untested: 1,
    missing: ["apps/mobile/a.ts"],
    reportDate: "2026-11-02T10:00:00.000Z",
    stale,
    rows: [
      { file: "src/cart/total.ts", lines: 8, covered: 0, percent: 0, untested: true },
      { file: "src/cart/reduce.ts", lines: 4, covered: 4, percent: 100 },
      { file: "src/app.ts", lines: 10, covered: 4, percent: 40 },
    ],
  },
});

export const duplicationMetric = (clones = 2): MetricResult => ({
  id: "duplication",
  name: "Duplication",
  score: 84,
  summary: "4 % of 500 lines are duplicated.",
  status: "ok",
  findings: [],
  data: {
    percent: 4,
    lines: 500,
    duplicatedLines: 20,
    clones: [
      { tokens: 240, lines: 12, a: { file: "src/cart/reduce.ts", start: 10, end: 21 }, b: { file: "src/cart/undo.ts", start: 3, end: 14 } },
      { tokens: 60, lines: 4, a: { file: "src/app.ts", start: 1, end: 4 }, b: { file: "src/main.ts", start: 2, end: 5 } },
      ...Array.from({ length: Math.max(0, clones - 2) }, (_, i) => ({
        tokens: 50,
        lines: 3,
        a: { file: `src/gen/a${i}.ts`, start: 1, end: 3 },
        b: { file: `src/gen/b${i}.ts`, start: 1, end: 3 },
      })),
    ].slice(0, clones),
  },
});

export const dependenciesMetric = (outdated: boolean = true): MetricResult => ({
  id: "dependencies",
  name: "Dependencies",
  score: 70,
  summary: "",
  status: "ok",
  findings: [{ file: "package.json", severity: "high", message: "next: SSRF (critical)" }],
  data: {
    packageManager: "pnpm",
    vulnerabilities: [
      { package: "semver", severity: "moderate", title: "ReDoS" },
      { package: "next", severity: "critical", title: "SSRF; Cache poisoning; Request smuggling" },
      { package: "zod", severity: "low", title: "DoS" },
    ],
    outdated: outdated
      ? [
          { package: "react", current: "18.3.1", latest: "19.2.0", major: true },
          { package: "vite", current: "8.3.5", latest: "8.4.0", major: false },
        ]
      : null,
  },
});

export const lintMetric = (): MetricResult => ({
  id: "lint",
  name: "Lint and types",
  score: 90,
  summary: "",
  status: "ok",
  findings: [
    { file: "src/a.ts", line: 3, severity: "medium", message: "Type 'string' is not assignable to type 'number'. (TS2322)" },
    { file: "src/b.js", line: 1, severity: "low", message: "Use const. (prefer-const)" },
  ],
  data: {
    runs: [
      { tool: "eslint", target: ".", status: "ok", errors: 0, warnings: 1 },
      { tool: "typescript", target: "tsconfig.json", status: "ok", errors: 1, warnings: 0 },
      { tool: "eslint", target: "apps/web", status: "not installed", errors: 0, warnings: 0, reason: "eslint isn't installed (xray doesn't install)" },
    ],
    rules: [
      { rule: "TS2322", count: 1 },
      { rule: "eslint:prefer-const", count: 1 },
    ],
  },
});

export function report(overrides: { commit?: string; generatedAt?: string; score?: number | null; name?: string; metrics?: MetricResult[] } = {}): QualityReport {
  const name = overrides.name ?? "shop";
  return {
    version: 1,
    repo: { path: `/repos/${name}`, name, commit: (overrides.commit ?? "abc1234").padEnd(40, "0"), branch: "main", dirty: false },
    generatedAt: overrides.generatedAt ?? "2026-11-01T10:00:00.000Z",
    score: overrides.score === undefined ? 77 : overrides.score,
    weights: { hotspots: 1, architecture: 1, dependencies: 1 },
    metrics: overrides.metrics ?? [hotspotsMetric(), architectureMetric(), unavailableMetric()],
  };
}

/** A Storage kept in memory; `full` makes every write fail like a full or blocked localStorage. */
export class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  constructor(private full = false) {}
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.full) throw new DOMException("quota exceeded", "QuotaExceededError");
    this.items.set(key, value);
  }
}

export const reportFile = (value: QualityReport | string, name = "report.json") =>
  new File([typeof value === "string" ? value : JSON.stringify(value)], name, { type: "application/json" });
