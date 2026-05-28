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

  if (!email || !password) {
    throw new Error('GOOGLE_EMAIL and GOOGLE_PASSWORD must be set in .env');
  }

  await page.goto('https://console.firebase.google.com');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log(`📍 Page: ${page.url().slice(0, 100)}`);

  // ── Account chooser ──────────────────────────────────────────────────────
  const isChooser = await page.locator('text=Choose an account').isVisible().catch(() => false);
  if (isChooser) {
    console.log('👤 Account chooser — clicking matching account.');
    await page.locator(`[data-email="${email}"]`).first().click()
      .catch(() => page.locator(`li:has-text("${email}")`).first().click())
      .catch(() => page.getByRole('listitem').filter({ hasText: '@' }).first().click());
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  // ── Email step ───────────────────────────────────────────────────────────
  try {
    await page.waitForSelector('input#identifierId', { state: 'visible', timeout: 10_000 });
    await page.locator('input#identifierId').fill(email);
    await page.waitForTimeout(500);
    console.log(`📧 Email filled: "${email.slice(0, 8)}…"`);

    for (const sel of ['#identifierNext', 'button:has-text("Next")', '[jsname="LgbsSe"]']) {
      try { await page.click(sel, { timeout: 3_000 }); console.log(`➡️  Next (email) via: ${sel}`); break; }
      catch {}
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    console.log(`📍 After email Next: ${page.url().slice(0, 150)}`);
    await page.screenshot({ path: '/tmp/gfk-setup-after-email.png' }).catch(() => {});
    console.log('📸 /tmp/gfk-setup-after-email.png');
  } catch (e: any) {
    console.log('⚠️  Email step skipped:', e.message?.slice(0, 120));
  }

  // ── Password step ────────────────────────────────────────────────────────
  try {
    await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 15_000 });
    await page.locator('input[type="password"]').first().fill(password);
    await page.waitForTimeout(500);
    console.log('🔑 Password filled.');

    for (const sel of ['#passwordNext', 'button:has-text("Next")', '[jsname="LgbsSe"]']) {
      try { await page.click(sel, { timeout: 3_000 }); console.log(`➡️  Next (password) via: ${sel}`); break; }
      catch {}
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1000);
  } catch (e: any) {
    await page.screenshot({ path: '/tmp/gfk-setup-after-email.png' }).catch(() => {});
    console.log('⚠️  Password step skipped:', e.message?.slice(0, 120));
    console.log('📸 /tmp/gfk-setup-after-email.png');
  }

  // ── 2FA or already logged in ──────────────────────────────────────────────
  const isAtFirebase = () => {
    try { return new URL(page.url()).hostname === 'console.firebase.google.com'; }
    catch { return false; }
  };
  console.log(`📍 Pre-2FA URL: ${page.url().slice(0, 150)}`);
  if (isAtFirebase()) {
    console.log('✅ Already at Firebase Console (no 2FA needed).');
  } else {
    console.log('⏸️  Enter your 2FA code in the browser…');
    await page.waitForURL(
      url => { try { return new URL(url.href).hostname === 'console.firebase.google.com'; } catch { return false; } },
      { timeout: 120_000 }
    );
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    console.log('✅ Firebase Console loaded.');
  }

  // ── Save session ──────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Session saved → ${SESSION_PATH}`);
});
