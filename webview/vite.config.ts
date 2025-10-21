import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import * as path from "path";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(projectRoot, "../media/action-editor"),
    emptyOutDir: true,
    sourcemap: true,
    assetsDir: "assets",
    manifest: true,
    rollupOptions: {
      input: "index.html",
    },
  },
});
