import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SESSION_PATH = path.resolve('auth/session.json');

(async () => {
  if (fs.existsSync(SESSION_PATH)) {
    console.log(`✅ Session already exists at ${SESSION_PATH}`);
    console.log('   Delete it and re-run to refresh your session.');
    process.exit(0);
  }

  console.log('🔐 Opening browser for manual login...');

  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://console.firebase.google.com');

  console.log('⏸️  Please log in manually, then click ▶ Resume in the Playwright Inspector');
  await page.pause();

  const dir = path.dirname(SESSION_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Session saved to ${SESSION_PATH}`);

  await browser.close();
})();