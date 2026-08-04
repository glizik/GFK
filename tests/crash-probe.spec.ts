/**
 * One-off probe for CRASH-type issues (types=crash), which the normal discovery misses:
 * discover-issues.spec.ts matches rows via `mark.fire-highlight` (the search highlight), so it
 * only ever sees issues whose title matches ISSUE_QUERY="FaceKom" — and a real crash is named
 * after the crashing frame, not after FaceKom.
 *
 * Run:
 *   HEADLESS=true CRASH_ISSUE_URL="<full console URL>" npx playwright test tests/crash-probe.spec.ts
 */
import { test } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const BASE = `https://console.firebase.google.com/project/${process.env.FIREBASE_PROJECT}` +
  `/crashlytics/app/${process.env.FIREBASE_APP}/issues`;
const VERSIONS = process.env.ISSUE_VERSIONS ?? '3.8.0 (2811)';
const TIME = process.env.ISSUE_TIME_DEFAULT ?? '90d';
const DETAIL_URL = process.env.CRASH_ISSUE_URL ?? '';
const OUT = path.resolve('./data/crash-probe');

test('probe crash issues', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  test.setTimeout(5 * 60 * 1000);

  // ── 1. the crash issue list ────────────────────────────────────────────────
  const listUrl = `${BASE}?${new URLSearchParams({
    state: 'open', tag: 'all', sort: 'eventCount', versions: VERSIONS, types: 'crash', time: TIME,
  })}`;
  console.log('🌐 list:', listUrl);
  await page.goto(listUrl);
  await page.waitForLoadState('domcontentloaded');

  let rows = 0;
  for (let i = 0; i < 12 && rows === 0; i++) {
    await page.mouse.wheel(0, 600); await page.waitForTimeout(500);
    await page.mouse.wheel(0, -600); await page.waitForTimeout(1000);
    rows = await page.locator('a.link-wrapper').count();
  }
  console.log(`\n📋 crash issue rows: ${rows}`);

  const list: any[] = [];
  for (let i = 0; i < rows; i++) {
    const a = page.locator('a.link-wrapper').nth(i);
    const href = await a.getAttribute('href');
    const text = (await a.innerText()).replace(/\s+/g, ' ').trim();
    // the whole table row carries the event/user counts
    let rowText = '';
    try { rowText = (await a.locator('xpath=ancestor::tr[1]').innerText()).replace(/\s+/g, ' | ').trim(); } catch {}
    list.push({ i, text, href, rowText });
    console.log(`  ${i + 1}. ${text}`);
    console.log(`     ${rowText}`);
    console.log(`     href=${href}`);
  }
  fs.writeFileSync(path.join(OUT, 'crash-issues.json'), JSON.stringify(list, null, 2));
  await page.screenshot({ path: path.join(OUT, 'crash-list.png'), fullPage: true });

  // ── 2. the specific event ──────────────────────────────────────────────────
  if (!DETAIL_URL) return;
  console.log('\n🌐 detail:', DETAIL_URL);
  await page.goto(DETAIL_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(8000);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(1200); }
  await page.mouse.wheel(0, -3000); await page.waitForTimeout(1500);

  const body = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(path.join(OUT, 'event-detail.txt'), body);
  console.log(`\n📄 detail text → ${path.join(OUT, 'event-detail.txt')} (${body.length} chars)`);
  await page.screenshot({ path: path.join(OUT, 'event-detail.png'), fullPage: true });
});
