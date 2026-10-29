import { defineConfig } from "@playwright/test";

// Manual smoke test only (not in CI). Start the app first (`npm run preview`) or point E2E_BASE_URL at a deployment.
// Uses an already installed Chromium/Chrome: set E2E_CHROMIUM to its path, otherwise Playwright's default lookup applies.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8787",
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
});
