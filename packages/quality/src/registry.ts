import { architecture } from "./analyzers/architecture.js";
import { dependencies } from "./analyzers/dependencies.js";
import { hotspots } from "./analyzers/hotspots.js";
import type { Analyzer } from "./types.js";

/** Every metric. Adding one: write `analyzers/<id>.ts` and list it here. */
export const ANALYZERS: Analyzer[] = [hotspots, architecture, dependencies];
