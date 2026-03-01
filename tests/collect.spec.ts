/**
 * GFK – Firebase Crashlytics issue collector
 *
 * Collects non-fatal issues from Firebase Crashlytics and saves them to a CSV.
 * Already-processed sessions are skipped (identified by ID + Date composite key).
 * Downloaded log files are renamed for easy lookup.
 *
 * Usage:
 *   npm run collect            (visible browser)
 *   npm run collect:headless   (headless)
 */

import { test, expect, Page } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  readCsv,
  sessionExists,
  appendCsv,
  cleanOsVersion,
  extractOsMajorVersion,
  buildSessionKey,
  IssueRecord,
  ensureDirExists,
} from '../utils/csv';
import { title } from 'process';

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = `https://console.firebase.google.com/project/${process.env.FIREBASE_PROJECT}/crashlytics/app/${process.env.FIREBASE_APP}/issues`;
const ISSUE_TYPE = process.env.ISSUE_TYPE ?? 'handleFlow(0)';
const ISSUE_BASE = process.env.ISSUE_BASE ?? 'FaceKom';
const CSV_PATH = path.resolve(process.env.CSV_OUTPUT ?? './data/issues.csv');
const LOGS_DIR = path.resolve(process.env.LOGS_DIR ?? './data/logs');
const QUERY_PARAMS = new URLSearchParams({
  state: process.env.ISSUE_STATE ?? 'open',
  time: process.env.ISSUE_TIME ?? '90d',
  tag: process.env.ISSUE_TAG ?? 'all',
  sort: process.env.ISSUE_SORT ?? 'eventCount',
  versions: process.env.ISSUE_VERSIONS ?? '',
  types: process.env.ISSUE_TYPES ?? 'error',
  issuesQuery: process.env.ISSUE_QUERY ?? 'FaceKom',
});
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? './data/Downloads';

const FULL_URL = `${BASE_URL}?${QUERY_PARAMS.toString()}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait for navigation and basic page stability */
async function waitForStable(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
}

async function readKeyValue(page: Page, keyName: string): Promise<string> {
  const row = page.locator('tr').filter({ has: page.locator('td').filter({ hasText: new RegExp(`^\\s*${keyName}\\s*$`) }) });
  const valueCell = row.locator('td').nth(1);
  return (await valueCell.innerText({ timeout: 10_000 })).trim();
}

async function readEventSummary(page: Page): Promise<{ app_version: string; os_version: string; model: string; date: string }> {
  return await page.evaluate(() => {
    function getText(root: Document | ShadowRoot, selector: string): string {
      const el = root.querySelector(selector);
      if (el) return el.textContent?.trim() ?? '';
      for (const node of Array.from(root.querySelectorAll('*'))) {
        if ((node as Element).shadowRoot) {
          const found = getText((node as Element).shadowRoot!, selector);
          if (found) return found;
        }
      }
      return '';
    }

    return {
      app_version: getText(document, '.session-build-version .header-item-text'),
      os_version:  getText(document, '.session-os .header-item-text'),
      model:       getText(document, '.session-device .header-item-text'),
      date:        getText(document, '.session-time .header-item-text'),
    };
  });
}

async function readDataLineItem(page: Page, labelText: string): Promise<{ text: string; href: string }> {
  const result = await page.evaluate((label) => {
    function search(root: Document | ShadowRoot): { text: string; href: string } | null {
      const items = root.querySelectorAll('.data-line-item');
      for (const item of Array.from(items)) {
        const lbl = item.querySelector('label');
        if (lbl?.textContent?.trim().replace(/:$/, '') === label) {
          const span = item.querySelector('.data-value');
          const anchor = item.querySelector('a');
          return {
            text: span?.textContent?.trim() ?? '',
            href: anchor?.href ?? ''
          };
        }
      }
      // recurse into shadow roots
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if ((el as Element).shadowRoot) {
          const found = search((el as Element).shadowRoot!);
          if (found) return found;
        }
      }
      return null;
    }
    return search(document);
  }, labelText);

  return result ?? { text: '', href: '' };
}

async function scrapeLogEntries(page: Page): Promise<string> {
  return await page.evaluate(() => {
    function scrape(root: Document | ShadowRoot): string[] {
      const rows = Array.from(root.querySelectorAll('tr.data-row, tbody tr'));
      if (rows.length > 0) {
        return rows.map(row => {
          const cells = Array.from(row.querySelectorAll('td'));
          return cells.map(c => c.textContent?.trim() ?? '').join('\t');
        }).filter(r => r.trim());
      }
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if ((el as Element).shadowRoot) {
          const found = scrape((el as Element).shadowRoot!);
          if (found.length > 0) return found;
        }
      }
      return [];
    }
    return scrape(document).join('\n');
  });
}

// ── Main test ─────────────────────────────────────────────────────────────────

test('Collect Crashlytics FaceKom issues', async ({ page, context }) => {
  ensureDirExists(CSV_PATH);
  ensureDirExists(path.join(LOGS_DIR, '.keep'));

  const existingRecords = readCsv(CSV_PATH);
  console.log(`📋 CSV loaded: ${existingRecords.length} existing records`);

  // ── Step 1: Navigate to Crashlytics ──────────────────────────────────────
  console.log(`🌐 Opening: ${FULL_URL}`);
  await page.goto(FULL_URL);
  await waitForStable(page);

  // Check for login wall
  const isLoginPage = await page.locator('input[type="email"], [data-identifier="email"]').isVisible().catch(() => false);
  if (isLoginPage) {
    throw new Error('BLOCKER: Login required. Please authenticate first by running: npx playwright codegen --save-storage=auth/session.json https://console.firebase.google.com');
  }

  // ── Step 2: Find the matching issue row ───────────────────────────────────
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000); // give Angular time to render

  console.log(`🔍 Looking for issue: "${ISSUE_TYPE}"`);
          
  await page.locator('a.link-wrapper', { has: page.locator('mark.fire-highlight', { hasText: `${ISSUE_BASE}`}) })
    .filter({ hasText: `${ISSUE_TYPE}` })
    .first().click();

  await waitForStable(page);
  console.log('✅ Issue opened');

  // ── Step 3: Open Data tab ─────────────────────────────────────────────────
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await waitForStable(page);
  console.log('📂 Data tab opened');

  // Read ID row (with link)
  await page.waitForSelector('.data-line-item', { timeout: 5_000 });

  const idRow = await readDataLineItem(page, 'ID');
  const identification_link = idRow.text; // full URL
  const identification_id = identification_link.split('/').pop() ?? identification_link;
  console.log('Got ID:', identification_link);

  // Read Event summary row
  const { app_version, os_version: rawOs, model, date } = await readEventSummary(page);
  const os_version = cleanOsVersion(rawOs);
  const os_major_version = extractOsMajorVersion(os_version);

  console.log(`   ID:          ${identification_link}`);
  console.log(`   App version: ${app_version}`);
  console.log(`   OS version:  ${os_version}`);
  console.log(`   Model:       ${model}`);
  console.log(`   Date:        ${date}`);

  const user_id = identification_link.split('/').pop() ?? ''

  // ── Step 4: Build session key and check if already processed ──────────────
  const session_key = buildSessionKey(identification_id, date);
  if (sessionExists(existingRecords, session_key)) {
    console.log(`⏭️  Session already processed (key: ${session_key}). Skipping.`);
    return;
  }

  // ── Step 5: Open Keys tab ─────────────────────────────────────────────────
  await page.getByRole('tab', { name: 'Keys', exact: true }).click();
  await page.waitForTimeout(1000);
  await waitForStable(page);
  console.log('🔑 Keys tab opened');

  const source        = await readKeyValue(page, 'SOURCE');
  const status        = await readKeyValue(page, 'STATUS');
  const configuration = await readKeyValue(page, 'CONFIGURATION');
  const nserrorCode   = await readKeyValue(page, 'nserror-code');
  const nserrorDomain = await readKeyValue(page, 'nserror-domain');

  console.log(`   SOURCE:        ${source}`);
  console.log(`   STATUS:        ${status}`);
  console.log(`   CONFIGURATION: ${configuration}`);
  console.log(`   nserror-code:  ${nserrorCode}`);
  console.log(`   nserror-domain:${nserrorDomain}`);

  // ── Step 6: Download logs ─────────────────────────────────────────────────
  await page.getByRole('tab', { name: 'Logs & Breadcrumbs', exact: true }).click();
  await waitForStable(page);
  console.log('📜 Logs & Breadcrumbs tab opened');

  const messageCell = page.locator('td.mat-column-message div').filter({ hasText: /FaceKom finished with type:/ }).first();
  const closeTypeText = await messageCell.innerText({ timeout: 10_000 });
  const closeTypeMatch = closeTypeText.match(/FaceKom finished with type:\s*(\w+)/);
  const close_type = closeTypeMatch ? closeTypeMatch[1] : 'unknown';
  console.log(`   Close type: ${close_type}`);

  const client = await page.context().newCDPSession(page);

  const reasonCell = page.locator('td.mat-column-message div').filter({ hasText: /reason\s*=/ }).first();
  const reasonText = await reasonCell.innerText({ timeout: 10_000 }).catch(() => '');
  const reasonMatch = reasonText.match(/reason\s*=\s*"([^"]+)"/);
  const reason = reasonMatch ? reasonMatch[1] : '';
  console.log(`   Reason: ${reason}`);
  
  // Enable fetch interception at CDP level
  await client.send('Fetch.enable', {
    patterns: [{ urlPattern: 'blob:*', requestStage: 'Request' }],
  });

  client.on('Fetch.requestPaused', async (event) => {
    console.log('🎯 Blob intercepted:', event.request.url);
    await client.send('Fetch.continueRequest', { requestId: event.requestId });
  });

  await page.locator('button').filter({ hasText: /download logs/i }).first().click();
  await page.waitForTimeout(5000);
  const logContent = await scrapeLogEntries(page);
  const logFilename = `${identification_id}_${date.replace(/[/:, ]/g, '_')}.log`;
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  fs.writeFileSync(`${DOWNLOADS_DIR}/${logFilename}`, logContent);
  console.log(`📥 Log saved: ${logFilename}`);

  // ── Step 7: Build and save the record ─────────────────────────────────────
  const record: IssueRecord = {
    session_key,
    identification_link,
    user_id,
    close_type,
    app_version,
    os_version,
    os_major_version,
    model,
    date,
    source,
    status,
    configuration,
    nserrorCode,
    nserrorDomain,
    log_filename: logFilename,
    reason,
    issue_type: ISSUE_TYPE,
    collected_at: new Date().toISOString(),
    notes: "",
  };

  appendCsv(CSV_PATH, record);
  console.log(`✅ Record saved to CSV: ${CSV_PATH}`);
  console.log(`   session_key: ${session_key}`);
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}