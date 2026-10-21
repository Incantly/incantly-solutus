import { defineConfig, devices } from '@playwright/test';

const port = 5173;

export default defineConfig({
  testDir: 'apps/playground/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node scripts/generate.mjs && npm run dev --workspace @incantly/playground -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /perf\// },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: /perf\// },
    {
      name: 'perf',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /perf\/.*\.spec\.ts/,
      fullyParallel: false,
    },
  ],
});
