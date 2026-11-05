/** `path/to/file.ts#name` → its file and unit name. Free of ts-morph, so renderers can use it. */
export function splitUnitId(id: string): { file: string; name: string } {
  const at = id.lastIndexOf("#");
  return { file: id.slice(0, at), name: id.slice(at + 1) };
}
