#!/usr/bin/env node
// hotspots.mjs — rank the files most likely to be the complicated parts of a project.
//
// Language-agnostic and dependency-free. Produces CANDIDATES, not verdicts: the numbers say
// where to look, a human (or Claude) reading the code says whether it is actually hard.
//
// Usage:
//   node hotspots.mjs [path] [--since "12 months ago"] [--top 25] [--json] [--include-tests]
//
// Signals per file:
//   churn       commits touching the file inside the window        (needs git)
//   authors     distinct commit authors inside the window          (needs git)
//   loc         non-blank lines
//   complexity  sum of indentation levels over all lines (nesting-weighted size)
//   depth       90th-percentile indentation level
//   fanIn       other files whose import-like lines mention this file (approximate)
//   markers     TODO / FIXME / HACK / XXX count
//   tested      a test file with a matching name exists

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const CODE_EXT = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".vue", ".svelte", ".astro",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".scala", ".groovy", ".swift",
  ".m", ".mm", ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".cs", ".fs", ".php",
  ".ex", ".exs", ".erl", ".clj", ".cljs", ".hs", ".ml", ".elm", ".dart", ".lua", ".r", ".jl",
  ".sh", ".bash", ".zsh", ".ps1", ".sql", ".graphql", ".gql", ".proto", ".tf",
]);
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "target", "vendor", "coverage", "venv", ".venv",
  "__pycache__", "__snapshots__", ".git", ".next", ".nuxt", ".turbo", ".cache", "Pods",
]);
const GENERATED = /(\.min\.|\.d\.ts$|\.snap$|\.generated\.|_generated\.|\.gen\.|_pb2?\.|\.pb\.|\.g\.dart$)/;
const TEST_PATH = /(^|\/)(tests?|__tests__|specs?|e2e|cypress|playwright|fixtures|__mocks__)\//i;
const TEST_NAME = /(\.(test|spec|e2e|stories)\.|_(test|spec)\.|^test_)/i;
const IMPORT_LINE =
  /^\s*(import|from|export\b.*\bfrom|#\s*include|include|require|require_relative|use|using|load|source|alias)\b|require\(|import\(/;
const MARKERS = /\b(TODO|FIXME|HACK|XXX)\b/g;
const GENERIC_STEMS = new Set(["index", "mod", "main", "__init__", "lib", "init"]);
const MAX_BYTES = 1_000_000;

function parseArgs(argv) {
  const opts = { path: ".", since: "12 months ago", top: 25, json: false, includeTests: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--include-tests") opts.includeTests = true;
    else if (a === "--since") opts.since = argv[++i];
    else if (a === "--top") opts.top = Number(argv[++i]) || opts.top;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (!a.startsWith("-")) opts.path = a;
  }
  return opts;
}

function git(cwd, args) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function isGitRepo(cwd) {
  try {
    return git(cwd, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

function walk(root, dir = root, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(root, join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      acc.push(relative(root, join(dir, entry.name)));
    }
  }
  return acc;
}

function isCandidate(file) {
  if (!CODE_EXT.has(extname(file).toLowerCase())) return false;
  if (GENERATED.test(file)) return false;
  return !file.split("/").some((part) => SKIP_DIRS.has(part));
}

const isTest = (file) => TEST_PATH.test(file) || TEST_NAME.test(basename(file));

// The name other files would use to refer to this one: its stem, or the folder for index-like
// files. Returned as [parent, name] so names shared by several files ("queries", "utils") can be
// disambiguated by their folder.
function identity(file) {
  const dirs = dirname(file).split("/").filter((part) => part !== "." && !TEST_PATH.test(`${part}/`));
  let name = basename(file).replace(/\.[^.]+$/, "").replace(/\.(test|spec|e2e|stories)$/i, "");
  name = name.replace(/^test_|_(test|spec)$/i, "");
  if (GENERIC_STEMS.has(name.toLowerCase()) && dirs.length) name = dirs.pop();
  return [(dirs.pop() || "").toLowerCase(), name.toLowerCase()];
}

function readChurn(cwd, since) {
  const churn = new Map();
  const authors = new Map();
  const out = git(cwd, ["log", `--since=${since}`, "--no-merges", "--name-only", "--relative", "--format=%x01%an", "--", "."]);
  let author = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("\x01")) author = line.slice(1);
    else if (line) {
      churn.set(line, (churn.get(line) || 0) + 1);
      if (!authors.has(line)) authors.set(line, new Set());
      authors.get(line).add(author);
    }
  }
  return { churn, authors };
}

function measure(text) {
  const lines = text.split("\n");
  const leads = [];
  let unit = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const lead = line.match(/^[ \t]*/)[0];
    const tabs = (lead.match(/\t/g) || []).length;
    const spaces = lead.length - tabs;
    if (spaces >= 2 && spaces < unit) unit = spaces;
    leads.push({ tabs, spaces });
  }
  if (!Number.isFinite(unit) || unit > 8) unit = 4;
  const depths = leads.map(({ tabs, spaces }) => tabs + Math.floor(spaces / unit)).sort((a, b) => a - b);
  const loc = depths.length;
  return {
    loc,
    complexity: depths.reduce((sum, d) => sum + d, 0),
    depth: loc ? depths[Math.min(loc - 1, Math.floor(loc * 0.9))] : 0,
    markers: (text.match(MARKERS) || []).length,
    importTokens: importTokens(lines),
  };
}

// Single tokens plus adjacent "parent/name" pairs from import-like lines.
function importTokens(lines) {
  const tokens = new Set();
  for (const line of lines) {
    if (!IMPORT_LINE.test(line)) continue;
    const parts = line.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
    parts.forEach((part, i) => {
      if (part.length >= 3) tokens.add(part);
      if (i > 0) tokens.add(`${parts[i - 1]}/${part}`);
    });
  }
  return tokens;
}

// Fraction of values strictly below v, so ties share a rank and the scale is 0..1.
function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const below = new Map();
  sorted.forEach((v, i) => {
    if (!below.has(v)) below.set(v, i);
  });
  const span = Math.max(1, sorted.length - 1);
  return (v) => below.get(v) / span;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node hotspots.mjs [path] [--since "12 months ago"] [--top 25] [--json] [--include-tests]');
    return;
  }
  const root = resolve(opts.path);
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`Not a directory: ${root}`);
    process.exit(1);
  }

  const notes = [];
  const hasGit = isGitRepo(root);
  let all;
  let history = { churn: new Map(), authors: new Map() };
  if (hasGit) {
    all = git(root, ["ls-files"]).split("\n").filter(Boolean);
    history = readChurn(root, opts.since);
    if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
      notes.push("Shallow clone: churn and authors are undercounted.");
    }
    if (history.churn.size === 0) notes.push(`No commits in the window (${opts.since}): ranking falls back to complexity.`);
  } else {
    all = walk(root);
    notes.push("Not a git repository: churn and authors unavailable, ranking uses complexity only.");
  }
  const hasChurn = history.churn.size > 0;

  const code = all.filter(isCandidate);
  const nameCount = new Map();
  for (const file of code) {
    if (isTest(file)) continue;
    const [, name] = identity(file);
    nameCount.set(name, (nameCount.get(name) || 0) + 1);
  }
  const keyOf = (file) => {
    const [parent, name] = identity(file);
    return nameCount.get(name) > 1 && parent ? `${parent}/${name}` : name;
  };
  const testIdentities = new Set(code.filter(isTest).map(keyOf));
  const subjects = new Set(opts.includeTests ? code : code.filter((file) => !isTest(file)));

  const rows = [];
  const mentions = new Map(); // import token -> number of files mentioning it
  for (const file of code) {
    let text;
    try {
      const abs = join(root, file);
      if (statSync(abs).size > MAX_BYTES) continue;
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (text.slice(0, 8000).includes("\0")) continue;
    const m = measure(text);
    for (const token of m.importTokens) mentions.set(token, (mentions.get(token) || 0) + 1);
    if (!subjects.has(file)) continue;
    const id = keyOf(file);
    rows.push({
      file,
      id,
      selfMention: m.importTokens.has(id),
      churn: history.churn.get(file) || 0,
      authors: history.authors.get(file)?.size || 0,
      loc: m.loc,
      complexity: m.complexity,
      depth: m.depth,
      markers: m.markers,
      tested: testIdentities.has(id),
    });
  }
  for (const row of rows) {
    row.fanIn = row.id.length >= 3 ? Math.max(0, (mentions.get(row.id) || 0) - (row.selfMention ? 1 : 0)) : 0;
  }

  const pct = {
    churn: percentiles(rows.map((r) => r.churn)),
    complexity: percentiles(rows.map((r) => r.complexity)),
    fanIn: percentiles(rows.map((r) => r.fanIn)),
    markers: percentiles(rows.map((r) => r.markers)),
  };
  for (const row of rows) {
    const change = hasChurn ? 0.3 + 0.7 * pct.churn(row.churn) : 1;
    const boost = 1 + 0.15 * pct.fanIn(row.fanIn) + 0.05 * pct.markers(row.markers) + (row.tested ? 0 : 0.1);
    row.score = Math.round((pct.complexity(row.complexity) * change * boost * 100) / 1.3);
  }
  rows.sort((a, b) => b.score - a.score || b.complexity - a.complexity);
  const top = rows.slice(0, opts.top).map(({ id, selfMention, ...row }) => row);

  const summary = {
    root,
    since: hasChurn ? opts.since : null,
    signals: { git: hasGit, churn: hasChurn },
    filesAnalysed: rows.length,
    testsIncluded: opts.includeTests,
    notes,
    top,
  };
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`# Hotspot candidates — ${root}`);
  console.log(`\n${rows.length} code files analysed` + (hasChurn ? `, churn window: ${opts.since}.` : "."));
  for (const note of notes) console.log(`> ${note}`);
  console.log("\n| # | file | score | churn | authors | loc | complexity | depth | fanIn | markers | tested |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  top.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.file} | ${r.score} | ${r.churn} | ${r.authors} | ${r.loc} | ${r.complexity} | ${r.depth} | ${r.fanIn} | ${r.markers} | ${r.tested ? "yes" : "no"} |`,
    );
  });
  console.log("\nCandidates, not verdicts: fanIn and tested are name-based approximations. Read the code before judging.");
}

main();
