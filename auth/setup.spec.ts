import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SESSION_PATH = path.resolve('auth/session.json');

test('Save Firebase session', async ({ page, context }) => {
  if (fs.existsSync(SESSION_PATH)) {
    console.log('✅ Session already exists. Delete auth/session.json to refresh.');
    return;
  }

  await page.goto('https://console.firebase.google.com');
  console.log('⏸️  Log in manually, then click ▶ Resume in the Playwright Inspector');
  await page.pause();

  const dir = path.dirname(SESSION_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Session saved to ${SESSION_PATH}`);
});