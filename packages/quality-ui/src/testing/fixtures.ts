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
