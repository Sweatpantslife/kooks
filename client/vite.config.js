import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { pagePolicy } from "./page-policy.js";

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
  plugins: [
    {
      // Only the built page: the dev server adds styles as it goes, which
      // the policy would refuse.
      name: "kooks-page-policy",
      apply: "build",
      transformIndexHtml(html) {
        const charset = '<meta charset="utf-8" />';
        if (!html.includes(charset)) throw new Error("index.html: no charset");
        return html.replace(
          charset,
          `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${pagePolicy}" />`,
        );
      },
    },
  ],
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
