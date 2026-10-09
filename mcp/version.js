import { readFileSync } from "node:fs";

// One source of truth for the version reported by the MCP server, the status
// tool and the mobile settings screen (through the Vite define).
export const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
