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

const FULL_URL = `${BASE_URL}?${QUERY_PARAMS.toString()}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait for navigation and basic page stability */
async function waitForStable(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
}

/** Read text from a labelled row in the Data or Keys tab */
async function readLabelledRow(page: Page, label: string): Promise<{ text: string; href: string | null }> {
  // Crashlytics uses a definition-list style: label in one cell, value in next
  const labelEl = page.locator(`td, th, .metadata-key, [class*="label"]`).filter({ hasText: new RegExp(`^${label}$`, 'i') }).first();
  await expect(labelEl).toBeVisible({ timeout: 15_000 });

  // The value is typically the next sibling cell or a nearby element
  const valueEl = labelEl.locator('..').locator('td, .metadata-value, [class*="value"]').last();
  const text = (await valueEl.innerText()).trim();
  const anchor = valueEl.locator('a').first();
  const href = await anchor.getAttribute('href').catch(() => null);
  return { text, href };
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

/** Parse "Event summary" string into its components */
function parseEventSummary(summary: string): {
  app_version: string;
  os_version: string;
  model: string;
  date: string;
} {
  // Example: "3.6.1 (2662)  iosiOS 16.4.1  iPhone 14 Pro  Jan 15, 2024, 10:23:00 AM"
  // Fields are separated by 2+ spaces or tab characters
  const parts = summary.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
  return {
    app_version: parts[0] ?? '',
    os_version: parts[1] ?? '',
    model: parts[2] ?? '',
    date: parts.slice(3).join(' ') ?? '',
  };
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

  // ── Step 4: Build session key and check if already processed ──────────────
  const session_key = buildSessionKey(identification_id, date);
  if (sessionExists(existingRecords, session_key)) {
    console.log(`⏭️  Session already processed (key: ${session_key}). Skipping.`);
    return;
  }

  // ── Step 5: Open Keys tab ─────────────────────────────────────────────────
  await page.getByRole('tab', { name: 'Keys', exact: true }).click();
  await waitForStable(page);
  console.log('🔑 Keys tab opened');

  const sourceRow = await readLabelledRow(page, 'SOURCE');
  const source = sourceRow.text;

  const statusRow = await readLabelledRow(page, 'STATUS');
  const status = statusRow.text;

  console.log(`   SOURCE: ${source}`);
  console.log(`   STATUS: ${status}`);

  // ── Step 6: Download logs ─────────────────────────────────────────────────
  await page.getByRole('tab', { name: 'Logs & Breadcrumbs', exact: true }).click();
  await waitForStable(page);
  console.log('📜 Logs & Breadcrumbs tab opened');

  // Build a safe filename: sanitise identification + date
  const safeName = `${identification_id}_${date}`.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const logFilename = `${safeName}.log`;
  const logFilePath = path.join(LOGS_DIR, logFilename);

  const downloadBtn = page.locator('button, a').filter({ hasText: /Download logs/i }).first();
  const btnVisible = await downloadBtn.isVisible().catch(() => false);

  if (btnVisible) {
    const [download] = await Promise.all([
      context.waitForEvent('download'),
      downloadBtn.click(),
    ]);
    await download.saveAs(logFilePath);
    console.log(`💾 Log saved: ${logFilePath}`);
  } else {
    console.warn('⚠️  Download logs button not found – log_filename will be empty');
    fs.writeFileSync(logFilePath, '(no log available)\n');
    console.log(`📝 Placeholder log created: ${logFilePath}`);
  }

  // ── Step 7: Build and save the record ─────────────────────────────────────
  const record: IssueRecord = {
    session_key,
    identification_link,
    app_version,
    os_version,
    os_major_version,
    model,
    date,
    source,
    status,
    log_filename: logFilename,
    issue_type: ISSUE_TYPE,
    collected_at: new Date().toISOString(),
    is_error: true,
  };

  appendCsv(CSV_PATH, record);
  console.log(`✅ Record saved to CSV: ${CSV_PATH}`);
  console.log(`   session_key: ${session_key}`);
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}