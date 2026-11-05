/**
 * What kind of file a repo path is, shared by every analysis and the quality report, so "what
 * counts as a test" can't differ between them.
 */

const CODE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const STORY_FILE = /\.stories\.[cm]?[jt]sx?$/;

/** TypeScript or JavaScript source: `.ts`, `.tsx`, `.js`, `.jsx` and their `.c*` / `.m*` forms. */
export function isCodeFile(path: string): boolean {
  return CODE_FILE.test(path);
}

/** `*.test.*`, `*.spec.*` or anything under `__tests__/`. */
export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

/** Storybook stories, `*.stories.*`. */
export function isStoryFile(path: string): boolean {
  return STORY_FILE.test(path);
}
