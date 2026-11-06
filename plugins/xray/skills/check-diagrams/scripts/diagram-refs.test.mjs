import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mermaidBlocks, parseFlowchart, pathTokens, scan } from "./diagram-refs.mjs";

let root;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/** A real git repository with these files tracked (principle P5). */
function repo(files) {
  root = mkdtempSync(join(tmpdir(), "diagram-refs-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  return root;
}

const fence = (body) => `# Doc\n\n\`\`\`mermaid\n${body}\n\`\`\`\n`;

describe("parseFlowchart", () => {
  it("reads labels, subgraph parents, chains, & and edge labels", () => {
    const { kind, nodes, edges } = parseFlowchart(
      [
        "flowchart TD",
        '  a["src/a.ts<br/>entry"] --> b["src/b.ts"] -->|writes| c[(Store)]',
        '  subgraph lib["src/lib/"]',
        '    x["x.ts"]',
        "  end",
        "  a & b --- x",
      ],
      10,
    );
    expect(kind).toBe("flowchart");
    expect(nodes.find((n) => n.id === "a")).toMatchObject({ label: "src/a.ts<br/>entry", line: 11 });
    expect(nodes.find((n) => n.id === "lib")).toMatchObject({ subgraph: true, label: "src/lib/" });
    expect(nodes.find((n) => n.id === "x").parent).toBe("lib");
    expect(edges.map((e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ""}`)).toEqual(["a>b", "b>c:writes", "a>x", "b>x"]);
  });

  it("returns only the kind of other diagrams", () => {
    expect(parseFlowchart(["sequenceDiagram", "  A->>B: hi"])).toEqual({ kind: "sequenceDiagram", nodes: [], edges: [] });
  });
});

describe("pathTokens", () => {
  it("finds files and folders, not markup or URLs", () => {
    expect(pathTokens("config.ts<br/>xray.config.json")).toEqual(["config.ts", "xray.config.json"]);
    expect(pathTokens("dependencies/<br/>graph · render")).toEqual(["dependencies/"]);
    expect(pathTokens("see https://example.com/a/b.ts")).toEqual([]);
  });

  it("finds the fences in a Markdown file", () => {
    expect(mermaidBlocks("x\n```mermaid\nflowchart TD\n  a --> b\n```\n")).toEqual([{ line: 3, body: ["flowchart TD", "  a --> b"] }]);
  });
});

describe("scan", () => {
  const files = {
    "src/app/main.ts": 'import { b } from "../lib/b";\n',
    "src/lib/b.ts": "export const b = 1;\n",
    "src/lib/c.ts": "export const c = 1;\n",
    "src/lib/b.test.ts": "",
    "docs/adr/0001-old.md": fence('flowchart TD\n  gone["src/gone.ts"]'),
  };

  it("resolves paths, relative to their subgraph too, and skips ADRs", () => {
    const result = scan(
      repo({
        ...files,
        "architecture.md": fence(
          ['flowchart TD', '  main["src/app/main.ts"]', '  subgraph lib["src/lib/"]', '    b["b.ts"]', "  end", '  old["src/old.ts"]', "  main --> lib"].join("\n"),
        ),
      }),
    );
    expect(result.summary).toMatchObject({ docs: 1, flowcharts: 1, refs: 4, missing: 1, ambiguous: 0 });
    const [diagram] = result.diagrams;
    expect(diagram.refs.find((r) => r.node === "b")).toMatchObject({ status: "ok", path: "src/lib/b.ts" });
    expect(diagram.refs.find((r) => r.node === "old")).toMatchObject({ status: "missing" });
    // Tests are never parts of a map.
    expect(diagram.notShown).toEqual([{ group: "lib", folder: "src/lib", missing: ["c.ts"] }]);
    expect(result.graph).toBe(false);
  });

  it("checks arrows against the import graph", () => {
    const dir = repo({
      ...files,
      "architecture.md": fence(['flowchart TD', '  main["src/app/main.ts"]', '  b["src/lib/b.ts"]', '  c["src/lib/c.ts"]', "  c --> main"].join("\n")),
    });
    const graphPath = join(dir, "graph.json");
    writeFileSync(
      graphPath,
      JSON.stringify({
        version: 1,
        modules: ["src/app/main.ts", "src/lib/b.ts", "src/lib/c.ts"],
        edges: [{ from: "src/app/main.ts", to: "src/lib/b.ts", typeOnly: false, dynamic: false }],
      }),
    );
    const [diagram] = scan(dir, { graphPath }).diagrams;
    expect(diagram.edges).toEqual([expect.objectContaining({ from: "c", to: "main", imports: "no" })]);
    expect(diagram.importsNotDrawn).toEqual([{ from: "main", to: "b", imports: 1 }]);
  });

  it("refuses a graph in another format", () => {
    const dir = repo(files);
    const graphPath = join(dir, "graph.json");
    writeFileSync(graphPath, JSON.stringify({ version: 2, edges: [] }));
    expect(() => scan(dir, { graphPath })).toThrow(/version 2/);
  });
});
