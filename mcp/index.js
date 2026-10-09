#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Store } from "./store.js";
import { createServer } from "./server.js";

// Keep private database/WAL files owner-only. stdout belongs exclusively to MCP.
process.umask(0o077);
const path = process.env.KOOKS_DB_PATH
  ? resolve(process.env.KOOKS_DB_PATH)
  : fileURLToPath(new URL("../.data/kooks.sqlite", import.meta.url));
const store = new Store(path);
const handle = serveStdio(() => createServer(store), {
  onerror: (error) => console.error(`Kooks MCP: ${error.message}`),
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await handle.close();
  store.close();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
process.stdin.once("end", () => void stop());
