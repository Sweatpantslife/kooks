import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
// The household server the dev server sends /api to (`npm run web`).
const api = process.env.KOOKS_API ?? "http://127.0.0.1:4317";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  define: { __KOOKS_VERSION__: JSON.stringify(version) },
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: ["safari15", "chrome108"],
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      // The server only accepts changes sent from its own address.
      "/api": {
        target: api,
        changeOrigin: true,
        configure: (proxy) =>
          proxy.on("proxyReq", (req) => {
            if (req.getHeader("origin")) req.setHeader("origin", api);
          }),
      },
    },
  },
});
