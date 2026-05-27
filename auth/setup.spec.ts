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
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log(`📍 Page: ${page.url().slice(0, 100)}`);

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
  const EMAIL_SELS = [
    'input[type="email"]',
    'input#identifierId',
    'input[name="identifier"]',
    'input[autocomplete="username"]',
    'input[type="text"]',
  ];
  let emailFilled = false;
  try {
    // Wait for any email-like input to appear
    await page.waitForSelector(EMAIL_SELS.join(', '), { state: 'visible', timeout: 10_000 });
    const inputCount = await page.locator('input:not([type="hidden"])').count();
    console.log(`🔍 Visible inputs on page: ${inputCount}`);

    for (const sel of EMAIL_SELS) {
      const el = page.locator(sel).first();
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.click();
      await el.type(email, { delay: 40 }); // char-by-char for Google's controlled input
      emailFilled = true;
      console.log(`📧 Email typed via: ${sel}`);
      break;
    }
    // Fallback: first visible textbox by role
    if (!emailFilled) {
      const tb = page.getByRole('textbox').first();
      if (await tb.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await tb.click();
        await tb.type(email, { delay: 40 });
        emailFilled = true;
        console.log('📧 Email typed via: role=textbox');
      }
    }

    if (emailFilled) {
      // Click Next — try each selector until one works
      for (const sel of ['#identifierNext', 'button:has-text("Next")', '[jsname="LgbsSe"]']) {
        try { await page.click(sel, { timeout: 3_000 }); console.log(`➡️  Next (email) via: ${sel}`); break; }
        catch {}
      }
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      console.log(`📍 After email Next: ${page.url().slice(0, 150)}`);
    } else {
      console.log('⚠️  No email input matched — skipping email step.');
    }
  } catch (e: any) {
    await page.screenshot({ path: '/tmp/gfk-setup-debug-email.png' }).catch(() => {});
    console.log('⚠️  Email step error:', e.message?.slice(0, 200));
    console.log('📸 Screenshot saved to /tmp/gfk-setup-debug-email.png');
  }

  // ── Password step ────────────────────────────────────────────────────────
  const PW_SELS = [
    'input[type="password"]',
    'input[name="password"]',
    'input[autocomplete="current-password"]',
  ];
  let pwFilled = false;
  try {
    await page.waitForSelector(PW_SELS.join(', '), { state: 'visible', timeout: 15_000 });
    for (const sel of PW_SELS) {
      const el = page.locator(sel).first();
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.click();
      await el.type(password, { delay: 40 });
      pwFilled = true;
      console.log(`🔑 Password typed via: ${sel}`);
      break;
    }
    if (pwFilled) {
      for (const sel of ['#passwordNext', 'button:has-text("Next")', '[jsname="LgbsSe"]']) {
        try { await page.click(sel, { timeout: 3_000 }); console.log(`➡️  Next (password) via: ${sel}`); break; }
        catch {}
      }
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  } catch (e: any) {
    console.log('⚠️  Password step skipped:', e.message?.slice(0, 120));
  }

  // ── 2FA or already logged in ──────────────────────────────────────────────
  // Use hostname check — URL may contain 'console.firebase.google.com' in the
  // ?continue= query param even when still on accounts.google.com
  const isAtFirebase = () => {
    try { return new URL(page.url()).hostname === 'console.firebase.google.com'; }
    catch { return false; }
  };
  console.log(`📍 Pre-2FA URL: ${page.url().slice(0, 150)}`);
  if (isAtFirebase()) {
    console.log('✅ Already at Firebase Console (no 2FA needed).');
  } else {
    console.log('⏸️  Enter your 2FA code in the browser…');
    await page.waitForURL(url => { try { return new URL(url.href).hostname === 'console.firebase.google.com'; } catch { return false; } }, { timeout: 120_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    console.log('✅ Firebase Console loaded.');
  }

  // ── Save session ──────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  await context.storageState({ path: SESSION_PATH });
  console.log(`💾 Session saved → ${SESSION_PATH}`);
});
