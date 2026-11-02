import { Alert } from "@pearpages/pulp-react/alert";
import { DialogSystem } from "@pearpages/pulp-react/dialog";
import { EmptyState } from "@pearpages/pulp-react/empty-state";
import { Heading } from "@pearpages/pulp-react/heading";
import { Tabs } from "@pearpages/pulp-react/tabs";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Spinner } from "@pearpages/pulp-react/spinner";
import { AppHeader } from "./components/AppHeader";
import { FileProfileSheet } from "./components/FileProfileSheet";
import { MetricHeader } from "./components/MetricHeader";
import { Overview, weakestFirst } from "./components/Overview";
import { ScoreChip } from "./components/ScoreChip";
import { Findings } from "./components/Findings";
import { readReportFiles, ReportLoader } from "./components/ReportLoader";
import { byRepo, type MetricResult, type QualityReport } from "./reports";
import { browserStorage, loadSaved, save } from "./storage";
import { FileProfileContext } from "./fileProfileContext";
import { useHashTab } from "./useHashTab";
import "./App.css";

interface Props {
  /** Where reports are kept between visits; the browser's localStorage by default. */
  storage?: Storage | undefined;
}

// Each metric view loads when its tab first opens: the overview doesn't pay for the tables.
const ArchitectureViolations = lazy(() => import("./components/ArchitectureViolations").then((m) => ({ default: m.ArchitectureViolations })));
const CoverageTable = lazy(() => import("./components/CoverageTable").then((m) => ({ default: m.CoverageTable })));
const DependenciesView = lazy(() => import("./components/DependenciesView").then((m) => ({ default: m.DependenciesView })));
const DuplicationBlocks = lazy(() => import("./components/DuplicationBlocks").then((m) => ({ default: m.DuplicationBlocks })));
const HotspotsTable = lazy(() => import("./components/HotspotsTable").then((m) => ({ default: m.HotspotsTable })));
const LintView = lazy(() => import("./components/LintView").then((m) => ({ default: m.LintView })));

/** A metric's own view; metrics without one show their findings. */
const VIEWS: Record<string, (metric: MetricResult, report: QualityReport) => ReactNode> = {
  hotspots: (metric, report) => <HotspotsTable metric={metric} generatedAt={report.generatedAt} />,
  dependencies: (metric) => <DependenciesView metric={metric} />,
  lint: (metric, report) => <LintView metric={metric} report={report} />,
  architecture: (metric) => <ArchitectureViolations metric={metric} />,
  coverage: (metric) => <CoverageTable metric={metric} />,
  duplication: (metric) => <DuplicationBlocks metric={metric} />,
};

export function App({ storage = browserStorage() }: Props) {
  const [reports, setReports] = useState<QualityReport[]>(() => loadSaved(storage));
  const [kept, setKept] = useState(true);
  useEffect(() => setKept(save(storage, reports)), [storage, reports]);
  const groups = useMemo(() => byRepo(reports), [reports]);
  const [repo, setRepo] = useState<string>();
  const [commit, setCommit] = useState<string>();
  const [tab, setTab] = useHashTab("overview");
  const [dropping, setDropping] = useState(false);
  const [dropErrors, setDropErrors] = useState<string[]>([]);
  const [file, setFile] = useState<string>();

  const add = (loaded: QualityReport[]) => setReports((current) => [...current, ...loaded]);

  // Once reports are open, files can be dropped anywhere on the page.
  useEffect(() => {
    if (reports.length === 0) return;
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      setDropping(true);
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) setDropping(false);
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      setDropping(false);
      void readReportFiles(Array.from(event.dataTransfer.files)).then(({ loaded, problems }) => {
        setDropErrors(problems);
        if (loaded.length) add(loaded);
      });
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [reports.length]);

  const repoName = repo && groups.has(repo) ? repo : [...groups.keys()][0];
  const history = repoName ? groups.get(repoName)! : [];
  const report = history.find((item) => `${item.repo.commit}|${item.generatedAt}` === commit) ?? history.at(-1);

  if (!report) {
    return (
      <main className="app">
        <div className="app__start">
          <Heading level={1} size="xl">
            xray quality
          </Heading>
          <EmptyState
            title="No report open"
            description="Run xray-quality on a repository (node packages/quality/dist/cli.js --cwd <repo> -o report.json), then open its JSON report here. It stays in this browser."
          />
          <ReportLoader onLoad={add} />
        </div>
      </main>
    );
  }

  // Every metric has a tab, the weakest first; an unmeasured one says why and how to measure it.
  const ordered = weakestFirst(report.metrics);
  const tabs = ["overview", ...ordered.map((metric) => metric.id), "findings"];
  const current = tabs.includes(tab) ? tab : "overview";
  const findings = report.metrics.reduce((sum, metric) => sum + metric.findings.length, 0);

  return (
    <DialogSystem>
      <FileProfileContext.Provider value={setFile}>
        <main className={`app${dropping ? " app--dropping" : ""}`}>
          <AppHeader
            report={report}
            repositories={[...groups.keys()]}
            history={history}
            kept={kept}
            onRepository={(name) => {
              setRepo(name);
              setCommit(undefined);
            }}
            onReport={setCommit}
            onLoad={add}
            onCloseAll={() => {
              setReports([]);
              setTab("overview");
            }}
          />
          {dropErrors.map((error) => (
            <Alert key={error} tone="error">
              {error}
            </Alert>
          ))}
          <Tabs value={current} onValueChange={setTab} activation="manual" className="app__tabs">
            <Tabs.List aria-label="Report sections" className="app__tablist">
              <Tabs.Tab value="overview">Overview</Tabs.Tab>
              {ordered.map((metric) => (
                <Tabs.Tab key={metric.id} value={metric.id} className="app__tab">
                  {metric.name} <ScoreChip score={metric.score} />
                </Tabs.Tab>
              ))}
              <Tabs.Tab value="findings">{`Findings (${findings})`}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="overview">
              <Overview report={report} history={history} tabs={tabs} />
            </Tabs.Panel>
            {ordered.map((metric) => (
              <Tabs.Panel key={metric.id} value={metric.id}>
                {current === metric.id && (
                  <div className="app__metric">
                    <MetricHeader metric={metric} report={report} history={history} />
                    {metric.status === "ok" && (
                      <Suspense fallback={<Spinner label={`Loading ${metric.name}`} />}>
                        {VIEWS[metric.id]?.(metric, report) ?? <Findings report={report} metric={metric.id} />}
                      </Suspense>
                    )}
                  </div>
                )}
              </Tabs.Panel>
            ))}
            <Tabs.Panel value="findings">{current === "findings" && <Findings report={report} />}</Tabs.Panel>
          </Tabs>
          <FileProfileSheet report={report} file={file} onClose={() => setFile(undefined)} />
        </main>
      </FileProfileContext.Provider>
    </DialogSystem>
  );
}
