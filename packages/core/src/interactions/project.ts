import { existsSync, realpathSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { Project, ts, type SourceFile } from "ts-morph";
import type { XrayConfig } from "../config.js";
import { discoverWorkspace, workspaceResolver } from "../workspaces.js";

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

const EXTENSIONS: Record<string, ts.Extension> = {
  ".ts": ts.Extension.Ts,
  ".tsx": ts.Extension.Tsx,
  ".mts": ts.Extension.Mts,
  ".cts": ts.Extension.Cts,
};

function resolvedModule(file: string): ts.ResolvedModuleFull {
  const extension = EXTENSIONS[extname(file)] ?? ts.Extension.Ts;
  return { resolvedFileName: file, extension, isExternalLibraryImport: false };
}

/**
 * Loads the analysed root's TypeScript project into ts-morph. At a workspace
 * root, every package with a tsconfig.json joins one project, and workspace
 * package names resolve to their source (CI has no node_modules to link them).
 */
export function loadProject(cwd: string, config: XrayConfig): LoadedProject {
  const warnings: string[] = [];
  const toRoot = rootRelative(cwd);
  const tsConfigFilePath = config.tsConfig ? join(cwd, config.tsConfig) : undefined;
  const hasTsConfig = !!tsConfigFilePath && existsSync(tsConfigFilePath);
  const workspace = discoverWorkspace(cwd);
  const fromWorkspace = workspaceResolver(workspace ?? []);

  let project: Project;
  if (workspace) {
    project = new Project({
      ...(hasTsConfig
        ? { tsConfigFilePath, skipAddingFilesFromTsConfig: true }
        : { compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve } }),
      resolutionHost: (host, getCompilerOptions) => ({
        resolveModuleNames: (names, containingFile) =>
          names.map((name) => {
            const file = fromWorkspace(name);
            if (file) return resolvedModule(file);
            return ts.resolveModuleName(name, containingFile, getCompilerOptions(), host).resolvedModule;
          }),
      }),
    });
    for (const pkg of workspace) {
      const packageTsConfig = join(cwd, pkg.dir, "tsconfig.json");
      if (existsSync(packageTsConfig)) project.addSourceFilesFromTsConfig(packageTsConfig);
      else project.addSourceFilesAtPaths(join(cwd, pkg.dir, "src/**/*.{ts,tsx}"));
    }
  } else if (hasTsConfig) {
    project = new Project({ tsConfigFilePath });
  } else {
    warnings.push("No tsconfig.json found: interactions use default compiler options.");
    project = new Project({ compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve } });
    project.addSourceFilesAtPaths(config.roots.map((root) => join(cwd, root, "**/*.{ts,tsx,js,jsx}")));
  }

  const fileOf = (sourceFile: SourceFile) => {
    if (sourceFile.isDeclarationFile() || sourceFile.isInNodeModules()) return undefined;
    return toRoot(sourceFile.getFilePath());
  };
  const host = project.getModuleResolutionHost();
  const resolveModule = (specifier: string, containingFile: string) =>
    fromWorkspace(specifier) ??
    ts.resolveModuleName(specifier, containingFile, project.getCompilerOptions(), host).resolvedModule
      ?.resolvedFileName;
  return { project, fileOf, resolveModule, warnings };
}
