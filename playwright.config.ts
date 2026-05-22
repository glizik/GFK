import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config();

export default defineConfig({
  testDir: './tests',
  timeout: 10 * 60 * 60 * 1000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '/tmp/gfk-test-results',
  use: {
    headless: process.env.HEADLESS === 'true',
    storageState: fs.existsSync('auth/session.json') ? 'auth/session.json' : undefined,
    video: 'retain-on-failure',
    screenshot: 'on',
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'setup',
      testDir: './auth',
      testMatch: 'setup.spec.ts',
      use: { 
        ...devices['Desktop Chrome'], 
        channel: 'chrome', 
        storageState: undefined, 
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled'],
        },
      },
    },
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});