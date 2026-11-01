import type { Project, SourceFile } from "ts-morph";

interface Importer {
  file: SourceFile;
  /** Imported names; "*" for `import * as ns`. Default imports are "default". */
  names: Set<string>;
}

interface ReExport {
  barrel: SourceFile;
  /** exported name in the barrel → name in the target; undefined means `export *`. */
  names?: Map<string, string>;
}

/**
 * Who imports what from which file, built once over the project. Follows barrels
 * (`export * from`, `export { a } from`), which is how workspace packages expose
 * their API: `@fm/domain` resolves to its index.ts, not to the file that changed.
 */
export class UsageIndex {
  private readonly importers = new Map<SourceFile, Importer[]>();
  private readonly reExports = new Map<SourceFile, ReExport[]>();

  constructor(
    project: Project,
    resolveModule: (specifier: string, containingFile: string) => string | undefined,
  ) {
    const resolve = (from: SourceFile, specifier: string) => {
      const file = resolveModule(specifier, from.getFilePath());
      return file ? project.getSourceFile(file) : undefined;
    };
    for (const file of project.getSourceFiles()) {
      if (file.isDeclarationFile() || file.isInNodeModules()) continue;
      for (const declaration of file.getImportDeclarations()) {
        const target = resolve(file, declaration.getModuleSpecifierValue());
        if (!target) continue;
        const names = new Set<string>();
        if (declaration.getDefaultImport()) names.add("default");
        if (declaration.getNamespaceImport()) names.add("*");
        for (const named of declaration.getNamedImports()) names.add(named.getName());
        this.importers.set(target, [...(this.importers.get(target) ?? []), { file, names }]);
      }
      for (const declaration of file.getExportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        const target = specifier ? resolve(file, specifier) : undefined;
        if (!target) continue;
        const names = declaration.hasNamedExports()
          ? new Map(
              declaration
                .getNamedExports()
                .map((named) => [named.getAliasNode()?.getText() ?? named.getName(), named.getName()] as const),
            )
          : undefined;
        this.reExports.set(target, [...(this.reExports.get(target) ?? []), { barrel: file, names }]);
      }
    }
  }

  /** Files importing `name` from `file`, directly or through barrels. */
  usersOf(file: SourceFile, name: string, seen = new Set<SourceFile>()): SourceFile[] {
    if (seen.has(file)) return [];
    seen.add(file);
    const users = new Set<SourceFile>();
    for (const importer of this.importers.get(file) ?? []) {
      if (importer.names.has(name) || importer.names.has("*")) users.add(importer.file);
    }
    for (const reExport of this.reExports.get(file) ?? []) {
      // `export *` never re-exports a default.
      const exported = reExport.names
        ? [...reExport.names].find(([, original]) => original === name)?.[0]
        : name === "default"
          ? undefined
          : name;
      if (exported) this.usersOf(reExport.barrel, exported, seen).forEach((user) => users.add(user));
    }
    return [...users];
  }

  /** Whether a file is re-exported by one of the given entry files (directly or through barrels). */
  reachesEntry(file: SourceFile, entries: Set<SourceFile>, seen = new Set<SourceFile>()): boolean {
    if (entries.has(file)) return true;
    if (seen.has(file)) return false;
    seen.add(file);
    return (this.reExports.get(file) ?? []).some((reExport) => this.reachesEntry(reExport.barrel, entries, seen));
  }
}

