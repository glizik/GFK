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

  // Firebase redirects to accounts.google.com — wait for that before doing anything
  await page.waitForURL('**/accounts.google.com/**', { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // ── Account chooser ──────────────────────────────────────────────────────
  const isChooser = await page.locator('text=Choose an account').isVisible().catch(() => false);
  if (isChooser && email) {
    console.log('👤 Account chooser detected — clicking matching account.');
    const accountBtn = page.locator(`[data-email="${email}"], li:has-text("${email}")`).first();
    await accountBtn.click().catch(() =>
      page.getByRole('listitem').filter({ hasText: '@' }).first().click()
    );
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  // ── Email step ───────────────────────────────────────────────────────────
  const emailInput = page.locator('input[type="email"], input#identifierId, input[autocomplete="username"]').first();
  try {
    await emailInput.waitFor({ state: 'visible', timeout: 10_000 });
    if (email) {
      await emailInput.fill(email);
      console.log(`📧 Email pre-filled (${email}).`);
    }
    const nextBtn = page.locator('#identifierNext, button:has-text("Next"), [jsname="LgbsSe"]').first();
    await nextBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await nextBtn.click();
    console.log('➡️  Clicked Next (email step).');
    await page.waitForTimeout(2000);
  } catch {
    console.log('⚠️  Email step not detected — continuing.');
  }

  // ── Password step ────────────────────────────────────────────────────────
  const passwordInput = page.locator('input[type="password"], input[name="password"], input[autocomplete="current-password"]').first();
  try {
    await passwordInput.waitFor({ state: 'visible', timeout: 10_000 });
    if (password) {
      await passwordInput.fill(password);
      console.log('🔑 Password pre-filled.');
    }
    const nextBtn = page.locator('#passwordNext, button:has-text("Next"), [jsname="LgbsSe"]').first();
    await nextBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await nextBtn.click();
    console.log('➡️  Clicked Next (password step).');
    await page.waitForTimeout(1000);
  } catch {
    console.log('⚠️  Password step not detected — continuing.');
  }

  // ── 2FA — user enters the code, script waits for Firebase Console ─────────
  console.log('⏸️  Enter your 2FA code in the browser. Waiting for Firebase Console to load…');
  await page.waitForURL('**/console.firebase.google.com/**', { timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  console.log('✅ Firebase Console loaded.');

  // ── Save session ─────────────────────────────────────────────────────────
  const dir = path.dirname(SESSION_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Session saved → ${SESSION_PATH}`);
});
