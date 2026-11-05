/**
 * The agent format (`--format agent`, ADR-0021): findings only, for tools that call xray.
 * Types only, no runtime code: the one part of `@xray/core` outside tools may import
 * (`@xray/core/agent`). Changing a field or a severity mapping bumps `version`.
 */

export type AgentSeverity = "high" | "medium" | "low";

export interface AgentFinding {
  /** The analysis or metric id: `risk`, `api`, `hotspots`… */
  analyzer: string;
  /** Repo-relative POSIX path. */
  file: string;
  line?: number;
  severity: AgentSeverity;
  message: string;
}

export interface AgentAnalyzerSummary {
  analyzer: string;
  status: "ok" | "unavailable";
  /** One line. */
  summary: string;
  /** Findings this analyzer produced, before `--min-severity` and `--top`. */
  findings: number;
}

export interface AgentReport {
  version: 1;
  tool: "xray" | "xray-quality";
  /** The PR head, or the commit the quality report read. */
  commit: string;
  /** Every selected analyzer, whatever it found. */
  analyzers: AgentAnalyzerSummary[];
  /** At or above `--min-severity`, high first, then by file and line; at most `--top`. */
  findings: AgentFinding[];
  /** Findings at or above `--min-severity` left out by `--top`. */
  truncated: number;
}
