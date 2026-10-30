import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

// One empty database per run for the app. Workers inherit the value.
process.env.KOOKS_E2E_DB ??= join(
  mkdtempSync(join(tmpdir(), "kooks-web-e2e-")),
  "kooks.sqlite",
);
// A second server with sign-in on: the household's addresses, and sign-in
// emails written to an outbox directory the suite reads.
process.env.KOOKS_E2E_AUTH_DB ??= join(
  mkdtempSync(join(tmpdir(), "kooks-web-auth-e2e-")),
  "kooks.sqlite",
);
process.env.KOOKS_E2E_OUTBOX ??= join(
  dirname(process.env.KOOKS_E2E_AUTH_DB),
  "outbox",
);

export default defineConfig({
  testDir: "./test",
  fullyParallel: false,
  workers: 1,
  use: { trace: "retain-on-failure", ...browser },
  projects: [
    {
      // The app, served by both servers below: 4318 without sign-in and
      // 4319 with it.
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
      command: "npm run build:client && node web/server.js",
      url: "http://127.0.0.1:4318/",
      env: {
        PORT: "4318",
        KOOKS_HOST: "127.0.0.1",
        KOOKS_DB_PATH: process.env.KOOKS_E2E_DB,
      },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node web/server.js",
      url: "http://127.0.0.1:4319/healthz",
      env: {
        PORT: "4319",
        KOOKS_HOST: "127.0.0.1",
        KOOKS_DB_PATH: process.env.KOOKS_E2E_AUTH_DB,
        KOOKS_HOUSEHOLD_EMAILS:
          "cook@example.test, baker@example.test, taster@example.test",
        KOOKS_MAIL_OUTBOX: process.env.KOOKS_E2E_OUTBOX,
      },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
