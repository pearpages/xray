import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative paths: the built app opens from any folder or static host.
export default defineConfig({ base: "./", plugins: [react()] });
