import { defineConfig } from "vite";
import { resolve } from "path";

// Content scripts can't be ES modules, so build them as a single IIFE file.
export default defineConfig({
  envDir: __dirname,
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/content/index.js"),
      name: "nookContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});
