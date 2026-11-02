import { Badge } from "@pearpages/pulp-react/badge";
import { Button } from "@pearpages/pulp-react/button";
import { Heading } from "@pearpages/pulp-react/heading";
import { Select } from "@pearpages/pulp-react/select";
import { Text } from "@pearpages/pulp-react/text";
import type { QualityReport } from "../reports";
import { ReportLoader } from "./ReportLoader";
import "./AppHeader.css";

const key = (report: QualityReport) => `${report.repo.commit}|${report.generatedAt}`;

interface Props {
  report: QualityReport;
  repositories: string[];
  history: QualityReport[];
  kept: boolean;
  onRepository: (name: string) => void;
  onReport: (key: string) => void;
  onLoad: (reports: QualityReport[]) => void;
  onCloseAll: () => void;
}

/** What is open (repository, commit, date) and the controls to switch, add or close reports. */
export function AppHeader({ report, repositories, history, kept, onRepository, onReport, onLoad, onCloseAll }: Props) {
  const { repo } = report;
  return (
    <header className="app-header">
      <div className="app-header__title">
        <Text tone="muted" size="sm" weight="semibold">
          xray quality
        </Text>
        <Heading level={1} size="xl">
          {repo.name}
        </Heading>
        <Text tone="muted" size="sm" className="app-header__meta">
          {repo.branch ? `${repo.branch} · ` : ""}
          <code>{repo.commit.slice(0, 7)}</code> · {new Date(report.generatedAt).toLocaleString()} · {repo.path}
        </Text>
        {repo.dirty && (
          <Badge tone="warning" className="app-header__badge">
            uncommitted changes analysed
          </Badge>
        )}
      </div>
      <div className="app-header__controls">
        {repositories.length > 1 && (
          <Select label="Repository" size="sm" value={repo.name} onChange={(event) => onRepository(event.target.value)}>
            {repositories.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </Select>
        )}
        {history.length > 1 && (
          <Select label="Report" size="sm" value={key(report)} onChange={(event) => onReport(event.target.value)}>
            {history.map((item) => (
              <option key={key(item)} value={key(item)}>
                {item.repo.commit.slice(0, 7)} · {item.generatedAt.slice(0, 10)}
              </option>
            ))}
          </Select>
        )}
        <div className="app-header__actions">
          <ReportLoader compact onLoad={onLoad} />
          <Button variant="ghost" size="sm" onClick={onCloseAll}>
            Close all
          </Button>
        </div>
        <Text tone="muted" size="xs">
          {kept ? "Open reports are kept in this browser until you close them." : "This browser can't keep the reports: they close when you leave."}
        </Text>
      </div>
    </header>
  );
}
