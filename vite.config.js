import { defineConfig } from "vite";

export default defineConfig({
  root: "public",
  publicDir: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
