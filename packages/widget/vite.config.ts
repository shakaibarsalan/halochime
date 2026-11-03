import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Builds the embeddable widget as ONE self-contained IIFE file straight into the web app's
// public folder, so `<script src="https://APP_URL/widget.js">` serves it.
const entry = fileURLToPath(new URL("./src/index.ts", import.meta.url));
const outDir = fileURLToPath(new URL("../../apps/web/public", import.meta.url));

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  publicDir: false,
  build: {
    outDir,
    // The web app owns that folder; never wipe it.
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: true,
    minify: true,
    lib: {
      entry,
      name: "TalkfrontWidget",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    rolldownOptions: {
      treeshake: {
        // @talkfront/shared builds zod schemas at module top level. The widget only uses its
        // constants and types, so mark the schema builders pure and let zod drop out of the bundle.
        manualPureFunctions: ["z"],
      },
    },
  },
});
