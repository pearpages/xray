import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzePullRequest, renderMarkdown, resolveConfig } from "../index.js";
import { packageName, selectNeighbourhood, type Graph } from "./analyze.js";

describe("packageName", () => {
  it("keeps the package part of a specifier", () => {
    expect(packageName("react-dom/client")).toBe("react-dom");
    expect(packageName("@tanstack/react-query/x")).toBe("@tanstack/react-query");
    expect(packageName("node:fs")).toBe("fs");
  });
});

describe("selectNeighbourhood", () => {
  const graph: Graph = {
    modules: new Set(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]),
    edges: [
      { from: "a.ts", to: "b.ts", typeOnly: false, dynamic: false },
      { from: "c.ts", to: "b.ts", typeOnly: true, dynamic: false },
      { from: "b.ts", to: "d.ts", typeOnly: false, dynamic: false },
      { from: "d.ts", to: "e.ts", typeOnly: false, dynamic: false },
    ],
  };

  it("keeps the changed module, its dependencies and its dependents only", () => {
    const result = selectNeighbourhood(graph, [{ path: "b.ts", status: "modified" }], 60);
    expect(result.nodes.map((node) => node.id)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    expect(result.edges).toHaveLength(3);
    expect(result.omittedNodes).toBe(0);
  });

  it("reports files that are not in the graph", () => {
    const result = selectNeighbourhood(graph, [{ path: "README.md", status: "modified" }], 60);
    expect(result.nodes).toEqual([]);
    expect(result.outsideGraph).toEqual([{ path: "README.md", status: "modified" }]);
  });

  it("drops the least connected neighbours past maxNodes", () => {
    const changed = [
      { path: "a.ts", status: "modified" as const },
      { path: "c.ts", status: "modified" as const },
      { path: "d.ts", status: "modified" as const },
    ];
    const result = selectNeighbourhood(graph, changed, 4);
    // b.ts touches all three changed modules, e.ts only one.
    expect(result.nodes.map((node) => node.id)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    expect(result.omittedNodes).toBe(1);
  });
});

describe("analyzePullRequest (git fixture)", () => {
  let repo: string;
  const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "xray-"));
    run("init", "-q", "-b", "main");
    run("config", "user.email", "test@example.com");
    run("config", "user.name", "test");
    write("tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }));
    write("src/lib/format.ts", 'export const format = (n: number) => n.toFixed(2);\n');
    write("src/lib/types.ts", "export type Price = { amount: number };\n");
    write("src/components/Price.tsx",
      'import { format } from "@/lib/format";\nimport type { Price as P } from "../lib/types";\n' +
      "export const Price = ({ amount }: P) => <span>{format(amount)}</span>;\n");
    write("src/pages/Cart.tsx", 'import { Price } from "../components/Price";\nexport const Cart = () => <Price amount={1} />;\n');
    write("src/pages/Unrelated.tsx", "export const Unrelated = () => null;\n");
    run("add", ".");
    run("commit", "-q", "-m", "base");
    run("checkout", "-q", "-b", "feature");
    write("src/components/Price.tsx",
      'import { format } from "@/lib/format";\nimport type { Price as P } from "../lib/types";\n' +
      "export const Price = ({ amount }: P) => <strong>{format(amount)}</strong>;\n");
    write("src/components/Price.test.tsx", 'import { Price } from "./Price";\nPrice;\n');
    write("docs/notes.md", "notes\n");
    run("add", ".");
    run("commit", "-q", "-m", "change price");
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("graphs the changed component with its direct neighbours", async () => {
    const result = await analyzePullRequest({ cwd: repo, base: "main", config: resolveConfig(repo) });
    const { nodes, edges, outsideGraph } = result.dependencies;

    expect(nodes).toEqual([
      { id: "src/components/Price.test.tsx", kind: "test", change: "added" },
      { id: "src/components/Price.tsx", kind: "source", change: "modified" },
      { id: "src/lib/format.ts", kind: "source" },
      { id: "src/lib/types.ts", kind: "source" },
      { id: "src/pages/Cart.tsx", kind: "source" },
    ]);
    expect(edges).toContainEqual({ from: "src/components/Price.tsx", to: "src/lib/format.ts", typeOnly: false, dynamic: false });
    expect(edges).toContainEqual({ from: "src/components/Price.tsx", to: "src/lib/types.ts", typeOnly: true, dynamic: false });
    expect(outsideGraph).toEqual([{ path: "docs/notes.md", status: "added" }]);

    const markdown = renderMarkdown(result);
    expect(markdown).toContain("<!-- xray:report -->");
    expect(markdown).toContain("```mermaid\nflowchart LR");
    expect(markdown).not.toContain("Unrelated");
  });

  it("reports the given head instead of HEAD", async () => {
    const result = await analyzePullRequest({ cwd: repo, base: "main", head: "abc1234def" });
    expect(result.meta.head).toBe("abc1234def");
    expect(renderMarkdown(result)).toContain("Comparing `abc1234` with `main`");
  });

  it("fails clearly when the base branch does not exist", async () => {
    await expect(analyzePullRequest({ cwd: repo, base: "nope" })).rejects.toThrow(/fetch-depth: 0/);
  });
});
