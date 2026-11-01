import { Alert } from "@pearpages/pulp-react/alert";
import { Button } from "@pearpages/pulp-react/button";
import { Text } from "@pearpages/pulp-react/text";
import { useRef, useState, type DragEvent } from "react";
import { parseReport, type QualityReport } from "../reports";
import "./ReportLoader.css";

interface Props {
  onLoad: (reports: QualityReport[]) => void;
}

/** Opens report files from disk, by picker or drag-and-drop. Nothing leaves the browser. */
export function ReportLoader({ onLoad }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  async function read(files: FileList | null) {
    const loaded: QualityReport[] = [];
    const problems: string[] = [];
    for (const file of Array.from(files ?? [])) {
      try {
        loaded.push(parseReport(await file.text(), file.name));
      } catch (error) {
        problems.push((error as Error).message);
      }
    }
    setErrors(problems);
    if (loaded.length > 0) onLoad(loaded);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void read(event.dataTransfer.files);
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
      <input
        ref={input}
        className="report-loader__input"
        type="file"
        accept="application/json,.json"
        multiple
        onChange={(event) => void read(event.target.files)}
      />
      <Button variant="secondary" onClick={() => input.current?.click()}>
        Open reports
      </Button>
      <Text tone="muted" size="sm">
        or drop xray-quality JSON files here. Several reports of one repository show its evolution.
      </Text>
      {errors.map((error) => (
        <Alert key={error} tone="error">
          {error}
        </Alert>
      ))}
    </div>
  );
}
