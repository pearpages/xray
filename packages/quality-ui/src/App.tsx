import { EmptyState } from "@pearpages/pulp-react/empty-state";
import { Heading } from "@pearpages/pulp-react/heading";
import { Inline } from "@pearpages/pulp-react/inline";
import { Select } from "@pearpages/pulp-react/select";
import { Stack } from "@pearpages/pulp-react/stack";
import { Text } from "@pearpages/pulp-react/text";
import { Button } from "@pearpages/pulp-react/button";
import { useEffect, useMemo, useState } from "react";
import { ArchitectureViolations } from "./components/ArchitectureViolations";
import { Findings } from "./components/Findings";
import { HotspotsTable } from "./components/HotspotsTable";
import { ReportLoader } from "./components/ReportLoader";
import { ScoreEvolution } from "./components/ScoreEvolution";
import { ScoreOverview } from "./components/ScoreOverview";
import { byRepo, evolution, type QualityReport } from "./reports";
import { browserStorage, loadSaved, save } from "./storage";
import "./App.css";

interface Props {
  /** Where reports are kept between visits; the browser's localStorage by default. */
  storage?: Storage | undefined;
}

export function App({ storage = browserStorage() }: Props) {
  const [reports, setReports] = useState<QualityReport[]>(() => loadSaved(storage));
  const [kept, setKept] = useState(true);
  useEffect(() => setKept(save(storage, reports)), [storage, reports]);
  const groups = useMemo(() => byRepo(reports), [reports]);
  const [repo, setRepo] = useState<string>();
  const [commit, setCommit] = useState<string>();

  const repoName = repo && groups.has(repo) ? repo : [...groups.keys()][0];
  const history = repoName ? groups.get(repoName)! : [];
  const report = history.find((item) => `${item.repo.commit}|${item.generatedAt}` === commit) ?? history.at(-1);
  const metric = (id: string) => report?.metrics.find((item) => item.id === id && item.status === "ok");

  return (
    <main className="app">
      <Stack gap={6}>
      <Stack gap={2}>
        <Heading level={1} size="xl">
          xray quality
        </Heading>
        <ReportLoader onLoad={(loaded) => setReports((current) => [...current, ...loaded])} />
        {reports.length > 0 && (
          <Inline gap={3} align="center">
            <Text tone="muted" size="sm">
              {kept
                ? `${reports.length} report(s) open, kept in this browser until you close them.`
                : `${reports.length} report(s) open. This browser can't keep them, so they close when you leave.`}
            </Text>
            <Button variant="ghost" size="sm" onClick={() => setReports([])}>
              Close all
            </Button>
          </Inline>
        )}
      </Stack>

      {!report ? (
        <EmptyState title="No report open" description="Run xray-quality on a repository, then open its JSON report here." />
      ) : (
        <>
          <Stack gap={2}>
            <Inline gap={4} align="end">
              {groups.size > 1 && (
                <Select label="Repository" size="sm" value={repoName} onChange={(event) => { setRepo(event.target.value); setCommit(undefined); }}>
                  {[...groups.keys()].map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </Select>
              )}
              {history.length > 1 && (
                <Select label="Report" size="sm" value={`${report.repo.commit}|${report.generatedAt}`} onChange={(event) => setCommit(event.target.value)}>
                  {history.map((item) => (
                    <option key={`${item.repo.commit}|${item.generatedAt}`} value={`${item.repo.commit}|${item.generatedAt}`}>
                      {item.repo.commit.slice(0, 7)} · {item.generatedAt.slice(0, 10)}
                    </option>
                  ))}
                </Select>
              )}
            </Inline>
            <Text tone="muted" size="sm">
              {report.repo.path} · {report.repo.branch ? `${report.repo.branch} · ` : ""}
              <code>{report.repo.commit.slice(0, 7)}</code> · {new Date(report.generatedAt).toLocaleString()}
              {report.repo.dirty ? " · with uncommitted changes" : ""}
            </Text>
          </Stack>
          <ScoreOverview report={report} />
          {history.length > 1 && <ScoreEvolution points={evolution(history)} />}
          {metric("hotspots") && <HotspotsTable metric={metric("hotspots")!} />}
          {metric("architecture") && <ArchitectureViolations metric={metric("architecture")!} />}
          <Findings report={report} />
        </>
      )}
      </Stack>
    </main>
  );
}
