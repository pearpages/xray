import {
  Node,
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type ParameterDeclaration,
  type SourceFile,
  type TypeElementTypes,
} from "ts-morph";

export interface Member {
  name: string;
  optional: boolean;
  type: string;
}

export interface Param {
  name: string;
  /** Optional, defaulted or rest: callers may leave it out. */
  optional: boolean;
  type: string;
}

/**
 * What an export promises, read from the source text alone (no type checker), so the
 * base version parsed from `git show` and the PR version compare the same way.
 */
export type ExportShape =
  | { kind: "function"; params: Param[]; returns: string; props?: Member[] }
  | { kind: "type"; members?: Member[]; text: string }
  | { kind: "class"; members: string[] }
  | { kind: "enum"; members: string[] }
  | { kind: "value"; type: string }
  | { kind: "re-export"; from: string; name: string }
  | { kind: "re-export-all"; from: string };

export interface ExportedSymbol {
  /** Export name; `default`, or `* from ./x` for `export * from "./x"`. */
  name: string;
  shape: ExportShape;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function typeText(node: Node | undefined): string {
  return node ? squash(node.getText()) : "";
}

function membersOf(elements: TypeElementTypes[]): Member[] {
  return elements
    .filter((element) => Node.isPropertySignature(element) || Node.isMethodSignature(element))
    .map((element) => ({
      name: element.getName(),
      optional: element.hasQuestionToken(),
      type: Node.isPropertySignature(element)
        ? typeText(element.getTypeNode())
        : squash(element.getText().replace(/^[^(<]*/, "")),
    }));
}

/** Members of a type written in this file: a type literal, or an interface/alias declared here. */
function resolveMembers(node: Node | undefined, file: SourceFile): Member[] | undefined {
  if (!node) return undefined;
  if (Node.isTypeLiteral(node)) return membersOf(node.getMembers());
  if (Node.isTypeReference(node)) {
    const name = node.getTypeName().getText();
    const iface = file.getInterface(name);
    if (iface) return membersOf(iface.getMembers());
    const alias = file.getTypeAlias(name)?.getTypeNode();
    if (alias && Node.isTypeLiteral(alias)) return membersOf(alias.getMembers());
  }
  return undefined;
}

function param(parameter: ParameterDeclaration): Param {
  return {
    name: parameter.getName(),
    optional: parameter.hasQuestionToken() || parameter.hasInitializer() || parameter.isRestParameter(),
    type: typeText(parameter.getTypeNode()),
  };
}

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

function functionShape(fn: FunctionLike, file: SourceFile): ExportShape {
  const params = fn.getParameters();
  // A single object parameter whose type is written here: a component's props, or an options bag.
  const props = params.length === 1 ? resolveMembers(params[0]!.getTypeNode(), file) : undefined;
  return {
    kind: "function",
    params: params.map(param),
    returns: typeText(fn.getReturnTypeNode()),
    ...(props ? { props } : {}),
  };
}

/** Unwraps `memo(X)`, `forwardRef((p) => …)` and similar single-argument wrappers. */
function functionIn(initializer: Node | undefined): FunctionLike | undefined {
  if (!initializer) return undefined;
  if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) return initializer;
  if (Node.isCallExpression(initializer)) {
    const [first] = initializer.getArguments();
    return first && (Node.isArrowFunction(first) || Node.isFunctionExpression(first)) ? first : undefined;
  }
  return undefined;
}

function shapeOfDeclaration(node: Node, file: SourceFile): ExportShape | undefined {
  if (Node.isFunctionDeclaration(node)) return functionShape(node, file);
  if (Node.isInterfaceDeclaration(node)) {
    return { kind: "type", members: membersOf(node.getMembers()), text: "" };
  }
  if (Node.isTypeAliasDeclaration(node)) {
    const typeNode = node.getTypeNode();
    const members = typeNode && Node.isTypeLiteral(typeNode) ? membersOf(typeNode.getMembers()) : undefined;
    return { kind: "type", ...(members ? { members } : {}), text: members ? "" : typeText(typeNode) };
  }
  if (Node.isClassDeclaration(node)) {
    return {
      kind: "class",
      members: node
        .getMembers()
        .filter((member) => !("getScope" in member && member.getScope() === "private"))
        .filter((member) => !member.getText().startsWith("#"))
        .map((member) => squash(member.getText().split(/[({=;]/)[0] ?? "")),
    };
  }
  if (Node.isEnumDeclaration(node)) return { kind: "enum", members: node.getMembers().map((member) => member.getName()) };
  if (Node.isVariableDeclaration(node)) {
    const fn = functionIn(node.getInitializer());
    if (fn) return functionShape(fn, file);
    return { kind: "value", type: typeText(node.getTypeNode()) };
  }
  return undefined;
}

/** Exported symbols of a file, in source order. */
export function exportsOf(file: SourceFile): ExportedSymbol[] {
  const symbols: ExportedSymbol[] = [];
  const local = new Map<string, Node>();
  for (const statement of file.getStatements()) {
    if (Node.isVariableStatement(statement)) {
      for (const declaration of statement.getDeclarations()) local.set(declaration.getName(), declaration);
    } else if (Node.hasName(statement)) {
      local.set(statement.getName(), statement);
    }
  }

  for (const statement of file.getStatements()) {
    if (Node.isExportDeclaration(statement)) {
      const from = statement.getModuleSpecifierValue();
      if (!statement.hasNamedExports()) {
        const namespace = statement.getNamespaceExport()?.getName();
        symbols.push(
          namespace
            ? { name: namespace, shape: { kind: "re-export", from: from ?? "", name: "*" } }
            : { name: `* from ${from}`, shape: { kind: "re-export-all", from: from ?? "" } },
        );
        continue;
      }
      for (const specifier of statement.getNamedExports()) {
        const name = specifier.getAliasNode()?.getText() ?? specifier.getName();
        if (from) {
          symbols.push({ name, shape: { kind: "re-export", from, name: specifier.getName() } });
        } else {
          const shape = local.has(specifier.getName())
            ? shapeOfDeclaration(local.get(specifier.getName())!, file)
            : undefined;
          if (shape) symbols.push({ name, shape });
        }
      }
    } else if (Node.isExportAssignment(statement) && !statement.isExportEquals()) {
      const expression = statement.getExpression();
      const target = Node.isIdentifier(expression) ? local.get(expression.getText()) : undefined;
      const shape = target
        ? shapeOfDeclaration(target, file)
        : functionIn(expression)
          ? functionShape(functionIn(expression)!, file)
          : { kind: "value" as const, type: "" };
      if (shape) symbols.push({ name: "default", shape });
    } else if (Node.isVariableStatement(statement) && statement.isExported()) {
      for (const declaration of statement.getDeclarations()) {
        const shape = shapeOfDeclaration(declaration, file);
        if (shape) symbols.push({ name: declaration.getName(), shape });
      }
    } else if (
      (Node.isFunctionDeclaration(statement) ||
        Node.isClassDeclaration(statement) ||
        Node.isInterfaceDeclaration(statement) ||
        Node.isTypeAliasDeclaration(statement) ||
        Node.isEnumDeclaration(statement)) &&
      statement.isExported()
    ) {
      const shape = shapeOfDeclaration(statement, file);
      const name = statement.isDefaultExport() ? "default" : (statement.getName() ?? "default");
      if (shape) symbols.push({ name, shape });
    }
  }
  return symbols;
}
