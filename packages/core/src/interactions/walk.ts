import { Node, SyntaxKind, type CallExpression, type Project, type SourceFile } from "ts-morph";
import type { Unit, UnitIndex } from "./units.js";

export type RelationKind = "renders" | "uses" | "calls" | "lazy-loads" | "mounts" | "reads";

export interface Interaction {
  from: string;
  to: string;
  kind: RelationKind;
  /** Position of the reference inside `from`, so diagrams follow source order. */
  order: number;
}

interface Link {
  unit: Unit;
  kind: RelationKind;
  order: number;
}

/** References that are not interactions: imports, exports, types, declarations. */
const NOT_A_USE = new Set([
  SyntaxKind.ImportSpecifier,
  SyntaxKind.ImportClause,
  SyntaxKind.NamespaceImport,
  SyntaxKind.ExportSpecifier,
  SyntaxKind.ExportAssignment,
  SyntaxKind.TypeReference,
  SyntaxKind.TypeQuery,
  SyntaxKind.ExpressionWithTypeArguments,
  SyntaxKind.JsxClosingElement,
  SyntaxKind.QualifiedName,
]);

/** How the code at `reference` uses what it names, or undefined if it doesn't use it. */
export function classify(reference: Node): RelationKind | undefined {
  const parent = reference.getParent();
  if (!parent || NOT_A_USE.has(parent.getKind())) return undefined;
  if (
    (Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent)) &&
    parent.getTagNameNode() === reference
  ) {
    return "renders";
  }
  if ((Node.isCallExpression(parent) || Node.isNewExpression(parent)) && parent.getExpression() === reference) {
    return /^use[A-Z0-9]/.test(reference.getText()) ? "uses" : "calls";
  }
  // `{ PlayerScreen }` passes the unit as a value, like `{ player: PlayerScreen }`.
  if (Node.isShorthandPropertyAssignment(parent)) return "mounts";
  // The name being declared, or `obj.name` where the unit only shares the property's name.
  if (Node.hasName(parent) && parent.getNameNode() === reference) return undefined;
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === reference) return undefined;
  return "mounts";
}

/** Everything the walk needs to know about the project, built once per run. */
export class Walker {
  /** Every import("…") call into the analysed code, with the file it loads. */
  private readonly dynamicImports: { call: CallExpression; target: SourceFile }[] = [];
  private readonly callersCache = new Map<string, Link[]>();

  constructor(
    project: Project,
    resolveModule: (specifier: string, containingFile: string) => string | undefined,
    private readonly units: UnitIndex,
    private readonly fileOf: (sourceFile: SourceFile) => string | undefined,
    /** Files whose references don't count (tests, stories, ignored globs). */
    private readonly ignored: (file: string) => boolean,
  ) {
    for (const sourceFile of project.getSourceFiles()) {
      const from = fileOf(sourceFile);
      if (from === undefined || ignored(from)) continue;
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const target = this.importTarget(call, resolveModule);
        if (target) this.dynamicImports.push({ call, target });
      }
    }
  }

  private importTarget(
    call: CallExpression,
    resolveModule: (specifier: string, containingFile: string) => string | undefined,
  ): SourceFile | undefined {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) return undefined;
    const [argument] = call.getArguments();
    if (!argument || !Node.isStringLiteral(argument)) return undefined;
    const fileName = resolveModule(argument.getLiteralText(), call.getSourceFile().getFilePath());
    const target = fileName ? call.getProject().getSourceFile(fileName) : undefined;
    return target && this.fileOf(target) !== undefined ? target : undefined;
  }

  private usable(unit: Unit | undefined, from: Unit): unit is Unit {
    return !!unit && unit.id !== from.id && !this.ignored(unit.file);
  }

  /** Units that render, call, use, mount or lazy-load `unit`. */
  callersOf(unit: Unit): Link[] {
    const cached = this.callersCache.get(unit.id);
    if (cached) return cached;
    const links: Link[] = [];
    for (const reference of unit.nameNode?.findReferencesAsNodes() ?? []) {
      const file = this.fileOf(reference.getSourceFile());
      if (file === undefined || this.ignored(file)) continue;
      const classified = classify(reference);
      // Using a lookup table as a value means reading it (`SCREENS[key]`), not mounting it.
      const kind = classified === "mounts" && unit.kind === "table" ? "reads" : classified;
      const caller = kind && this.units.at(reference);
      if (kind && this.usable(caller, unit)) links.push({ unit: caller, kind, order: reference.getStart() });
    }
    if (unit.isDefaultExport) {
      for (const { call, target } of this.dynamicImports) {
        if (target !== unit.node.getSourceFile()) continue;
        const caller = this.units.at(call);
        if (this.usable(caller, unit)) links.push({ unit: caller, kind: "lazy-loads", order: call.getStart() });
      }
    }
    this.callersCache.set(unit.id, dedupe(links));
    return this.callersCache.get(unit.id)!;
  }

  /** Units that `unit` renders, calls, uses, mounts or lazy-loads, in source order. */
  calleesOf(unit: Unit): Link[] {
    const links: Link[] = [];
    for (const identifier of unit.node.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (identifier === unit.nameNode) continue;
      const kind = classify(identifier);
      if (!kind) continue;
      const symbol = identifier.getSymbol();
      const target = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
      const declaration = target?.getDeclarations()[0];
      if (!declaration) continue;
      const file = this.fileOf(declaration.getSourceFile());
      if (file === undefined) continue;
      const callee = this.units.at(declaration);
      // Tables only matter on the way up (who mounts the unit); below a unit they are just data.
      if (this.usable(callee, unit) && callee.kind === "code") {
        links.push({ unit: callee, kind, order: identifier.getStart() });
      }
    }
    for (const { call, target } of this.dynamicImports) {
      if (call.getSourceFile() !== unit.node.getSourceFile()) continue;
      if (!unit.node.containsRange(call.getPos(), call.getEnd())) continue;
      const callee = this.units.defaultExportOf(target);
      if (this.usable(callee, unit)) links.push({ unit: callee, kind: "lazy-loads", order: call.getStart() });
    }
    return dedupe(links).sort((a, b) => a.order - b.order);
  }
}

/** One link per unit; a stronger relation wins over `mounts` (e.g. `memo(X)` then `<X />`). */
function dedupe(links: Link[]): Link[] {
  const byUnit = new Map<string, Link>();
  for (const link of links) {
    const existing = byUnit.get(link.unit.id);
    if (!existing || (existing.kind === "mounts" && link.kind !== "mounts")) byUnit.set(link.unit.id, link);
  }
  return [...byUnit.values()];
}

export interface UpWalk {
  interactions: Interaction[];
  /** Where the walk stopped: entry points, hubs, or units nothing else uses. */
  roots: string[];
  /** Hubs the walk stopped at, with every unit that uses them. */
  hubs: Map<string, string[]>;
}

/** From a touched unit up through its callers until entry points (or `maxDepth`). */
export function walkUp(
  walker: Walker,
  start: Unit,
  isEntry: (unit: Unit) => boolean,
  maxDepth: number,
  /** Stop at units with more callers than this; undefined never stops. */
  hubCallers?: number,
): UpWalk {
  const interactions: Interaction[] = [];
  const roots = new Set<string>();
  const hubs = new Map<string, string[]>();
  const seen = new Set<string>();
  const queue: [Unit, number][] = [[start, 0]];
  while (queue.length > 0) {
    const [unit, depth] = queue.shift()!;
    if (seen.has(unit.id)) continue;
    seen.add(unit.id);
    if (isEntry(unit)) {
      roots.add(unit.id);
      continue;
    }
    const callers = walker.callersOf(unit);
    if (callers.length === 0 || depth >= maxDepth) {
      roots.add(unit.id);
      continue;
    }
    if (hubCallers !== undefined && callers.length > hubCallers) {
      roots.add(unit.id);
      hubs.set(unit.id, callers.map((caller) => caller.unit.id));
      continue;
    }
    for (const caller of callers) {
      interactions.push({ from: caller.unit.id, to: unit.id, kind: caller.kind, order: caller.order });
      queue.push([caller.unit, depth + 1]);
    }
  }
  return { interactions, roots: [...roots], hubs };
}

export interface DownWalk {
  interactions: Interaction[];
  /** Callees left out per unit because of `maxCallees`. */
  hidden: Map<string, number>;
}

/** From a touched unit down through what it uses, `maxDepth` levels, `maxCallees` per unit. */
export function walkDown(walker: Walker, start: Unit, maxDepth: number, maxCallees: number): DownWalk {
  const interactions: Interaction[] = [];
  const hidden = new Map<string, number>();
  const seen = new Set<string>([start.id]);
  let level = [start];
  for (let depth = 0; depth < maxDepth && level.length > 0; depth++) {
    const next: Unit[] = [];
    for (const unit of level) {
      const callees = walker.calleesOf(unit);
      if (callees.length > maxCallees) hidden.set(unit.id, callees.length - maxCallees);
      for (const callee of callees.slice(0, maxCallees)) {
        interactions.push({ from: unit.id, to: callee.unit.id, kind: callee.kind, order: callee.order });
        if (!seen.has(callee.unit.id)) {
          seen.add(callee.unit.id);
          next.push(callee.unit);
        }
      }
    }
    level = next;
  }
  return { interactions, hidden };
}
