import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: ["safari15", "chrome108"],
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
