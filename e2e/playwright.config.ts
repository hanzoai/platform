import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "https://platform.hanzo.ai",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    headless: true,
    actionTimeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      testDir: "./specs",
      use: { browserName: "chromium" },
    },
  ],
});

