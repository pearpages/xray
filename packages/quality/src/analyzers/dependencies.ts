import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectPackageManager } from "@xray/core";
import { git } from "../files.js";
import { clamp, unavailable } from "../score.js";
import type { Analyzer, Finding, Severity } from "../types.js";

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the command couldn't start (not installed). */
  error?: Error;
}

/** Runs a package manager command in the analysed repo. Injectable, so tests need no network. */
export type Runner = (command: string, args: string[], cwd: string, timeoutMs: number) => RunResult;

const defaultRunner: Runner = (command, args, cwd, timeoutMs) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", ...(result.error ? { error: result.error } : {}) };
};

/** Dependency findings cost more than code findings and aren't scaled by repo size (ADR-0014). */
const PENALTY: Record<Severity, number> = { high: 15, medium: 5, low: 1 };

const SEVERITY: Record<string, Severity> = { critical: "high", high: "high", moderate: "medium", low: "low", info: "low" };

const OFFLINE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|network|socket hang up|request to .* failed|BAD_RESPONSE/i;

export interface Vulnerability {
  package: string;
  severity: string;
  title: string;
}

export interface Outdated {
  package: string;
  current: string;
  latest: string;
  major: boolean;
}

const major = (version: string | undefined) => Number(/(\d+)/.exec(version ?? "")?.[1] ?? NaN);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** npm (`vulnerabilities`) and pnpm (`advisories`) audit JSON. */
export function parseAudit(text: string): Vulnerability[] | undefined {
  const json = parseJson(text) as
    | { vulnerabilities?: Record<string, { severity: string; via: (string | { title?: string })[] }>; advisories?: Record<string, { module_name: string; severity: string; title: string }> }
    | undefined;
  if (!json) return undefined;
  if (json.vulnerabilities) {
    return Object.entries(json.vulnerabilities).map(([name, vuln]) => ({
      package: name,
      severity: vuln.severity,
      title: vuln.via.map((via) => (typeof via === "string" ? `via ${via}` : (via.title ?? ""))).filter(Boolean).join("; "),
    }));
  }
  if (json.advisories) {
    return Object.values(json.advisories).map((advisory) => ({
      package: advisory.module_name,
      severity: advisory.severity,
      title: advisory.title,
    }));
  }
  return undefined;
}

/** npm and pnpm `outdated` JSON: `{ name: { current, wanted, latest } }` (npm may give an array per name). */
export function parseOutdated(text: string): Outdated[] | undefined {
  if (!text.trim()) return [];
  const json = parseJson(text) as Record<string, unknown> | undefined;
  if (!json || typeof json !== "object") return undefined;
  const rows: Outdated[] = [];
  for (const [name, value] of Object.entries(json)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      const { current, wanted, latest } = entry as { current?: string; wanted?: string; latest?: string };
      if (!latest) continue;
      const installed = current ?? wanted ?? "";
      rows.push({ package: name, current: installed, latest, major: major(latest) > major(installed) });
    }
  }
  return rows;
}

const RANK: Record<string, number> = { critical: 4, high: 3, moderate: 2, low: 1, info: 0 };

/** One entry per package, at its worst severity: pnpm lists every advisory separately. */
export function worstPerPackage(vulnerabilities: Vulnerability[] | undefined): Vulnerability[] | undefined {
  if (!vulnerabilities) return undefined;
  const byPackage = new Map<string, Vulnerability>();
  for (const vuln of vulnerabilities) {
    const seen = byPackage.get(vuln.package);
    if (!seen) byPackage.set(vuln.package, { ...vuln });
    else {
      if ((RANK[vuln.severity] ?? 0) > (RANK[seen.severity] ?? 0)) seen.severity = vuln.severity;
      if (vuln.title && !seen.title.includes(vuln.title)) seen.title = `${seen.title}; ${vuln.title}`;
    }
  }
  return [...byPackage.values()];
}

export function createDependencies(runner: Runner = defaultRunner): Analyzer {
  return {
    id: "dependencies",
    name: "Dependencies",
    phase: 1,
    async analyze({ root, config }) {
      const top = git(root, ["rev-parse", "--show-toplevel"]);
      const manager = detectPackageManager(root, top);
      const command = manager === "npm-ci" || manager === "npm" ? "npm" : manager;
      if (command === "yarn") return unavailable("dependencies", "Dependencies", "yarn projects aren't supported yet (npm and pnpm are)");
      if (command === "npm" && !existsSync(join(root, "package-lock.json"))) {
        return unavailable("dependencies", "Dependencies", "npm audit needs a package-lock.json");
      }
      const timeout = config.dependencies.timeoutSeconds * 1000;
      const workspace = command === "pnpm" && existsSync(join(root, "pnpm-workspace.yaml"));

      const prodOnly = config.dependencies.dev ? [] : command === "pnpm" ? ["--prod"] : ["--omit=dev"];
      const audit = runner(command, ["audit", "--json", ...prodOnly], root, timeout);
      if (audit.error) return unavailable("dependencies", "Dependencies", `${command} isn't available (${audit.error.message})`);
      const vulnerabilities = worstPerPackage(parseAudit(audit.stdout));
      if (!vulnerabilities) {
        const output = `${audit.stderr}\n${audit.stdout}`;
        const firstLine = output.split("\n").find((line) => line.trim()) ?? `exit ${audit.status}`;
        return unavailable(
          "dependencies",
          "Dependencies",
          OFFLINE.test(output) ? `the registry can't be reached (${firstLine.trim()})` : `\`${command} audit\` failed: ${firstLine.trim()}`,
        );
      }

      let outdated: Outdated[] | undefined;
      if (config.dependencies.outdated) {
        const args = command === "pnpm" ? ["outdated", ...(workspace ? ["-r"] : []), "--format", "json"] : ["outdated", "--json"];
        outdated = parseOutdated(runner(command, args, root, timeout).stdout);
      }

      const findings: Finding[] = [
        ...vulnerabilities.map((vuln) => ({
          file: "package.json",
          severity: SEVERITY[vuln.severity] ?? "low",
          message: `${vuln.package}: ${vuln.title || "vulnerable"} (${vuln.severity})`,
        })),
        ...(outdated ?? [])
          .filter((row) => row.major)
          .map((row) => ({ file: "package.json", severity: "low" as const, message: `${row.package} ${row.current} → ${row.latest} (a major version behind)` })),
      ];
      const points = findings.reduce((sum, finding) => sum + PENALTY[finding.severity], 0);
      const counts = (severity: Severity) => findings.filter((finding) => finding.severity === severity && !finding.message.includes("major version")).length;
      return {
        id: "dependencies",
        name: "Dependencies",
        score: clamp(100 - points),
        summary:
          `${vulnerabilities.length} vulnerable ${config.dependencies.dev ? "" : "production "}package(s) ` +
          `(${counts("high")} high or critical, ${counts("medium")} moderate)` +
          (outdated ? `, ${outdated.filter((row) => row.major).length} a major version behind.` : "; outdated packages not checked."),
        findings,
        status: "ok",
        data: { packageManager: command, vulnerabilities, outdated: outdated ?? null },
      };
    },
  };
}

export const dependencies = createDependencies();
