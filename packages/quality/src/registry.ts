import { architecture } from "./analyzers/architecture.js";
import { coverage } from "./analyzers/coverage.js";
import { dependencies } from "./analyzers/dependencies.js";
import { duplication } from "./analyzers/duplication.js";
import { hotspots } from "./analyzers/hotspots.js";
import { lint } from "./analyzers/lint.js";
import type { Analyzer } from "./types.js";

/** Every metric. Adding one: write `analyzers/<id>.ts` and list it here. */
export const ANALYZERS: Analyzer[] = [hotspots, architecture, dependencies, coverage, duplication, lint];
