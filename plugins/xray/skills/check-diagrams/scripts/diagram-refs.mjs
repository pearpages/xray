#!/usr/bin/env node
// diagram-refs.mjs: check the code maps in a repository's Markdown against its files and imports.
//
// Language-agnostic and dependency-free. Finds every ```mermaid flowchart in tracked Markdown
// (accepted ADRs are history and are skipped), reads the files and folders its node labels name,
// and resolves each against `git ls-files`. With --graph (xray-quality -f graph output) it also
// checks each arrow between two resolved nodes against the real imports.
//
// Usage:
//   node diagram-refs.mjs [root] [--files a.md b.md …] [--graph graph.json]
//
// Prints JSON: { version: 1, root, graph, diagrams: [...], summary }. Facts only: the skill
// judges which findings are real drift.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "vendor", ".next"]);
const SKIPPED_DOCS = /^(docs\/adr|docs\/decisions|adr)\//i;
const CODE_EXT =
  "ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|astro|py|go|rs|rb|java|kt|kts|scala|swift|cs|fs|php|ex|exs|c|h|cc|cpp|hpp|dart|lua|sh|sql|json|ya?ml|toml|tf|md|html|css|scss";
// A path: segments joined by "/", optionally ending in "/"; or a bare file name with a known extension.
const PATH_TOKEN = new RegExp(String.raw`(?:@?[\w.-]+/)+[\w.*-]*|\w[\w.-]*\.(?:${CODE_EXT})\b`, "g");
const NODE = /([A-Za-z_][\w]*)\s*(\[\(|\(\[|\[\[|\(\(\(|\(\(|\{\{|\[\/|\[\\|\[|\(|\{|>)\s*(?:"([^"]*)"|([^\]\)\}"|]*))\s*(?:\]\]|\)\]|\]\)|\)\)\)|\)\)|\}\}|\/\]|\\\]|\]|\)|\})/g;
const CODE_FILE = new RegExp(String.raw`\.(?:${CODE_EXT})$`);
// Tests, stories, fixtures and generated files are never parts of a code map.
const NOT_A_PART = /(^|\/)(__tests__|__mocks__|__snapshots__|testing|fixtures)\/|\.(test|spec|stories)\.|\.d\.ts$/;
const ARROW = /\s*(?:<)?(?:-{2,}|={2,}|-\.+-)(?:>|x|o)?(?:\|([^|]*)\|)?\s*/;

function git(cwd, args) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function trackedFiles(root) {
  try {
    return git(root, ["ls-files"]).split("\n").filter(Boolean);
  } catch {
    const out = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else out.push(relative(root, path).split("\\").join("/"));
      }
    };
    walk(root);
    return out;
  }
}

/** Workspace package names (`@scope/pkg` in a package.json) → their folder. */
function packageNames(root, files) {
  const names = new Map();
  for (const file of files.filter((f) => f === "package.json" || f.endsWith("/package.json"))) {
    if (file.includes("node_modules/")) continue;
    try {
      const { name } = JSON.parse(readFileSync(join(root, file), "utf8"));
      if (typeof name === "string") names.set(name, dirname(file) === "." ? "" : dirname(file));
    } catch {
      // Unreadable manifest: its name just won't resolve.
    }
  }
  return names;
}

/** Mermaid fences in one Markdown file: `{ line, body }`, line 1-based at the first body line. */
export function mermaidBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```\s*mermaid\s*$/.test(lines[i])) continue;
    const start = i + 1;
    let end = start;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end++;
    blocks.push({ line: start + 1, body: lines.slice(start, end) });
    i = end;
  }
  return blocks;
}

/** Nodes and edges of one flowchart block. Other diagram kinds return only their kind. */
export function parseFlowchart(bodyLines, firstLine = 1) {
  const header = bodyLines.find((line) => line.trim() && !line.trim().startsWith("%%"))?.trim() ?? "";
  const kind = header.split(/\s+/)[0] ?? "";
  if (kind !== "flowchart" && kind !== "graph") return { kind, nodes: [], edges: [] };
  const nodes = new Map();
  const edges = [];
  const groups = [];
  const define = (id, label, line) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, line, ...(groups.length ? { parent: groups.at(-1) } : {}) });
    else if (!nodes.get(id).label && label) Object.assign(nodes.get(id), { label, line });
  };
  bodyLines.forEach((raw, index) => {
    const line = raw.replace(/%%.*$/, "");
    const lineNo = firstLine + index;
    const trimmed = line.trim();
    if (trimmed === "end") {
      groups.pop();
      return;
    }
    if (!trimmed || trimmed === header || /^(classDef|class|style|linkStyle|click|direction)\b/.test(trimmed)) return;
    const opensGroup = /^\s*subgraph\b/.test(line);
    // Node shapes become bare ids, so the rest of the line is ids and arrows.
    if (opensGroup) {
      const rest = line.replace(/^\s*subgraph\s+/, "");
      const match = /^([A-Za-z_]\w*)\s*(?:\[\s*(?:"([^"]*)"|([^\]]*))\s*\])?/.exec(rest.trim());
      const id = match?.[1] ?? rest.trim();
      define(id, (match?.[2] ?? match?.[3] ?? "").trim(), lineNo);
      nodes.get(id).subgraph = true;
      groups.push(id);
      return;
    }
    const skeleton = line.replace(NODE, (_match, id, _open, quoted, plain) => {
      define(id, (quoted ?? plain ?? "").trim(), lineNo);
      return id;
    });
    const body = skeleton;
    // "a -- text --> b" carries its label between the dashes: drop it.
    const parts = body.replace(/--\s+[^->|][^>]*?\s+-->/g, "-->").split(ARROW);
    // split() with a capture group interleaves ids and labels: [ids, label, ids, label, ids…].
    if (parts.length < 3) {
      for (const id of (parts[0] ?? "").split("&").map((s) => s.trim()).filter(Boolean)) {
        if (/^[A-Za-z_]\w*$/.test(id)) define(id, "", lineNo);
      }
      return;
    }
    for (let p = 0; p + 2 < parts.length; p += 2) {
      const froms = parts[p].split("&").map((s) => s.trim()).filter((s) => /^[A-Za-z_]\w*$/.test(s));
      const tos = parts[p + 2].split("&").map((s) => s.trim()).filter((s) => /^[A-Za-z_]\w*$/.test(s));
      const label = parts[p + 1]?.trim() || undefined;
      for (const from of froms) {
        for (const to of tos) {
          for (const id of [from, to]) define(id, "", lineNo);
          edges.push({ from, to, ...(label ? { label } : {}), line: lineNo });
        }
      }
    }
  });
  return { kind, nodes: [...nodes.values()], edges };
}

/** Path-like tokens in a label, without trailing punctuation; URLs are not paths. */
export function pathTokens(label) {
  if (!label) return [];
  const tokens = [];
  for (const match of label.replace(/<[^>]*>/g, " ").replace(/\S+:\/\/\S+/g, " ").matchAll(PATH_TOKEN)) {
    const token = match[0].replace(/[.:,;]+$/, "").replace(/^\.\//, "");
    if (token && token !== "/" && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

function commonPrefix(a, b) {
  const x = a.split("/");
  const y = b.split("/");
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return n;
}

function makeResolver(files, packages) {
  const folders = new Set();
  for (const file of files) {
    let dir = dirname(file);
    while (dir && dir !== ".") {
      folders.add(dir);
      dir = dirname(dir);
    }
  }
  const fileSet = new Set(files);
  return (token, context) => {
    if (token.startsWith("@") || packages.has(token)) {
      const name = token.split("/").slice(0, token.startsWith("@") ? 2 : 1).join("/");
      if (packages.has(name)) {
        const rest = token.slice(name.length).replace(/^\//, "");
        const base = packages.get(name);
        return { kind: "package", candidates: [rest ? join(base, rest) : base].map((p) => p.replace(/\/$/, "")) };
      }
    }
    const wantsFolder = token.endsWith("/");
    const path = token.replace(/\/+$/, "");
    if (token.includes("*")) return { kind: "glob", candidates: [] };
    if (context !== undefined) {
      const inside = context ? `${context}/${path}` : path;
      if (!wantsFolder && fileSet.has(inside)) return { kind: "file", candidates: [inside] };
      if (folders.has(inside)) return { kind: "folder", candidates: [inside] };
    }
    if (!wantsFolder && fileSet.has(path)) return { kind: "file", candidates: [path] };
    if (folders.has(path)) return { kind: "folder", candidates: [path] };
    const suffix = `/${path}`;
    const fileHits = wantsFolder ? [] : files.filter((f) => f.endsWith(suffix));
    const folderHits = [...folders].filter((f) => f.endsWith(suffix));
    return fileHits.length > 0 ? { kind: "file", candidates: fileHits } : { kind: "folder", candidates: folderHits };
  };
}

function loadGraph(path) {
  const graph = JSON.parse(readFileSync(path, "utf8"));
  if (graph.version !== 1 || !Array.isArray(graph.edges)) throw new Error(`unsupported graph file: version ${graph.version}`);
  return graph;
}

const under = (module, path) => module === path || module.startsWith(`${path}/`) || path === "";

/** Scan a repository's code maps. */
export function scan(root, { files: only, graphPath } = {}) {
  root = resolve(root);
  const files = trackedFiles(root);
  const packages = packageNames(root, files);
  const resolveToken = makeResolver(files, packages);
  const graph = graphPath ? loadGraph(graphPath) : undefined;
  const docs = only
    ? only.map((f) => relative(root, resolve(root, f)).split("\\").join("/"))
    : files.filter((f) => f.toLowerCase().endsWith(".md") && !SKIPPED_DOCS.test(f));

  const diagrams = [];
  for (const doc of docs) {
    const abs = join(root, doc);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    for (const block of mermaidBlocks(readFileSync(abs, "utf8"))) {
      const { kind, nodes, edges } = parseFlowchart(block.body, block.line);
      if (nodes.length === 0) {
        diagrams.push({ file: doc, line: block.line, kind, checked: false });
        continue;
      }
      // Nodes inside a subgraph name paths relative to it, so parents resolve first.
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const depth = (node) => (node.parent && byId.has(node.parent) ? 1 + depth(byId.get(node.parent)) : 0);
      const sure = nodes.flatMap((node) => pathTokens(node.label).map((text) => resolveToken(text)))
        .filter((r) => r.candidates.length === 1)
        .map((r) => r.candidates[0]);
      const refs = [];
      const nodePath = new Map();
      const contextOf = (node) => {
        for (let parent = byId.get(node.parent); parent; parent = byId.get(parent.parent)) {
          if (nodePath.has(parent.id)) return nodePath.get(parent.id);
        }
        return undefined;
      };
      for (const node of [...nodes].sort((a, b) => depth(a) - depth(b))) {
        for (const text of pathTokens(node.label)) {
          const ref = { node: node.id, text, ...resolveToken(text, contextOf(node)) };
          if (ref.kind === "glob") ref.status = "glob";
          else if (ref.candidates.length === 0) ref.status = "missing";
          else if (ref.candidates.length === 1) [ref.status, ref.path] = ["ok", ref.candidates[0]];
          else {
            const score = (c) => Math.max(0, ...sure.map((s) => commonPrefix(c, s)));
            const best = Math.max(...ref.candidates.map(score));
            const top = ref.candidates.filter((c) => score(c) === best);
            if (best > 0 && top.length === 1) [ref.status, ref.path] = ["ok", top[0]];
            else ref.status = "ambiguous";
          }
          if (ref.status !== "ambiguous") delete ref.candidates;
          else ref.candidates = ref.candidates.slice(0, 5);
          if (ref.status === "ok" && !nodePath.has(node.id)) nodePath.set(node.id, ref.path);
          refs.push(ref);
        }
      }

      // What a subgraph's folder holds that none of its nodes shows.
      const notShown = [];
      for (const group of nodes.filter((node) => node.subgraph && nodePath.has(node.id))) {
        const folder = nodePath.get(group.id);
        const shown = nodes.filter((node) => node.parent === group.id && nodePath.has(node.id)).map((node) => nodePath.get(node.id));
        if (shown.length === 0) continue;
        const children = new Set();
        for (const file of files) {
          if (!under(file, folder) || file === folder || NOT_A_PART.test(file)) continue;
          const [first, ...rest] = file.slice(folder.length + 1).split("/");
          if (rest.length > 0 || CODE_FILE.test(first)) children.add(rest.length > 0 ? `${first}/` : first);
        }
        const missing = [...children].filter((child) => !shown.some((path) => under(path, `${folder}/${child.replace(/\/$/, "")}`)));
        if (missing.length > 0) notShown.push({ group: group.id, folder, missing: missing.sort() });
      }

      const checkedEdges = edges.map((edge) => {
        const from = nodePath.get(edge.from);
        const to = nodePath.get(edge.to);
        if (!graph || from === undefined || to === undefined) return edge;
        const inScope = (path) => graph.modules.some((m) => under(m, path));
        if (!inScope(from) || !inScope(to) || under(from, to) || under(to, from)) return { ...edge, imports: "n/a" };
        const hits = graph.edges.filter((e) => under(e.from, from) && under(e.to, to) && !under(e.from, to));
        const imports = hits.some((e) => !e.typeOnly) ? "yes" : hits.length > 0 ? "type-only" : "no";
        return { ...edge, imports };
      });

      const notDrawn = [];
      if (graph) {
        // An arrow to (or from) a subgraph already covers the nodes inside it.
        const withAncestors = (id) => {
          const ids = [id];
          for (let node = byId.get(id); node?.parent; node = byId.get(node.parent)) ids.push(node.parent);
          return ids;
        };
        // So does an arrow to a node whose folder holds the other one's.
        const holds = (x, y) => x === y || (nodePath.has(x) && nodePath.has(y) && under(nodePath.get(y), nodePath.get(x)));
        // A link between a node and its own inner folder (core --- core/src) covers nothing.
        const links = edges.filter((e) => !(holds(e.from, e.to) || holds(e.to, e.from)));
        const covered = (a, b) =>
          links.some((e) => withAncestors(a).some((x) => holds(e.from, x)) && withAncestors(b).some((y) => holds(e.to, y)));
        for (const [a, pa] of nodePath) {
          for (const [b, pb] of nodePath) {
            if (a === b || covered(a, b) || under(pa, pb) || under(pb, pa)) continue;
            const count = graph.edges.filter((e) => !e.typeOnly && under(e.from, pa) && under(e.to, pb)).length;
            if (count > 0) notDrawn.push({ from: a, to: b, imports: count });
          }
        }
        notDrawn.sort((x, y) => y.imports - x.imports);
      }
      diagrams.push({ file: doc, line: block.line, kind, checked: true, nodes, refs, edges: checkedEdges, importsNotDrawn: notDrawn, notShown });
    }
  }

  const all = diagrams.filter((d) => d.checked);
  const refs = all.flatMap((d) => d.refs);
  const edges = all.flatMap((d) => d.edges);
  return {
    version: 1,
    root,
    graph: Boolean(graph),
    diagrams,
    summary: {
      docs: docs.length,
      diagrams: diagrams.length,
      flowcharts: all.length,
      refs: refs.length,
      missing: refs.filter((r) => r.status === "missing").length,
      ambiguous: refs.filter((r) => r.status === "ambiguous").length,
      edgesChecked: edges.filter((e) => e.imports && e.imports !== "n/a").length,
      edgesWithoutImport: edges.filter((e) => e.imports === "no").length,
      importsNotDrawn: all.reduce((n, d) => n + d.importsNotDrawn.length, 0),
      notShown: all.reduce((n, d) => n + d.notShown.reduce((m, g) => m + g.missing.length, 0), 0),
    },
  };
}

function parseArgs(argv) {
  const opts = { root: ".", files: undefined, graphPath: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--graph") opts.graphPath = argv[++i];
    else if (arg === "--files") {
      opts.files = [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) opts.files.push(argv[++i]);
    } else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (!arg.startsWith("-")) opts.root = arg;
  }
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: node diagram-refs.mjs [root] [--files a.md …] [--graph graph.json]");
  } else {
    process.stdout.write(`${JSON.stringify(scan(opts.root, opts), null, 2)}\n`);
  }
}
