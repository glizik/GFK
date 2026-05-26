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

  const email    = process.env.GOOGLE_EMAIL    ?? '';
  const password = process.env.GOOGLE_PASSWORD ?? '';

  if (email && password) {
    // ── Auto-fill: handle account chooser, email step, password step ─────────

    // If Google shows the account chooser first, click the matching account.
    const isChooser = await page.locator('text=Choose an account').isVisible().catch(() => false);
    if (isChooser) {
      const accountBtn = page.locator(`[data-email="${email}"], li:has-text("${email}")`).first();
      await accountBtn.click().catch(() => page.getByRole('listitem').filter({ hasText: '@' }).first().click());
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    }

    const emailInput = page.locator('input[type="email"]');
    const emailVisible = await emailInput.isVisible().catch(() => false);
    if (emailVisible) {
      await emailInput.fill(email);
      await page.locator('button:has-text("Next"), [jsname="LgbsSe"]').first().click();

      // Google may skip the password step if it trusts the device — handle both.
      const passwordInput = page.locator('input[type="password"]');
      const passwordVisible = await passwordInput.isVisible({ timeout: 5_000 }).catch(() => false);
      if (passwordVisible) {
        await passwordInput.fill(password);
        await page.locator('button:has-text("Next"), [jsname="LgbsSe"]').first().click();
      }
    }

    // ── 2FA / OTP — pause here for manual entry ─────────────────────────────
    console.log('⏸️  Enter the one-time password in the browser, then click ▶ Resume in the Playwright Inspector.');
    await page.pause();
  } else {
    // ── Manual login: let the user do everything, then resume ────────────────
    console.log('⚠️  GOOGLE_EMAIL / GOOGLE_PASSWORD not set — log in manually in the browser.');
    console.log('    When Firebase Console has loaded, click ▶ Resume in the Playwright Inspector.');
    await page.pause();
  }

  const dir = path.dirname(SESSION_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Session saved to ${SESSION_PATH}`);
});
