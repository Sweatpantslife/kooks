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

// One empty database per run for the browser app. Workers inherit the value.
process.env.KOOKS_E2E_DB ??= join(
  mkdtempSync(join(tmpdir(), "kooks-web-e2e-")),
  "kooks.sqlite",
);
// A second browser app with sign-in on: one household address, and sign-in
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
    {
      // Passkeys need a named host; localhost counts as secure.
      name: "web-auth",
      testDir: "./test/web-auth-e2e",
      use: {
        baseURL: "http://localhost:4319",
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
    {
      command: "node web/server.js",
      url: "http://127.0.0.1:4319/healthz",
      env: {
        PORT: "4319",
        KOOKS_HOST: "127.0.0.1",
        KOOKS_DB_PATH: process.env.KOOKS_E2E_AUTH_DB,
        KOOKS_HOUSEHOLD_EMAILS: "cook@example.test, baker@example.test",
        KOOKS_MAIL_OUTBOX: process.env.KOOKS_E2E_OUTBOX,
      },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
