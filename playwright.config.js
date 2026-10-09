import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/mobile-e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build:mobile && npm run preview:mobile",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
