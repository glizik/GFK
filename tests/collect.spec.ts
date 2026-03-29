/**
 * GFK – Firebase Crashlytics issue collector
 *
 * Iterates over all configured ISSUE_TYPES_LIST entries, collects events for each,
 * downloads full log files, and saves results to CSV.
 *
 * Already-processed sessions are skipped (identified by session_key = id + date).
 * After a full successful run to the last event, the time window is narrowed
 * automatically so subsequent runs only fetch new events.
 *
 * Usage:
 *   npm run collect            (visible browser)
 *   npm run collect:headless   (headless)
 */

import { test, Page } from '@playwright/test';
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

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────

const FIREBASE_BASE = `https://console.firebase.google.com/project/${process.env.FIREBASE_PROJECT}/crashlytics/app/${process.env.FIREBASE_APP}/issues`;
const ISSUE_BASE        = process.env.ISSUE_BASE          ?? 'FaceKom';
const ISSUE_TYPES_LIST  = (process.env.ISSUE_TYPES_LIST   ?? '').split(',').map(s => s.trim());
const CSV_PATH          = path.resolve(process.env.CSV_OUTPUT        ?? './data/issues.csv');
const LOGS_DIR          = path.resolve(process.env.LOGS_DIR          ?? './data/logs');
const STATE_FILE        = path.resolve(process.env.STATE_FILE        ?? './data/state.json');
const ISSUE_TIME_DEFAULT = process.env.ISSUE_TIME_DEFAULT ?? '90d';
const COLLECT_LIMIT     = parseInt(process.env.COLLECT_LIMIT         ?? '0');

const BASE_QUERY = {
  state:       process.env.ISSUE_STATE        ?? 'open',
  tag:         process.env.ISSUE_TAG          ?? 'all',
  sort:        process.env.ISSUE_SORT         ?? 'eventCount',
  versions:    process.env.ISSUE_VERSIONS     ?? '',
  types:       process.env.ISSUE_QUERY_TYPES  ?? 'error',
  issuesQuery: process.env.ISSUE_QUERY        ?? 'FaceKom',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForStable(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
}

async function readKeyValue(page: Page, keyName: string): Promise<string> {
  try {
    const row = page.locator('tr').filter({
      has: page.locator('td').filter({ hasText: new RegExp(`^\\s*${keyName}\\s*$`) })
    });
    return (await row.locator('td').nth(1).innerText({ timeout: 5_000 })).trim();
  } catch {
    return 'unknown';
  }
}

async function readEventSummary(page: Page): Promise<{
  app_version: string; os_version: string; model: string; date: string;
}> {
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
          return { text: span?.textContent?.trim() ?? '', href: anchor?.href ?? '' };
        }
      }
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

/**
 * Try to download the full log file via the Download button.
 * Falls back to scraping visible rows if the download times out.
 */
async function downloadOrScrapeLog(page: Page, logFilePath: string): Promise<'download' | 'scraped' | 'empty'> {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });

  // Check if download button exists before attempting
  const downloadBtn = page.locator('button').filter({ hasText: /download logs/i }).first();
  const btnExists = await downloadBtn.isVisible({ timeout: 3_000 }).catch(() => false);

  if (btnExists) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        downloadBtn.click(),
      ]);
      await download.saveAs(logFilePath);
      return 'download';
    } catch { /* fall through to scrape */ }
  }

  // Scrape visible rows
  try {
    const scraped = await page.evaluate(() => {
      function scrape(root: Document | ShadowRoot): string[] {
        const rows = Array.from(root.querySelectorAll('tr.data-row, tbody tr'));
        if (rows.length > 0) {
          return rows.map(row =>
            Array.from(row.querySelectorAll('td'))
              .map(c => c.textContent?.trim() ?? '')
              .join('\t')
          ).filter(r => r.trim());
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
    if (scraped.trim()) {
      fs.writeFileSync(logFilePath, scraped);
      return 'scraped';
    }
  } catch { /* fall through */ }

  fs.writeFileSync(logFilePath, '');
  return 'empty';
}
// ── Event loop for a single issue type ───────────────────────────────────────

async function collectIssueType(
  page: Page,
  issueType: string,
  existingRecords: IssueRecord[]
): Promise<{ reachedEnd: boolean; oldestEventDate: string }> {

  const start        = process.env.ISSUE_TIME_FROM;
  const end          = process.env.ISSUE_TIME_TO;
  const timeParam = `${start}:${end}`;
  // const params = new URLSearchParams({ ...BASE_QUERY, time: timeParam});
  const timeWindow = ISSUE_TIME_DEFAULT;

  const params = new URLSearchParams({ ...BASE_QUERY, time: timeWindow });

  const url = `${FIREBASE_BASE}?${params.toString()}`;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🎯 Issue type: "${issueType}"  time: ${timeParam}`);
  console.log(`🌐 ${url}`);

  await page.goto(url);
  await waitForStable(page);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Find and click the issue row
  console.log(`🔍 Looking for issue: "${issueType}"`);
  const issueLink = page.locator('a.link-wrapper', {
    has: page.locator('mark.fire-highlight', { hasText: ISSUE_BASE })
  }).filter({ hasText: issueType }).first();

  try {
    await issueLink.waitFor({ timeout: 10_000 });
  } catch {
    console.log(`⚠️  Issue "${issueType}" not found on the page. Skipping.`);
    return { reachedEnd: true, oldestEventDate: new Date().toISOString() };
  }

  await issueLink.click();
  await waitForStable(page);
  console.log('✅ Issue opened');

  let eventIndex = 0;
  let reachedEnd = false;
  let oldestEventDate = new Date().toISOString();

  while (true) {
    eventIndex++;
    console.log(`\n📄 [${issueType}] Event #${eventIndex}`);

    // ── Data tab ────────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Data', exact: true }).click();
    await waitForStable(page);
    // await page.waitForSelector('.data-line-item', { timeout: 5_000 });

    const idRow = await readDataLineItem(page, 'ID');
    const identification_link = idRow.text || 'not available';
    const identification_id = identification_link === 'not available'
      ? 'not available'
      : identification_link.split('/').pop() ?? 'not available';
    const user_id = identification_id;

    const { app_version, os_version: rawOs, model, date } = await readEventSummary(page);
    const os_version = cleanOsVersion(rawOs);
    const os_major_version = extractOsMajorVersion(os_version);

    // Track oldest event date for state narrowing
    try {
      const eventTs = new Date(date.replace('\u202f', ' ')).toISOString();
      if (eventTs < oldestEventDate) oldestEventDate = eventTs;
    } catch { /* ignore parse errors */ }

    console.log(`   ID:    ${identification_link}`);
    console.log(`   Model: ${model}  OS: ${os_version}  App: ${app_version}`);
    console.log(`   Date:  ${date}`);

    // ── Duplicate check ─────────────────────────────────────────────────────
    const session_key = buildSessionKey(identification_id, date);

    if (sessionExists(existingRecords, session_key)) {
      console.log(`⏭️  Already processed. Skipping.`);
    } else {

      // ── Keys tab ─────────────────────────────────────────────────────────
      await page.getByRole('tab', { name: 'Keys', exact: true }).click();
      await page.waitForTimeout(800);
      await waitForStable(page);

      const source        = await readKeyValue(page, 'SOURCE');
      const status        = await readKeyValue(page, 'STATUS');
      const configuration = await readKeyValue(page, 'CONFIGURATION');
      const nserrorCode   = await readKeyValue(page, 'nserror-code');
      const nserrorDomain = await readKeyValue(page, 'nserror-domain');

      // ── Logs tab ─────────────────────────────────────────────────────────
      await page.getByRole('tab', { name: 'Logs & Breadcrumbs', exact: true }).click();
      await waitForStable(page);

      const messageCell = page.locator('td.mat-column-message div')
        .filter({ hasText: /FaceKom finished with type:/ }).first();
      const closeTypeText = await messageCell.innerText({ timeout: 5_000 }).catch(() => '');
      const closeTypeMatch = closeTypeText.match(/FaceKom finished with type:\s*(\w+)/);
      const close_type = closeTypeMatch ? closeTypeMatch[1] : 'unknown';

      const reasonCell = page.locator('td.mat-column-message div')
        .filter({ hasText: /reason\s*=/ }).first();
      const reasonText = await reasonCell.innerText({ timeout: 5_000 }).catch(() => '');
      const reasonMatch = reasonText.match(/reason\s*=\s*"([^"]+)"/);
      const reason = reasonMatch ? reasonMatch[1] : '';

      console.log(`   Close type: ${close_type}  Reason: ${reason}`);

      // ── Download log ─────────────────────────────────────────────────────
      const safeDate = date.replace(/[/:, \u202f]/g, '_');
      const logFilename = `${identification_id}_${safeDate}.log`;
      const logFilePath = path.join(LOGS_DIR, logFilename);
      const logMethod = await downloadOrScrapeLog(page, logFilePath);
      console.log(`📥 Log ${logMethod === 'download' ? 'downloaded' : 'scraped'}: ${logFilename}`);

      // ── Save record ───────────────────────────────────────────────────────
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
        issue_type: issueType,
        collected_at: new Date().toISOString(),
        notes: '',
      };

      appendCsv(CSV_PATH, record);
      existingRecords.push(record);
      console.log(`✅ Saved: ${session_key}`);

      if (COLLECT_LIMIT > 0 && eventIndex >= COLLECT_LIMIT) {
        console.log(`\n🛑 Limit of ${COLLECT_LIMIT} reached. Stopping (not marking as complete).`);
        return { reachedEnd: false, oldestEventDate };
      }
    }

    // ── Pagination ──────────────────────────────────────────────────────────
    const prevBtn = page.locator('button[aria-label="Previous event"]');

    const MAX_WAIT_MS = 10_000;           // total time we're willing to wait for button to enable
    const POLL_INTERVAL_MS = 800;         // how often to check
    const startTime = Date.now();

    let navigated = false;

    while (Date.now() - startTime < MAX_WAIT_MS) {
      // First ensure the button is attached/visible at all
      const isVisible = await prevBtn.isVisible().catch(() => false);
      if (!isVisible) {
        console.log(`Previous button not visible yet, waiting...`);
        await page.waitForTimeout(POLL_INTERVAL_MS);
        continue;
      }

      const isDisabledNow = await prevBtn.isDisabled().catch(() => true);

      if (!isDisabledNow) {
        console.log(`Previous button is now enabled → clicking to go to previous event`);
        await prevBtn.click();
        await waitForStable(page);
        await page.waitForTimeout(600);     // small buffer after click
        navigated = true;
        break;
      }

      console.log(`Previous button still disabled... waiting ${POLL_INTERVAL_MS}ms`);
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    if (!navigated) {
      // Timed out waiting for enabled state → assume end of list
      console.log(`\nGave up waiting for "Previous" button to become enabled after ~${MAX_WAIT_MS/1000}s → end of list reached.`);

      const screenshotPath = path.join(
        './data/screenshots',
        `pagination_end_${issueType.replace(/[^a-z0-9]/gi, '_')}_event${eventIndex}_${Date.now()}.png`
      );
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Saved end-of-list screenshot: ${screenshotPath}`);

      reachedEnd = true;
      break;
    }

    await prevBtn.click();
    await waitForStable(page);
  }

  return { reachedEnd, oldestEventDate };
}

// ── Main test ─────────────────────────────────────────────────────────────────

test('Collect Crashlytics FaceKom issues', async ({ page }) => {
  test.setTimeout(10 * 60 * 60 * 1000); // 10 hours

  ensureDirExists(CSV_PATH);
  ensureDirExists(path.join(LOGS_DIR, '.keep'));

  const existingRecords = readCsv(CSV_PATH);
  console.log(`📋 CSV loaded: ${existingRecords.length} existing records`);
  console.log(`📋 Issue types to collect: ${ISSUE_TYPES_LIST.join(', ')}`);

  // Check for login wall on first load
  await page.goto('https://console.firebase.google.com');
  await waitForStable(page);
  const isLoginPage = await page
    .locator('input[type="email"], [data-identifier="email"]')
    .isVisible()
    .catch(() => false);
  if (isLoginPage) {
    throw new Error('BLOCKER: Login required. Run: npx playwright test --project=setup --headed');
  }

  // ── Loop over all configured issue types ─────────────────────────────────
  for (const issueType of ISSUE_TYPES_LIST) {
    const { reachedEnd, oldestEventDate } = await collectIssueType(
      page,
      issueType,
      existingRecords
    );
  }

  console.log('\n🎉 All issue types processed.');
});
