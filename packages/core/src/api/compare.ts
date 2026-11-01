import type { ExportedSymbol, ExportShape, Member, Param } from "./exports.js";

export type Compatibility = "compatible" | "review" | "breaking";

export interface ExportChange {
  name: string;
  change: "added" | "removed" | "changed";
  compatibility: Compatibility;
  /** Human-readable reasons, e.g. "new required parameter `currency`". */
  details: string[];
}

const RANK: Record<Compatibility, number> = { compatible: 0, review: 1, breaking: 2 };

export function worstOf(levels: Compatibility[]): Compatibility {
  return levels.reduce<Compatibility>((a, b) => (RANK[b] > RANK[a] ? b : a), "compatible");
}

interface Finding {
  level: Compatibility;
  detail: string;
}

function compareParams(before: Param[], after: Param[]): Finding[] {
  const findings: Finding[] = [];
  after.forEach((param, index) => {
    const old = before[index];
    if (!old) {
      findings.push(
        param.optional
          ? { level: "compatible", detail: `new optional parameter \`${param.name}\`` }
          : { level: "breaking", detail: `new required parameter \`${param.name}\`` },
      );
      return;
    }
    if (old.optional && !param.optional) findings.push({ level: "breaking", detail: `parameter \`${param.name}\` is now required` });
    if (!old.optional && param.optional) findings.push({ level: "compatible", detail: `parameter \`${param.name}\` is now optional` });
    if (old.type !== param.type) {
      findings.push({ level: "review", detail: `parameter \`${param.name}\` type \`${old.type || "?"}\` → \`${param.type || "?"}\`` });
    }
  });
  // Callers passing the removed arguments get "expected N arguments" errors.
  for (const old of before.slice(after.length)) {
    findings.push({ level: "breaking", detail: `parameter \`${old.name}\` removed` });
  }
  return findings;
}

/** `input`: members callers provide (props, options); adding a required one breaks them. */
function compareMembers(before: Member[], after: Member[], input: boolean): Finding[] {
  const findings: Finding[] = [];
  const old = new Map(before.map((member) => [member.name, member]));
  const now = new Map(after.map((member) => [member.name, member]));
  for (const member of before) {
    if (!now.has(member.name)) findings.push({ level: "breaking", detail: `\`${member.name}\` removed` });
  }
  for (const member of after) {
    const was = old.get(member.name);
    if (!was) {
      findings.push(
        member.optional
          ? { level: "compatible", detail: `new optional \`${member.name}\`` }
          : { level: input ? "breaking" : "review", detail: `new required \`${member.name}\`` },
      );
      continue;
    }
    if (was.optional && !member.optional) {
      findings.push({ level: input ? "breaking" : "review", detail: `\`${member.name}\` is now required` });
    }
    if (!was.optional && member.optional) findings.push({ level: "review", detail: `\`${member.name}\` is now optional` });
    if (was.type !== member.type) {
      findings.push({ level: "review", detail: `\`${member.name}\` type \`${was.type || "?"}\` → \`${member.type || "?"}\`` });
    }
  }
  return findings;
}

function compareShapes(before: ExportShape, after: ExportShape): Finding[] {
  if (before.kind !== after.kind) {
    return [{ level: "breaking", detail: `was a ${before.kind}, now a ${after.kind}` }];
  }
  switch (after.kind) {
    case "function": {
      const old = before as Extract<ExportShape, { kind: "function" }>;
      const findings =
        old.props && after.props ? compareMembers(old.props, after.props, true) : compareParams(old.params, after.params);
      if (old.returns !== after.returns) {
        findings.push({ level: "review", detail: `returns \`${old.returns || "?"}\` → \`${after.returns || "?"}\`` });
      }
      return findings;
    }
    case "type": {
      const old = before as Extract<ExportShape, { kind: "type" }>;
      if (old.members && after.members) return compareMembers(old.members, after.members, false);
      return old.text === after.text ? [] : [{ level: "review", detail: `\`${old.text}\` → \`${after.text}\`` }];
    }
    case "class":
    case "enum": {
      const old = before as Extract<ExportShape, { kind: "class" | "enum" }>;
      const removed = old.members.filter((member) => !after.members.includes(member));
      const added = after.members.filter((member) => !old.members.includes(member));
      return [
        ...removed.map((member) => ({ level: "breaking" as const, detail: `\`${member}\` removed` })),
        ...added.map((member) => ({ level: "compatible" as const, detail: `\`${member}\` added` })),
      ];
    }
    case "value": {
      const old = before as Extract<ExportShape, { kind: "value" }>;
      return old.type === after.type ? [] : [{ level: "review", detail: `type \`${old.type || "?"}\` → \`${after.type || "?"}\`` }];
    }
    case "re-export": {
      const old = before as Extract<ExportShape, { kind: "re-export" }>;
      return old.from === after.from && old.name === after.name
        ? []
        : [{ level: "review", detail: `now re-exported from \`${after.from}\`` }];
    }
    case "re-export-all":
      return [];
  }
}

export function compareExports(before: ExportedSymbol[], after: ExportedSymbol[]): ExportChange[] {
  const changes: ExportChange[] = [];
  const old = new Map(before.map((symbol) => [symbol.name, symbol]));
  const now = new Map(after.map((symbol) => [symbol.name, symbol]));
  for (const symbol of before) {
    if (!now.has(symbol.name)) {
      changes.push({ name: symbol.name, change: "removed", compatibility: "breaking", details: ["export removed"] });
    }
  }
  for (const symbol of after) {
    const was = old.get(symbol.name);
    if (!was) {
      changes.push({ name: symbol.name, change: "added", compatibility: "compatible", details: [] });
      continue;
    }
    const findings = compareShapes(was.shape, symbol.shape);
    if (findings.length === 0) continue;
    changes.push({
      name: symbol.name,
      change: "changed",
      compatibility: worstOf(findings.map((finding) => finding.level)),
      details: findings.map((finding) => finding.detail),
    });
  }
  return changes;
}
