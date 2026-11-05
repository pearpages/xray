import type { TestEvidence } from "./analyze.js";

/** Free of ts-morph, so renderers and the agent format can use it. */
export type Light = "green" | "yellow" | "red";

const ORDER: Record<Light, number> = { green: 0, yellow: 1, red: 2 };

export function worst(lights: Light[]): Light {
  return lights.reduce<Light>((a, b) => (ORDER[b] > ORDER[a] ? b : a), "green");
}

/** Coverage counts like the static kinds: all changed lines run = direct, some = indirect, none = none. */
export function evidenceStrength(evidence: TestEvidence): Exclude<TestEvidence["kind"], "coverage"> {
  if (evidence.kind !== "coverage") return evidence.kind;
  if (evidence.covered === 0) return "none";
  return evidence.covered === evidence.total ? "direct" : "indirect";
}
