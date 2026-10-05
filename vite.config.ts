import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  // Relative paths, so the same build works at any address: GitHub Pages
  // (https://<user>.github.io/<repo>/), a custom domain, or locally.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // The on-device database engine makes the main bundle large; that is expected.
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
  },
});
