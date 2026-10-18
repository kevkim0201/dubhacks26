import { defineConfig } from "vite";
import { resolve } from "path";

// Builds the popup (HTML entry) and the MV3 service worker into dist/.
// Load dist/ as an unpacked extension in chrome://extensions.
export default defineConfig({
  root: "src",
  publicDir: resolve(__dirname, "public"),
  envDir: __dirname,
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false, // shared with the content-script build; `npm run build` cleans first
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup/index.html"),
        background: resolve(__dirname, "src/background/index.js"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
