import { useOpenFile } from "../fileProfileContext";
import "./FileLink.css";

/** A file path that opens everything the report knows about the file. */
export function FileLink({ file, line, label }: { file: string; line?: number | undefined; label?: string }) {
  const open = useOpenFile();
  return (
    <button type="button" className="file-link" onClick={() => open(file)} aria-label={`${file}${line ? `:${line}` : ""}, open its profile`}>
      <code>{label ?? `${file}${line ? `:${line}` : ""}`}</code>
    </button>
  );
}
