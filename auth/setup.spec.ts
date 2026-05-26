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

  // ── Email step ──────────────────────────────────────────────────────────────
  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ timeout: 15_000 });
  await emailInput.fill(process.env.GOOGLE_EMAIL ?? '');
  await page.locator('button:has-text("Next"), [jsname="LgbsSe"]').first().click();

  // ── Password step ───────────────────────────────────────────────────────────
  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.waitFor({ timeout: 10_000 });
  await passwordInput.fill(process.env.GOOGLE_PASSWORD ?? '');
  await page.locator('button:has-text("Next"), [jsname="LgbsSe"]').first().click();

  // ── 2FA / OTP — pause here for manual entry ─────────────────────────────────
  console.log('⏸️  Enter the one-time password in the browser, then click ▶ Resume in the Playwright Inspector.');
  await page.pause();

  const dir = path.dirname(SESSION_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Session saved to ${SESSION_PATH}`);
});
