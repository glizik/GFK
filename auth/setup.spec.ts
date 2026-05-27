import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SESSION_PATH = path.resolve('auth/session.json');

test('Save Firebase session', async ({ page, context }) => {
  if (fs.existsSync(SESSION_PATH)) {
    console.log('✅ Session already exists. Delete auth/session.json to refresh.');
    return;
  }

  const email    = process.env.GOOGLE_EMAIL    ?? '';
  const password = process.env.GOOGLE_PASSWORD ?? '';

  await page.goto('https://console.firebase.google.com');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // ── Account chooser ──────────────────────────────────────────────────────
  const isChooser = await page.locator('text=Choose an account').isVisible().catch(() => false);
  if (isChooser && email) {
    console.log('👤 Account chooser detected — clicking matching account.');
    const accountBtn = page.locator(`[data-email="${email}"], li:has-text("${email}")`).first();
    await accountBtn.click().catch(() =>
      page.getByRole('listitem').filter({ hasText: '@' }).first().click()
    );
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  // ── Email step ───────────────────────────────────────────────────────────
  const emailInput = page.locator('input[type="email"]');
  const emailVisible = await emailInput.isVisible({ timeout: 5_000 }).catch(() => false);
  if (emailVisible) {
    if (email) {
      await emailInput.fill(email);
      console.log(`📧 Email pre-filled (${email}).`);
    }
    const nextBtn = page.locator('button:has-text("Next"), [jsname="LgbsSe"]').first();
    if (await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await nextBtn.click();
      console.log('➡️  Clicked Next (email step).');
    }
    await page.waitForTimeout(2000);
  }

  // ── Password step ────────────────────────────────────────────────────────
  const passwordInput = page.locator('input[type="password"]');
  const passwordVisible = await passwordInput.isVisible({ timeout: 8_000 }).catch(() => false);
  if (passwordVisible) {
    if (password) {
      await passwordInput.fill(password);
      console.log('🔑 Password pre-filled.');
    }
    const nextBtn = page.locator('button:has-text("Next"), [jsname="LgbsSe"]').first();
    if (await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await nextBtn.click();
      console.log('➡️  Clicked Next (password step).');
    }
    await page.waitForTimeout(1000);
  }

  // ── 2FA — user enters the code in the browser, script waits ─────────────
  console.log('⏸️  Enter the 2FA code in the browser. Waiting for Firebase Console to load…');
  await page.waitForURL('**/console.firebase.google.com/**', { timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  console.log('✅ Firebase Console loaded.');

  // ── Save session ─────────────────────────────────────────────────────────
  const dir = path.dirname(SESSION_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Session saved → ${SESSION_PATH}`);
});
