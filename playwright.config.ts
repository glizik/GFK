import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  testDir: './tests',
  timeout: 10 * 60 * 60 * 1000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    headless: process.env.HEADLESS === 'true',
    storageState: 'auth/session.json',
    video: 'retain-on-failure',
    screenshot: 'on',
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});