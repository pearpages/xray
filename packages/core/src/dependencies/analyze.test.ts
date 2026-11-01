import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzePullRequest, renderMarkdown, resolveConfig } from "../index.js";
import { isReExportOnly, MAX_BARREL_IMPORTERS, packageName, selectNeighbourhood, type Graph } from "./analyze.js";

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
    const wide: Graph = {
      modules: new Set(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]),
      edges: [
        { from: "a.ts", to: "b.ts", typeOnly: false, dynamic: false },
        { from: "c.ts", to: "b.ts", typeOnly: false, dynamic: false },
        { from: "a.ts", to: "d.ts", typeOnly: false, dynamic: false },
        { from: "a.ts", to: "e.ts", typeOnly: false, dynamic: false },
      ],
    };
    const changed = [
      { path: "a.ts", status: "modified" as const },
      { path: "c.ts", status: "modified" as const },
    ];
    const result = selectNeighbourhood(wide, changed, 4);
    // b.ts touches both changed modules; d.ts and e.ts one each, and only one of them fits.
    expect(result.level).toBe("file");
    expect(result.nodes.map((node) => node.id)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"]);
    expect(result.omittedNodes).toBe(1);
  });

  it("switches to folders when the changed modules alone would fill half the diagram", () => {
    const edge = (from: string, to: string) => ({ from, to, typeOnly: false, dynamic: false });
    const big: Graph = {
      modules: new Set(["ui/A.tsx", "ui/B.tsx", "ui/C.tsx", "lib/x.ts", "lib/y.ts"]),
      edges: [edge("ui/A.tsx", "lib/x.ts"), edge("ui/B.tsx", "lib/x.ts"), edge("ui/C.tsx", "lib/y.ts")],
    };
    const changed = ["ui/A.tsx", "ui/B.tsx", "ui/C.tsx"].map((path) => ({ path, status: "modified" as const }));
    const result = selectNeighbourhood(big, changed, 4);
    expect(result.level).toBe("folder");
    expect(result.nodes).toEqual([
      { id: "lib/*", kind: "group", count: 2, changedCount: 0 },
      { id: "ui/*", kind: "group", count: 3, changedCount: 3, change: "modified" },
    ]);
    expect(result.edges).toEqual([edge("ui/*", "lib/*")]);
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

describe("barrels", () => {
  const edge = (from: string, to: string) => ({ from, to, typeOnly: false, dynamic: false });
  const isBarrel = (path: string) => path.endsWith("index.ts");

  it("brings a barrel's importers one hop further", () => {
    const graph: Graph = {
      modules: new Set(["pkg/cart.ts", "pkg/index.ts", "app/Cart.tsx"]),
      edges: [edge("pkg/index.ts", "pkg/cart.ts"), edge("app/Cart.tsx", "pkg/index.ts")],
    };
    const result = selectNeighbourhood(graph, [{ path: "pkg/cart.ts", status: "modified" }], 60, isBarrel);
    expect(result.nodes).toEqual([
      { id: "app/Cart.tsx", kind: "source" },
      { id: "pkg/cart.ts", kind: "source", change: "modified" },
      { id: "pkg/index.ts", kind: "source", barrel: true },
    ]);
    expect(result.edges).toContainEqual(edge("app/Cart.tsx", "pkg/index.ts"));
  });

  it("groups a barrel's importers per folder past MAX_BARREL_IMPORTERS", () => {
    const screens = Array.from({ length: MAX_BARREL_IMPORTERS + 1 }, (_, i) => `app/screens/S${i}.tsx`);
    const graph: Graph = {
      modules: new Set(["pkg/cart.ts", "pkg/index.ts", "app/App.tsx", ...screens]),
      edges: [
        edge("pkg/index.ts", "pkg/cart.ts"),
        edge("app/App.tsx", "pkg/index.ts"),
        ...screens.map((screen) => edge(screen, "pkg/index.ts")),
      ],
    };
    const result = selectNeighbourhood(graph, [{ path: "pkg/cart.ts", status: "modified" }], 60, isBarrel);
    expect(result.nodes.filter((node) => node.kind === "group")).toEqual([
      { id: "app/*", kind: "group", count: 1 },
      { id: "app/screens/*", kind: "group", count: MAX_BARREL_IMPORTERS + 1 },
    ]);
    expect(result.edges).toContainEqual(edge("app/screens/*", "pkg/index.ts"));
  });

  it("recognises a barrel by its statements", () => {
    expect(isReExportOnly('// the package API\nexport * from "./cart";\nexport { total as sum } from "./total";\n')).toBe(true);
    expect(isReExportOnly('export * from "./cart";\nexport const extra = 1;\n')).toBe(false);
    expect(isReExportOnly("")).toBe(false);
  });
});
