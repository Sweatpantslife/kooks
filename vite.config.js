import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig({
  root: "app",
  base: "./",
  define: { __KOOKS_VERSION__: JSON.stringify(version) },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: ["safari15", "chrome108"],
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
