import { existsSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Project, ts, type SourceFile } from "ts-morph";
import type { XrayConfig } from "../config.js";

export interface LoadedProject {
  project: Project;
  /** Path relative to the analysed root, or undefined for files outside it or in node_modules. */
  fileOf: (sourceFile: SourceFile) => string | undefined;
  /** Resolves a module specifier the way the project's imports do; absolute path or undefined. */
  resolveModule: (specifier: string, containingFile: string) => string | undefined;
  warnings: string[];
}

/**
 * Maps an absolute path to a root-relative POSIX path. TypeScript reaches
 * some files through their realpath (macOS /var → /private/var), so both
 * spellings of the root are tried.
 */
export function rootRelative(cwd: string): (path: string) => string | undefined {
  const roots = [...new Set([cwd, realpathSync(cwd)])];
  return (path) => {
    for (const root of roots) {
      const rel = relative(root, path);
      if (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel)) {
        return rel.split(sep).join("/");
      }
    }
    return undefined;
  };
}

/** Loads the analysed root's TypeScript project into ts-morph. */
export function loadProject(cwd: string, config: XrayConfig): LoadedProject {
  const warnings: string[] = [];
  const toRoot = rootRelative(cwd);
  const tsConfigFilePath = config.tsConfig ? join(cwd, config.tsConfig) : undefined;

  let project: Project;
  if (tsConfigFilePath && existsSync(tsConfigFilePath)) {
    project = new Project({ tsConfigFilePath });
  } else {
    warnings.push("No tsconfig.json found: interactions use default compiler options.");
    project = new Project({ compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve } });
    project.addSourceFilesAtPaths(
      config.roots.map((root) => join(cwd, root, "**/*.{ts,tsx,js,jsx}")),
    );
  }

  const fileOf = (sourceFile: SourceFile) => {
    if (sourceFile.isDeclarationFile() || sourceFile.isInNodeModules()) return undefined;
    return toRoot(sourceFile.getFilePath());
  };
  const host = project.getModuleResolutionHost();
  const resolveModule = (specifier: string, containingFile: string) =>
    ts.resolveModuleName(specifier, containingFile, project.getCompilerOptions(), host).resolvedModule
      ?.resolvedFileName;
  return { project, fileOf, resolveModule, warnings };
}
