import { inlineCode } from "../dependencies/render.js";
import type { Light } from "../risk/analyze.js";
import type { BundleAnalysis } from "./analyze.js";

const DOT: Record<Light, string> = { green: "🟢", yellow: "🟡", red: "🔴" };

export function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "−" : "";
  const value = Math.abs(bytes);
  return value < 1024 ? `${sign}${Math.round(value)} B` : `${sign}${(value / 1024).toFixed(1)} KB`;
}

const signed = (bytes: number) => (bytes > 0 ? `+${formatBytes(bytes)}` : formatBytes(bytes));

function percent(before: number, after: number): string {
  if (before === 0) return after === 0 ? "0%" : "new";
  const value = ((after - before) / before) * 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

const MAX_ROWS = 10;

export function renderBundleSection(bundle: BundleAnalysis): string {
  if (bundle.status === "failed") {
    return `> [!WARNING]\n> Bundle size not measured: the build failed.\n\n\`\`\`\n${bundle.error ?? ""}\n\`\`\``;
  }
  const { before, after } = bundle;
  if (!before || !after || !bundle.light) return "";

  const out = [
    `**${DOT[bundle.light]} ${signed(after.gzip - before.gzip)} gzip (${percent(before.gzip, after.gzip)})** — ` +
      `${formatBytes(before.gzip)} → ${formatBytes(after.gzip)} gzip · ` +
      `${formatBytes(before.brotli)} → ${formatBytes(after.brotli)} brotli · ` +
      `${formatBytes(before.raw)} → ${formatBytes(after.raw)} raw`,
  ];

  if (bundle.chunks.length > 0) {
    out.push(
      "",
      "| Chunk | gzip before | gzip after | Change |",
      "|---|---|---|---|",
      ...bundle.chunks.slice(0, MAX_ROWS).map((chunk) => {
        const was = chunk.before?.gzip;
        const now = chunk.after?.gzip;
        const change = was === undefined ? "new" : now === undefined ? "removed" : signed(now - was);
        return `| ${inlineCode(chunk.key)} | ${was === undefined ? "—" : formatBytes(was)} | ${now === undefined ? "—" : formatBytes(now)} | ${change} |`;
      }),
    );
    if (bundle.chunks.length > MAX_ROWS) out.push("", `<sub>${bundle.chunks.length - MAX_ROWS} more chunk(s) changed.</sub>`);
  } else {
    out.push("", "No chunk changed size.");
  }

  // Spreading a chunk's gzip size over its sources leaves a few bytes of noise on untouched ones.
  const causes = bundle.packages
    .filter((pkg) => Math.abs(pkg.after - pkg.before) >= 64)
    .slice(0, 5).map((pkg) => `${pkg.name === "(app)" ? "your code" : inlineCode(pkg.name)} ${signed(pkg.after - pkg.before)}`);
  if (causes.length > 0) out.push("", `**Biggest changes by source:** ${causes.join(", ")}`);
  if (bundle.dependencyChanges.length > 0) {
    const deps = bundle.dependencyChanges.map((dep) =>
      dep.before === undefined
        ? `${inlineCode(dep.name)} added (${dep.after})`
        : dep.after === undefined
          ? `${inlineCode(dep.name)} removed`
          : `${inlineCode(dep.name)} ${dep.before} → ${dep.after}`,
    );
    out.push("", `**Dependency changes:** ${deps.join(", ")}`);
  }
  out.push(
    "",
    `<sub>Built with \`${bundle.plan?.build ?? "?"}\` on the base and on the PR (${bundle.seconds ?? "?"} s). ` +
      (bundle.sourceMaps ? "Sources from source maps, in gzip-equivalent bytes. " : "No source maps, so no per-package breakdown. ") +
      "🔴 over the configured threshold (`bundle.thresholdBytes` / `thresholdPercent`).</sub>",
  );
  return out.join("\n");
}
