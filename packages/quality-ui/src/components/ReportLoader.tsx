import { Alert } from "@pearpages/pulp-react/alert";
import { Button } from "@pearpages/pulp-react/button";
import { Text } from "@pearpages/pulp-react/text";
import { useRef, useState, type DragEvent } from "react";
import { parseReport, type QualityReport } from "../reports";
import "./ReportLoader.css";

interface Props {
  onLoad: (reports: QualityReport[]) => void;
  /** Just the button: once reports are open, files can also be dropped anywhere on the page. */
  compact?: boolean;
}

/** Reads report files; the ones that aren't reports come back as messages. Nothing leaves the browser. */
export async function readReportFiles(files: Iterable<File>): Promise<{ loaded: QualityReport[]; problems: string[] }> {
  const loaded: QualityReport[] = [];
  const problems: string[] = [];
  for (const file of files) {
    try {
      loaded.push(parseReport(await file.text(), file.name));
    } catch (error) {
      problems.push((error as Error).message);
    }
  }
  return { loaded, problems };
}

/** Opens report files from disk, by picker or drag-and-drop. */
export function ReportLoader({ onLoad, compact = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  async function read(files: FileList | null) {
    const { loaded, problems } = await readReportFiles(Array.from(files ?? []));
    setErrors(problems);
    if (loaded.length > 0) onLoad(loaded);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    void read(event.dataTransfer.files);
  }

  const picker = (
    <>
      <input
        ref={input}
        className="report-loader__input"
        type="file"
        accept="application/json,.json"
        multiple
        onChange={(event) => void read(event.target.files)}
      />
      <Button variant={compact ? "secondary" : "primary"} size={compact ? "sm" : "md"} onClick={() => input.current?.click()}>
        Open reports
      </Button>
    </>
  );
  const problems = errors.map((error) => (
    <Alert key={error} tone="error">
      {error}
    </Alert>
  ));

  if (compact) {
    return (
      <div className="report-loader report-loader--compact">
        {picker}
        {problems}
      </div>
    );
  }
  return (
    <div
      className={`report-loader${dragging ? " report-loader--dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      {picker}
      <Text tone="muted" size="sm">
        or drop xray-quality JSON files here. Several reports of one repository show its evolution.
      </Text>
      {problems}
    </div>
  );
}
