import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The managed Chromium is the default. PLAYWRIGHT_CHANNEL selects an installed
// browser such as "chrome"; PLAYWRIGHT_EXECUTABLE_PATH points at a specific
// binary when a matching managed build cannot be downloaded.
const browser = {
  ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? {
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
        },
      }
    : {}),
};

// One empty database per run for the browser app. Workers inherit the value.
process.env.KOOKS_E2E_DB ??= join(
  mkdtempSync(join(tmpdir(), "kooks-web-e2e-")),
  "kooks.sqlite",
);

export default defineConfig({
  testDir: "./test",
  fullyParallel: false,
  workers: 1,
  use: { trace: "retain-on-failure", ...browser },
  projects: [
    {
      name: "mobile",
      testDir: "./test/mobile-e2e",
      use: {
        baseURL: "http://127.0.0.1:4173",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "web",
      testDir: "./test/web-e2e",
      use: {
        baseURL: "http://127.0.0.1:4318",
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: [
    {
      command: "npm run build:mobile && npm run preview:mobile",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node web/server.js",
      url: "http://127.0.0.1:4318/",
      env: {
        PORT: "4318",
        KOOKS_HOST: "127.0.0.1",
        KOOKS_DB_PATH: process.env.KOOKS_E2E_DB,
      },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
