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
// const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? './data/Downloads'; // TODO, downloading is currently not working

const FULL_URL = `${BASE_URL}?${QUERY_PARAMS.toString()}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait for navigation and basic page stability */
async function waitForStable(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
}

async function readKeyValue(page: Page, keyName: string): Promise<string> {
  try {
    const row = page.locator('tr').filter({ has: page.locator('td').filter({ hasText: new RegExp(`^\\s*${keyName}\\s*$`) }) });
    const valueCell = row.locator('td').nth(1);
    return (await valueCell.innerText({ timeout: 5_000 })).trim();
  } catch {
    return 'unknown';
  }
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
  await page.waitForTimeout(2000); // give Angular time to render

  console.log(`🔍 Looking for issue: "${ISSUE_TYPE}"`);
          
  await page.locator('a.link-wrapper', { has: page.locator('mark.fire-highlight', { hasText: `${ISSUE_BASE}`}) })
    .filter({ hasText: `${ISSUE_TYPE}` })
    .first().click();

  await waitForStable(page);
  console.log('✅ Issue opened');

  const COLLECT_LIMIT = parseInt(process.env.COLLECT_LIMIT ?? '0');

  let eventIndex = 0;

  // ── Main loop: iterate through all events ─────────────────────────────────
  while (true) {
    eventIndex++;
    console.log(`\n📄 Processing event #${eventIndex}`);

    // ── Step 3: Open Data tab ───────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Data', exact: true }).click();
    await waitForStable(page);
    await page.waitForSelector('.data-line-item', { timeout: 3_000 });

    const idRow = await readDataLineItem(page, 'ID');
    const identification_link = idRow.text;
    const identification_id = identification_link.split('/').pop() ?? identification_link;
    const user_id = identification_id;

    const { app_version, os_version: rawOs, model, date } = await readEventSummary(page);
    const os_version = cleanOsVersion(rawOs);
    const os_major_version = extractOsMajorVersion(os_version);

    console.log(`   ID:          ${identification_link}`);
    console.log(`   App version: ${app_version}`);
    console.log(`   OS version:  ${os_version}`);
    console.log(`   Model:       ${model}`);
    console.log(`   Date:        ${date}`);

    // ── Step 4: Check duplicate ─────────────────────────────────────────────
    const session_key = buildSessionKey(identification_id, date);
    if (sessionExists(existingRecords, session_key)) {
      console.log(`⏭️  Already processed (key: ${session_key}). Skipping.`);
    } else {

      // ── Step 5: Keys tab ───────────────────────────────────────────────────
      await page.getByRole('tab', { name: 'Keys', exact: true }).click();
      await page.waitForTimeout(800);
      await waitForStable(page);

      const source        = await readKeyValue(page, 'SOURCE');
      const status        = await readKeyValue(page, 'STATUS');
      const configuration = await readKeyValue(page, 'CONFIGURATION');
      const nserrorCode   = await readKeyValue(page, 'nserror-code');
      const nserrorDomain = await readKeyValue(page, 'nserror-domain');

      console.log(`   SOURCE: ${source}`);
      console.log(`   STATUS: ${status}`);
      console.log(`   CONFIGURATION: ${configuration}`);
      console.log(`   nserror-code: ${nserrorCode}`);
      console.log(`   nserror-domain: ${nserrorDomain}`);

      // ── Step 6: Logs tab ───────────────────────────────────────────────────
      await page.getByRole('tab', { name: 'Logs & Breadcrumbs', exact: true }).click();
      await waitForStable(page);

      const messageCell = page.locator('td.mat-column-message div').filter({ hasText: /FaceKom finished with type:/ }).first();
      const closeTypeText = await messageCell.innerText({ timeout: 5_000 }).catch(() => '');
      const closeTypeMatch = closeTypeText.match(/FaceKom finished with type:\s*(\w+)/);
      const close_type = closeTypeMatch ? closeTypeMatch[1] : 'unknown';

      const reasonCell = page.locator('td.mat-column-message div').filter({ hasText: /reason\s*=/ }).first();
      const reasonText = await reasonCell.innerText({ timeout: 5_000 }).catch(() => '');
      const reasonMatch = reasonText.match(/reason\s*=\s*"([^"]+)"/);
      const reason = reasonMatch ? reasonMatch[1] : '';

      console.log(`   Close type: ${close_type}`);
      console.log(`   Reason: ${reason}`);

      // Scrape visible log entries and save to file
      const logContent = await scrapeLogEntries(page);
      const logFilename = `${identification_id}_${date.replace(/[/:, ]/g, '_')}.log`;
      fs.mkdirSync(LOGS_DIR, { recursive: true });
      fs.writeFileSync(path.join(LOGS_DIR, logFilename), logContent);
      console.log(`📥 Log saved: ${logFilename} (${logContent.split('\n').length} lines)`);

      // ── Step 7: Save record ────────────────────────────────────────────────
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
        notes: '',
      };

      appendCsv(CSV_PATH, record);
      // Also add to in-memory list so we skip it if we somehow encounter it again
      existingRecords.push(record);
      console.log(`✅ Saved: ${session_key}`);

      if (COLLECT_LIMIT > 0 && eventIndex >= COLLECT_LIMIT) {
        console.log(`\n🛑 Limit of ${COLLECT_LIMIT} events reached. Stopping.`);
        break;
      }
    }

    // ── Navigate to next event or stop ─────────────────────────────────────
    const prevBtn = page.locator('button[aria-label="Previous event"]');
    await prevBtn.waitFor({ timeout: 2_000 });
    const isDisabled = await prevBtn.getAttribute('disabled');
    if (isDisabled !== null) {
      console.log(`\n🏁 Reached last event after ${eventIndex} events. Done!`);
      break;
    }

    await prevBtn.click();
    await waitForStable(page);
  }
});