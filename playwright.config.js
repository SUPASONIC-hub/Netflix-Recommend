const { defineConfig } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const hasExternalBaseUrl = !!process.env.E2E_BASE_URL;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: hasExternalBaseUrl
    ? undefined
    : {
        command: 'npm start',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
