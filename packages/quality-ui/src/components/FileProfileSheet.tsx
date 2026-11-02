import { Badge } from "@pearpages/pulp-react/badge";
import { Heading } from "@pearpages/pulp-react/heading";
import { Sheet } from "@pearpages/pulp-react/sheet";
import { Text } from "@pearpages/pulp-react/text";
import { fileProfile, tone, type QualityReport } from "../reports";
import { FileLink } from "./FileLink";
import "./FileProfileSheet.css";

const TONE = { high: "error", medium: "warning", low: "neutral" } as const;

interface Props {
  report: QualityReport;
  file: string | undefined;
  onClose: () => void;
}

/** Everything about one file, beside the page: hotspot, coverage, copies, deep imports, findings. */
export function FileProfileSheet({ report, file, onClose }: Props) {
  const profile = file ? fileProfile(report, file) : undefined;
  return (
    <Sheet id="file-profile" open={Boolean(file)} onOpenChange={(open) => !open && onClose()}>
      <Sheet.Content placement="end" className="file-profile">
        <Sheet.Header>
          <Sheet.Title>
            <code className="file-profile__title">{file}</code>
          </Sheet.Title>
          <Sheet.Description>Everything this report knows about the file.</Sheet.Description>
          <Sheet.Close aria-label="Close" />
        </Sheet.Header>
        <Sheet.Body>
          {profile && (
            <div className="file-profile__sections">
              <section className="file-profile__section">
                <Heading level={3} size="sm">
                  Hotspot
                </Heading>
                <Text size="sm">
                  {profile.hotspot
                    ? `${profile.hotspot.churn} commits in ${profile.hotspot.windowMonths} months × complexity ${profile.hotspot.complexity} = ${profile.hotspot.hotspot}`
                    : "Not changed in the window, or no code to measure."}
                </Text>
              </section>
              <section className="file-profile__section">
                <Heading level={3} size="sm">
                  Coverage
                </Heading>
                {!profile.coverage ? (
                  <Text size="sm" tone="muted">
                    Not in a coverage report.
                  </Text>
                ) : profile.coverage.untested ? (
                  <Badge tone="error" className="file-profile__badge">{`no test loads it (≈ ${profile.coverage.lines} lines)`}</Badge>
                ) : (
                  <Badge tone={tone(profile.coverage.percent)} className="file-profile__badge">
                    {`${profile.coverage.percent} % of ${profile.coverage.lines} lines`}
                  </Badge>
                )}
              </section>
              {profile.copies.length > 0 && (
                <section className="file-profile__section">
                  <Heading level={3} size="sm">
                    Copies
                  </Heading>
                  <ul className="file-profile__list">
                    {profile.copies.map((copy) => (
                      <li key={`${copy.here.start}|${copy.there.file}:${copy.there.start}`}>
                        <Text as="span" size="sm">{`Lines ${copy.here.start}–${copy.here.end} (${copy.tokens} tokens) are also in `}</Text>
                        <FileLink file={copy.there.file} line={copy.there.start} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {(profile.imports.length > 0 || profile.importedBy.length > 0) && (
                <section className="file-profile__section">
                  <Heading level={3} size="sm">
                    Deep imports
                  </Heading>
                  <ul className="file-profile__list">
                    {profile.imports.map((item) => (
                      <li key={`out:${item.imports}`}>
                        <Text as="span" size="sm">
                          {item.line ? `Line ${item.line} imports ` : "Imports "}
                        </Text>
                        <FileLink file={item.imports} />
                      </li>
                    ))}
                    {profile.importedBy.map((item) => (
                      <li key={`in:${item.file}`}>
                        <Text as="span" size="sm">
                          Imported by{" "}
                        </Text>
                        <FileLink file={item.file} line={item.line} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="file-profile__section">
                <Heading level={3} size="sm">
                  {`Findings (${profile.findings.length})`}
                </Heading>
                {profile.findings.length === 0 ? (
                  <Text size="sm" tone="muted">
                    None.
                  </Text>
                ) : (
                  <ul className="file-profile__list">
                    {profile.findings.map((finding) => (
                      <li key={finding.id} className="file-profile__finding">
                        <Badge tone={TONE[finding.severity]}>{finding.severity}</Badge>
                        <Text as="span" size="sm">
                          {finding.metricName}
                          {finding.line ? `, line ${finding.line}` : ""}: {finding.message}
                        </Text>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </Sheet.Body>
      </Sheet.Content>
    </Sheet>
  );
}
