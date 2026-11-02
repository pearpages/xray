import { Node, type Identifier, type SourceFile } from "ts-morph";

/**
 * A top-level named function, class, or `const` holding a function or a call
 * (`memo(...)`, `lazy(...)`, HOCs): the things the walk connects. Top-level
 * object and array literals are units too (`kind: "table"`), because route
 * tables and screen registries are how many apps mount their components.
 */
export interface Unit {
  /** `path#name`, path relative to the analysed root. */
  id: string;
  file: string;
  name: string;
  node: Node;
  /** The top-level statement holding the unit. */
  statement: Node;
  /** Missing for anonymous default exports, which can only be reached through `import()`. */
  nameNode?: Identifier;
  isDefaultExport: boolean;
  kind: "code" | "table";
}

function isTable(initializer: Node | undefined): boolean {
  const value = initializer && Node.isAsExpression(initializer) ? initializer.getExpression() : initializer;
  return !!value && (Node.isObjectLiteralExpression(value) || Node.isArrayLiteralExpression(value));
}

function holdsFunction(initializer: Node | undefined): boolean {
  return (
    !!initializer &&
    (Node.isArrowFunction(initializer) ||
      Node.isFunctionExpression(initializer) ||
      Node.isCallExpression(initializer) ||
      Node.isClassExpression(initializer))
  );
}

/** Units of one file, in source order. */
export function unitsOf(sourceFile: SourceFile, file: string): Unit[] {
  const defaultName = defaultExportName(sourceFile);
  const units: Unit[] = [];
  const add = (
    name: string,
    node: Node,
    statement: Node,
    nameNode?: Identifier,
    kind: Unit["kind"] = "code",
    isDefault = false,
  ) =>
    units.push({
      id: `${file}#${name}`,
      file,
      name,
      node,
      statement,
      nameNode,
      isDefaultExport: isDefault || name === "default" || name === defaultName,
      kind,
    });

  for (const statement of sourceFile.getStatements()) {
    if (Node.isFunctionDeclaration(statement) || Node.isClassDeclaration(statement)) {
      const nameNode = statement.getNameNode();
      // `export default function Cart()` is the default export without an `export default Cart;`.
      // Read from the syntax: `isDefaultExport()` would start the type checker for every file.
      add(nameNode?.getText() ?? "default", statement, statement, nameNode, "code", statement.hasDefaultKeyword());
    } else if (Node.isVariableStatement(statement)) {
      for (const declaration of statement.getDeclarations()) {
        const nameNode = declaration.getNameNode();
        // Destructured declarations have no single name to follow.
        if (!Node.isIdentifier(nameNode)) continue;
        const initializer = declaration.getInitializer();
        if (holdsFunction(initializer)) add(nameNode.getText(), declaration, statement, nameNode);
        else if (isTable(initializer)) add(nameNode.getText(), declaration, statement, nameNode, "table");
      }
    } else if (Node.isExportAssignment(statement) && holdsFunction(statement.getExpression())) {
      add("default", statement, statement);
    }
  }
  return units;
}

/** `export default Cart;` or `export { Cart as default };` names an existing unit as the default export. */
function defaultExportName(sourceFile: SourceFile): string | undefined {
  for (const assignment of sourceFile.getExportAssignments()) {
    const expression = assignment.getExpression();
    if (!assignment.isExportEquals() && Node.isIdentifier(expression)) return expression.getText();
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    if (declaration.getModuleSpecifier()) continue;
    const named = declaration.getNamedExports().find((specifier) => specifier.getAliasNode()?.getText() === "default");
    if (named) return named.getNameNode().getText();
  }
  return undefined;
}

/** PascalCase (not ALL_CAPS): `MarketScreen`, `Cart`, but not `OPTIONS` or `listingsFor`. */
const COMPONENT_NAME = /^[A-Z][a-z0-9]/;

export function isComponentLike(unit: Unit): boolean {
  return unit.kind === "code" && (unit.isDefaultExport || COMPONENT_NAME.test(unit.name));
}

/**
 * Whether a unit of an entry-glob file may start a feature: a component, or, in a file
 * without components (`main.tsx`, a route file), a unit nothing in the code calls (`root`,
 * `GET`: the framework does). Helpers in those files, used by screens, are not.
 */
export function isEntryUnit(unit: Unit, fileUnits: Unit[], callers: () => number): boolean {
  if (isComponentLike(unit)) return true;
  return unit.kind === "code" && !fileUnits.some(isComponentLike) && callers() === 0;
}

/** Caches units per file and finds the unit enclosing a node. */
export class UnitIndex {
  private readonly byFile = new Map<SourceFile, Unit[]>();

  constructor(private readonly fileOf: (sourceFile: SourceFile) => string | undefined) {}

  of(sourceFile: SourceFile): Unit[] {
    let units = this.byFile.get(sourceFile);
    if (!units) {
      const file = this.fileOf(sourceFile);
      units = file === undefined ? [] : unitsOf(sourceFile, file);
      this.byFile.set(sourceFile, units);
    }
    return units;
  }

  /** The unit whose top-level statement contains `node`, if any. */
  at(node: Node): Unit | undefined {
    const sourceFile = node.getSourceFile();
    const top = node.getParentWhile((parent) => !Node.isSourceFile(parent)) ?? node;
    const candidates = this.of(sourceFile).filter((unit) => unit.statement === top);
    // `const a = …, b = …` share a statement: pick the declaration that contains the node.
    return (
      candidates.find((unit) => unit.node.containsRange(node.getPos(), node.getEnd())) ??
      candidates[0]
    );
  }

  defaultExportOf(sourceFile: SourceFile): Unit | undefined {
    return this.of(sourceFile).find((unit) => unit.isDefaultExport);
  }
}
