// P1's check: packages/core knows nothing about GitHub or the CLI. Reads the core's own source as
// code (ts-morph), so comments and strings that merely mention these names don't count.
import { fileURLToPath } from "node:url";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import { describe, expect, it } from "vitest";

const CORE_SRC = fileURLToPath(new URL(".", import.meta.url));

/** Module specifiers that reach the CLI or the Action: by package name or by a relative path. */
const FORBIDDEN_MODULE = /^@xray\/(cli|action)(\/|$)|(^|\/)packages\/(cli|action)(\/|$)|^\.\.\/(\.\.\/)*(cli|action)\//;

/** Every place in `file` that breaks P1, as "line: reason". */
function boundaryViolations(file: SourceFile): string[] {
  const found: string[] = [];
  const at = (node: Node, reason: string) => found.push(`${node.getStartLineNumber()}: ${reason}`);
  const isProcessEnv = (node: Node) => node.getText().replace(/\s/g, "") === "process.env";

  // import … from "x", export … from "x", import("x"), require("x")
  for (const decl of [...file.getImportDeclarations(), ...file.getExportDeclarations()]) {
    const spec = decl.getModuleSpecifierValue();
    if (spec && FORBIDDEN_MODULE.test(spec)) at(decl, `imports ${spec}`);
  }
  for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    const [arg] = call.getArguments();
    if ((callee === "require" || callee === "import") && Node.isStringLiteral(arg) && FORBIDDEN_MODULE.test(arg.getLiteralValue()))
      at(call, `imports ${arg.getLiteralValue()}`);
  }

  // process.argv, process.env.GITHUB_X, process.env["GITHUB_X"], const { GITHUB_X } = process.env
  for (const access of file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const target = access.getExpression();
    if (target.getText() === "process" && access.getName() === "argv") at(access, "reads process.argv");
    if (isProcessEnv(target) && access.getName().startsWith("GITHUB_")) at(access, `reads ${access.getName()}`);
  }
  for (const access of file.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const key = access.getArgumentExpression();
    if (isProcessEnv(access.getExpression()) && Node.isStringLiteral(key) && key.getLiteralValue().startsWith("GITHUB_"))
      at(access, `reads ${key.getLiteralValue()}`);
  }
  for (const decl of file.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    const pattern = decl.getNameNode();
    if (!init || !isProcessEnv(init) || !Node.isObjectBindingPattern(pattern)) continue;
    for (const el of pattern.getElements()) {
      const key = el.getPropertyNameNode()?.getText() ?? el.getName();
      if (key.replace(/["']/g, "").startsWith("GITHUB_")) at(el, `reads ${key}`);
    }
  }

  // The GitHub API, called by URL
  for (const lit of [
    ...file.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...file.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ...file.getDescendantsOfKind(SyntaxKind.TemplateHead),
  ]) {
    if (/api\.github\.com/.test(lit.getText())) at(lit, "calls the GitHub API");
  }
  return found;
}

describe("P1: packages/core knows nothing about GitHub or the CLI", () => {
  it("no core source file imports the CLI or Action, reads process.argv or GITHUB_*, or calls the GitHub API", () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const files = project
      .addSourceFilesAtPaths(`${CORE_SRC}**/*.{ts,tsx}`)
      .filter((f) => !/\.test\.tsx?$/.test(f.getFilePath()) && !f.getFilePath().includes("/testing/"));
    expect(files.length).toBeGreaterThan(10);

    const violations = files.flatMap((f) => boundaryViolations(f).map((v) => `${f.getFilePath().slice(CORE_SRC.length)}:${v}`));
    expect(violations).toEqual([]);
  });

  it("catches every kind of violation, and ignores the same names in comments and strings", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const bad = project.createSourceFile(
      "bad.ts",
      [
        'import { run } from "@xray/cli";',
        'export { post } from "../../action/src/comment.js";',
        'const lazy = await import("@xray/action/dist/index.js");',
        "const args = process.argv.slice(2);",
        "const token = process.env.GITHUB_TOKEN;",
        'const repo = process.env["GITHUB_REPOSITORY"];',
        "const { GITHUB_SHA } = process.env;",
        'await fetch("https://api.github.com/repos/x/y");',
      ].join("\n"),
    );
    expect(boundaryViolations(bad)).toEqual([
      "1: imports @xray/cli",
      "2: imports ../../action/src/comment.js",
      "3: imports @xray/action/dist/index.js",
      "4: reads process.argv",
      "5: reads GITHUB_TOKEN",
      "6: reads GITHUB_REPOSITORY",
      "7: reads GITHUB_SHA",
      "8: calls the GitHub API",
    ]);

    const fine = project.createSourceFile(
      "fine.ts",
      [
        "// The CLI (@xray/cli) reads process.argv and GITHUB_TOKEN; the core never does.",
        'const doc = "set GITHUB_TOKEN, then run @xray/cli";',
        "const env = { ...process.env, CI: \"true\" };",
        "const home = process.env.HOME;",
      ].join("\n"),
    );
    expect(boundaryViolations(fine)).toEqual([]);
  });
});
