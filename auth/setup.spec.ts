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

  // page.goto follows HTTP redirects; networkidle lets the sign-in SPA render
  await page.goto('https://console.firebase.google.com');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

  // Already logged in?
  if (page.url().includes('console.firebase.google.com')) {
    console.log('✅ Already at Firebase Console — saving session directly.');
    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
    await context.storageState({ path: SESSION_PATH });
    console.log(`💾 Session saved → ${SESSION_PATH}`);
    return;
  }

  // ── Account chooser ──────────────────────────────────────────────────────
  const isChooser = await page.locator('text=Choose an account').isVisible().catch(() => false);
  if (isChooser && email) {
    console.log('👤 Account chooser — clicking matching account.');
    await page.locator(`[data-email="${email}"]`).first().click()
      .catch(() => page.locator(`li:has-text("${email}")`).first().click())
      .catch(() => page.getByRole('listitem').filter({ hasText: '@' }).first().click());
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  // ── Email step ───────────────────────────────────────────────────────────
  const emailSel = 'input[type="email"], input#identifierId, input[name="identifier"], input[autocomplete="username"]';
  try {
    await page.waitForSelector(emailSel, { state: 'visible', timeout: 15_000 });
    if (email) {
      await page.fill(emailSel, email);
      console.log(`📧 Email filled (${email}).`);
    }
    await page.click('#identifierNext, button:has-text("Next"), [jsname="LgbsSe"]');
    console.log('➡️  Next (email).');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } catch (e: any) {
    console.log('⚠️  Email step skipped:', e.message?.slice(0, 120));
  }

  // ── Password step ────────────────────────────────────────────────────────
  const pwSel = 'input[type="password"], input[name="password"], input[autocomplete="current-password"]';
  try {
    await page.waitForSelector(pwSel, { state: 'visible', timeout: 10_000 });
    if (password) {
      await page.fill(pwSel, password);
      console.log('🔑 Password filled.');
    }
    await page.click('#passwordNext, button:has-text("Next"), [jsname="LgbsSe"]');
    console.log('➡️  Next (password).');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1000);
  } catch (e: any) {
    console.log('⚠️  Password step skipped:', e.message?.slice(0, 120));
  }

  // ── 2FA — user enters code, script waits ─────────────────────────────────
  console.log('⏸️  Enter your 2FA code in the browser…');
  await page.waitForURL(url => url.href.includes('console.firebase.google.com'), { timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  console.log('✅ Firebase Console loaded.');

  // ── Save session ─────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Session saved → ${SESSION_PATH}`);
});
