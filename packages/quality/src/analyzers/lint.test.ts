import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GitFixture } from "../../../core/src/testing/git-fixture.js";
import { loadQualityConfig } from "../config.js";
import { codeFiles, git } from "../files.js";
import type { AnalyzerContext } from "../types.js";
import { lint, nearestDir, parseTscOutput, tsconfigsToCheck, typecheckConfig, type LintRun } from "./lint.js";

let fixture: GitFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});

const context = (root: string): AnalyzerContext => {
  const config = loadQualityConfig(root);
  return { root, config, codeFiles: codeFiles(root, config.ignore) };
};

const XRAY_MODULES = fileURLToPath(new URL("../../../../node_modules/", import.meta.url));

/** Installs the real ESLint and TypeScript in the fixture, as `npm i` would (ignored by git). */
function install(repo: GitFixture, ...packages: ("eslint" | "typescript")[]): GitFixture {
  mkdirSync(join(repo.root, "node_modules"), { recursive: true });
  for (const name of packages) symlinkSync(join(XRAY_MODULES, name), join(repo.root, "node_modules", name), "dir");
  return repo;
}

const ESLINT_CONFIG = (rules: Record<string, string>) => `export default [{ files: ["**/*.js"], rules: ${JSON.stringify(rules)} }];\n`;
const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, composite: true, incremental: true }, include: ["src"] });

const runs = (data: unknown) => (data as { runs: LintRun[] }).runs.map(({ tool, target, status, errors, warnings }) => ({ tool, target, status, errors, warnings }));

describe("lint and types", () => {
  it("runs ESLint on the scoped files only (--files)", async () => {
    const repo = install(
      (fixture = new GitFixture()
        .write({
          ".gitignore": "node_modules\n",
          "package.json": JSON.stringify({ type: "module" }),
          "eslint.config.js": ESLINT_CONFIG({ "no-unused-vars": "error" }),
          "scripts/a.js": "let a = 1;\n",
          "scripts/b.js": "let b = 1;\n",
        })
        .commit("base")),
      "eslint",
    );
    const config = loadQualityConfig(repo.root);
    config.lint.typescript = false;
    const result = await lint.analyze({ root: repo.root, config, codeFiles: codeFiles(repo.root, config.ignore), scope: (file) => file === "scripts/b.js" });
    expect(result.findings.map((finding) => finding.file)).toEqual(["scripts/b.js"]);
  });

  it("reports the project's ESLint errors and warnings and its TypeScript errors, writing nothing", async () => {
    const repo = install(
      (fixture = new GitFixture()
        .write({
          ".gitignore": "node_modules\n",
          "package.json": JSON.stringify({ type: "module" }),
          "eslint.config.js": ESLINT_CONFIG({ "no-unused-vars": "error", "prefer-const": "warn" }),
          "tsconfig.json": TSCONFIG,
          "scripts/build.js": "let unused = 1;\nlet name = 'x';\nconsole.log(name);\n",
          "src/a.ts": "export const a: number = 'one';\n",
        })
        .commit("base")),
      "eslint",
      "typescript",
    );
    const result = await lint.analyze(context(repo.root));

    expect(result.findings).toEqual([
      { file: "scripts/build.js", line: 1, severity: "medium", message: expect.stringMatching(/'unused' is assigned a value but never used.* \(no-unused-vars\)$/) },
      { file: "scripts/build.js", line: 1, severity: "low", message: expect.stringMatching(/\(prefer-const\)$/) },
      { file: "scripts/build.js", line: 2, severity: "low", message: expect.stringMatching(/\(prefer-const\)$/) },
      { file: "src/a.ts", line: 1, severity: "medium", message: "Type 'string' is not assignable to type 'number'. (TS2322)" },
    ]);
    expect(runs(result.data)).toEqual([
      { tool: "eslint", target: ".", status: "ok", errors: 1, warnings: 2 },
      { tool: "typescript", target: "tsconfig.json", status: "ok", errors: 1, warnings: 0 },
    ]);
    expect(result.summary).toBe("2 error(s) and 2 warning(s) from ESLint in ., tsc -p tsconfig.json.");
    expect(result.score).toBe(92); // 2 × 3 + 2 × 1 = 8 points; under 100 code files they count in full
    expect(git(repo.root, ["status", "--porcelain", "--ignored"])).toBe("!! node_modules/");
  });

  it("lints a folder with its own config from there only, and checks a solution's references", async () => {
    const repo = install(
      (fixture = new GitFixture()
        .write({
          ".gitignore": "node_modules\n",
          "package.json": JSON.stringify({ type: "module" }),
          "eslint.config.js": ESLINT_CONFIG({ "no-var": "error" }),
          "tools/x.js": "var x = 1;\nexport default x;\n",
          "apps/web/eslint.config.js": ESLINT_CONFIG({ "no-console": "warn" }),
          "apps/web/main.js": "var y = 1;\nconsole.log(y);\n",
          "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }, { path: "./packages/lib" }] }),
          "tsconfig.app.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }),
          "src/app.ts": "export const ok = 1;\n",
          "packages/lib/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["*.ts"] }),
          "packages/lib/index.ts": "export function f(x) { return x; }\n",
        })
        .commit("base")),
      "eslint",
      "typescript",
    );
    expect(tsconfigsToCheck(repo.root, "tsconfig.json")).toEqual(["tsconfig.app.json", "packages/lib/tsconfig.json"]);

    const result = await lint.analyze(context(repo.root));
    expect(result.findings.map((finding) => `${finding.file}:${finding.line} ${finding.severity} ${finding.message.match(/\((.+)\)$/)?.[1]}`)).toEqual([
      "tools/x.js:1 medium no-var",
      "apps/web/main.js:2 low no-console",
      "packages/lib/index.ts:1 medium TS7006",
    ]);
    expect(runs(result.data).map((run) => run.target)).toEqual([".", "apps/web", "packages/lib/tsconfig.json", "tsconfig.app.json"]);
  });

  it("is unavailable without configs, or when the project hasn't installed its tools", async () => {
    const bare = (fixture = new GitFixture().write({ "src/a.js": "export const a = 1;\n" }).commit("base"));
    expect((await lint.analyze(context(bare.root))).reason).toBe("no ESLint config or tsconfig.json");
    bare.dispose();

    const uninstalled = (fixture = new GitFixture().write({ "eslint.config.js": ESLINT_CONFIG({}), "tsconfig.json": TSCONFIG, "src/a.ts": "" }).commit("base"));
    expect((await lint.analyze(context(uninstalled.root))).reason).toBe(
      "eslint in .: eslint isn't installed (xray doesn't install); typescript in tsconfig.json: typescript isn't installed (xray doesn't install)",
    );
  });

  it("says when ESLint itself fails, and still reports TypeScript", async () => {
    const repo = install(
      (fixture = new GitFixture()
        .write({ ".gitignore": "node_modules\n", "package.json": JSON.stringify({ type: "module" }), "eslint.config.js": "export default [{ rules: { 'no-such-rule-anywhere': 'error' } }];\n", "tsconfig.json": TSCONFIG, "src/a.ts": "export const a = 1;\n" })
        .commit("base")),
      "eslint",
      "typescript",
    );
    const result = await lint.analyze(context(repo.root));
    expect(runs(result.data)[0]).toMatchObject({ tool: "eslint", status: "failed" });
    expect(result.summary).toBe("0 error(s) and 0 warning(s) from tsc -p tsconfig.json; 1 run(s) couldn't start (see data).");
    expect(result.score).toBe(100);
  });

  it("reads tsc's diagnostics, relative to the root", () => {
    const output = [
      "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      "  The expected type comes from here.",
      "/repo/pkg/b.ts(1,1): error TS1005: ';' expected.",
      "error TS5083: Cannot read file '/repo/base.json'.",
    ].join("\n");
    expect(parseTscOutput(output, "/repo/pkg", "/repo")).toEqual([
      { file: "pkg/src/a.ts", line: 3, code: "TS2322", message: "Type 'string' is not assignable to type 'number'." },
      { file: "pkg/b.ts", line: 1, code: "TS1005", message: "';' expected." },
      { file: "", code: "TS5083", message: "Cannot read file '/repo/base.json'." },
    ]);
  });
});

describe("lint and types in a workspace", () => {
  it("checks each package with the config its typecheck script names, and blames a file on its nearest tsconfig", async () => {
    const repo = install(
      (fixture = new GitFixture()
        .write({
          ".gitignore": "node_modules\n",
          // A root config that sees every file, without the app's alias: not how the app compiles.
          "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
          "tools/t.ts": "export const t: string = 1;\n",
          "apps/web/package.json": JSON.stringify({ scripts: { typecheck: "tsc --noEmit -p tsconfig.build.json" } }),
          "apps/web/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, paths: { "@/*": ["./*"] } } }),
          "apps/web/tsconfig.build.json": JSON.stringify({ extends: "./tsconfig.json", exclude: ["**/*.test.ts"] }),
          "apps/web/a.ts": 'import { b } from "@/b";\nexport const a = b;\n',
          "apps/web/b.ts": "export const b = 1;\n",
          "apps/web/a.test.ts": "export const broken: number = 'test';\n",
        })
        .commit("base")),
      "typescript",
    );
    expect(typecheckConfig(repo.root, "apps/web")).toBe("apps/web/tsconfig.build.json");
    expect(nearestDir("apps/web/a.ts", [".", "apps/web"])).toBe("apps/web");

    const result = await lint.analyze(context(repo.root));
    expect(runs(result.data)).toEqual([
      { tool: "typescript", target: "apps/web/tsconfig.build.json", status: "ok", errors: 0, warnings: 0 },
      { tool: "typescript", target: "tsconfig.json", status: "ok", errors: 1, warnings: 0 },
    ]);
    expect(result.findings).toEqual([{ file: "tools/t.ts", line: 1, severity: "medium", message: "Type 'number' is not assignable to type 'string'. (TS2322)" }]);
  });
});
