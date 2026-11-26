import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { reportsHomePlugin } from "./reports-home";

// Relative paths: the built app opens from any folder or static host. `vite` and `vite preview`
// also serve the reports home (~/.xray/reports, ADR-0028); a static copy just opens files.
export default defineConfig({ base: "./", plugins: [react(), reportsHomePlugin()] });
