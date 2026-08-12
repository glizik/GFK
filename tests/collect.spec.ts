/**
 * GFK – 3.7.0 event collector
 *
 * Reads ISSUE_TYPES_LIST from .env, navigates to each issue in the
 * Crashlytics issue list, and collects all events into events_3.7.0.csv.
 *
 * Dedup key: event_url (issue_id + sessionEventKey from page URL).
 * On completion, increments processed_events in issues_3.7.0.csv.
 *
 * Usage:
 *   npm run collect            (visible browser)
 *   npm run collect:headless   (headless)
 */

import { test, Page } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { cleanOsVersion, extractOsMajorVersion, ensureDirExists } from '../utils/csv';

dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────

const FIREBASE_BASE =
  `https://console.firebase.google.com/project/${process.env.FIREBASE_PROJECT}` +
  `/crashlytics/app/${process.env.FIREBASE_APP}/issues`;

const ISSUE_BASE              = process.env.ISSUE_BASE              ?? 'FaceKom';
const ISSUE_DIRECT_ID         = process.env.ISSUE_DIRECT_ID         ?? '';
const ISSUE_TYPES_LIST        = (process.env.ISSUE_TYPES_LIST       ?? '').split(',').map(s => s.trim()).filter(Boolean);
const EVENTS_CSV              = path.resolve(process.env.EVENTS_CSV  ?? './data/events_3.7.0.csv');
const ISSUES_CSV              = path.resolve(process.env.ISSUES_CSV  ?? './data/issues_3.7.0.csv');
const LOGS_DIR                = path.resolve(process.env.LOGS_DIR    ?? './data/logs');
const ISSUE_TIME_DEFAULT      = process.env.ISSUE_TIME_DEFAULT       ?? '90d';
const COLLECT_LIMIT           = parseInt(process.env.COLLECT_LIMIT   ?? '0');
/** FaceKom session UUID to force-recollect (removes matching events from dedup before run). */
const FORCE_RECOLLECT_FK      = (process.env.FORCE_RECOLLECT_FK_SESSION ?? '').trim();

const BASE_QUERY = {
  state:       process.env.ISSUE_STATE       ?? 'open',
  tag:         process.env.ISSUE_TAG         ?? 'all',
  sort:        process.env.ISSUE_SORT        ?? 'eventCount',
  versions:    process.env.ISSUE_VERSIONS    ?? '',
  types:       process.env.ISSUE_QUERY_TYPES ?? 'error',
  issuesQuery: process.env.ISSUE_QUERY       ?? 'FaceKom',
};

// ── EventRecord (3.7.0 schema) ────────────────────────────────────────────────

const EVENT_HEADERS = [
  'event_url', 'issue_id', 'session_event_key',
  'session_id_full', 'session_id_base', 'report_index', 'event_id',
  'user_id_base', 'user_id_suffix', 'identification_link',
  'app_version', 'os_version', 'os_major_version', 'model', 'date',
  'crash_kind', 'nserror_code', 'nserror_domain',
  'source', 'status', 'configuration',
  'breadcrumbs_status', 'nslocalized_description',
  'orientation_device', 'ram_free_mib', 'jailbroken', 'orientation_os',
  'outcome', 'reason', 'last_step', 'steps_reached',
  'screen_views', 'n_status_changes',
  'first_breadcrumb_ts', 'last_breadcrumb_ts', 'session_elapsed_s',
] as const;

type EventHeader = typeof EVENT_HEADERS[number];
type EventRecord = Record<EventHeader, string>;

// ── CSV helpers ───────────────────────────────────────────────────────────────

function escapeCsv(v: string): string {
  if (v == null) return '';
  return (v.includes(',') || v.includes('"') || v.includes('\n'))
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readExistingKeys(csvPath: string): Set<string> {
  const keys = new Set<string>();
  if (!fs.existsSync(csvPath)) return keys;
  const text = fs.readFileSync(csvPath, 'utf-8').trim();
  if (!text) return keys;
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const urlIdx = headers.indexOf('event_url');
  const sekIdx = headers.indexOf('session_event_key');
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const vals = parseCsvLine(line);
    if (urlIdx >= 0 && vals[urlIdx]) keys.add(vals[urlIdx]);
    if (sekIdx >= 0 && vals[sekIdx]) keys.add(vals[sekIdx]);
  }
  return keys;
}

function readAllEvents(csvPath: string): EventRecord[] {
  if (!fs.existsSync(csvPath)) return [];
  const text = fs.readFileSync(csvPath, 'utf-8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map(line => {
    const vals = parseCsvLine(line);
    const rec = {} as EventRecord;
    EVENT_HEADERS.forEach(h => { rec[h] = ''; });
    headers.forEach((h, i) => {
      if (EVENT_HEADERS.includes(h as EventHeader)) (rec as any)[h] = vals[i] ?? '';
    });
    return rec;
  });
}

function writeAllEvents(csvPath: string, records: EventRecord[]) {
  const header = EVENT_HEADERS.map(escapeCsv).join(',');
  const rows   = records.map(r => EVENT_HEADERS.map(h => escapeCsv(r[h] ?? '')).join(','));
  fs.writeFileSync(csvPath, [header, ...rows].join('\n') + '\n', 'utf-8');
}

/** Match an event row back to an issue type name using nserror_code then crash_kind. */
function matchIssueType(ev: EventRecord, issueTypes: string[]): string {
  if (ev.nserror_code) {
    const byCode = issueTypes.find(it => it.includes(`(${ev.nserror_code})`));
    if (byCode) return byCode;
  }
  return issueTypes.find(it => deriveCrashKind(it) === ev.crash_kind) ?? '';
}

/** Remove events matching a FaceKom session ID from the CSV and dedup set. */
function forceRecollect(fkSession: string, existingKeys: Set<string>): number {
  const all     = readAllEvents(EVENTS_CSV);
  const toForce = all.filter(ev => ev.identification_link?.includes(fkSession));
  if (!toForce.length) {
    console.log(`🔄 Force-recollect: no events found with FK session ${fkSession}`);
    return 0;
  }
  console.log(`🔄 Force-recollect: clearing ${toForce.length} event(s) with FK session ${fkSession}`);
  for (const ev of toForce) {
    existingKeys.delete(ev.event_url);
    existingKeys.delete(ev.session_event_key);
  }
  const remaining = all.filter(ev => !ev.identification_link?.includes(fkSession));
  writeAllEvents(EVENTS_CSV, remaining);
  // Adjust processed_events
  const byIssue: Record<string, number> = {};
  for (const ev of toForce) {
    const issue = matchIssueType(ev, ISSUE_TYPES_LIST);
    if (issue) byIssue[issue] = (byIssue[issue] || 0) + 1;
  }
  for (const [issue, count] of Object.entries(byIssue)) {
    updateProcessedEvents(ISSUES_CSV, issue, -count);
  }
  return toForce.length;
}

function appendEventCsv(csvPath: string, record: EventRecord) {
  ensureDirExists(csvPath);
  const exists    = fs.existsSync(csvPath);
  const nonEmpty  = exists && fs.readFileSync(csvPath, 'utf-8').trim().length > 0;
  const row       = EVENT_HEADERS.map(h => escapeCsv(record[h] ?? '')).join(',');
  if (!nonEmpty) {
    const header = EVENT_HEADERS.map(escapeCsv).join(',');
    fs.writeFileSync(csvPath, header + '\n' + row + '\n', 'utf-8');
  } else {
    fs.appendFileSync(csvPath, row + '\n', 'utf-8');
  }
}

function updateProcessedEvents(issuesCsvPath: string, issueName: string, delta: number) {
  if (!fs.existsSync(issuesCsvPath)) return;
  const text    = fs.readFileSync(issuesCsvPath, 'utf-8').trim();
  const lines   = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  const nameIdx = headers.indexOf('issue_name');
  const procIdx = headers.indexOf('processed_events');
  if (nameIdx < 0 || procIdx < 0) return;
  const updated = lines.map((line, i) => {
    if (i === 0) return line;
    const vals = parseCsvLine(line);
    if (vals[nameIdx] === issueName) {
      vals[procIdx] = String(parseInt(vals[procIdx] || '0') + delta);
      return vals.map(escapeCsv).join(',');
    }
    return line;
  });
  fs.writeFileSync(issuesCsvPath, updated.join('\n') + '\n', 'utf-8');
  console.log(`📋 Updated processed_events for "${issueName}" (+${delta})`);
}

// ── Derive crash_kind from issue name ─────────────────────────────────────────

function deriveCrashKind(issueName: string): string {
  // "FaceKomSDK.FaceKomError (46)" → "FaceKomError"
  // "FaceKom handleFlow (0)"       → "handleFlow"
  // "hu…SelfServiceRuntimeError (30803)" → "SelfServiceRuntimeError"
  const withoutCode = issueName.replace(/\s*\([-\d]+\).*$/, '').trim();
  const parts = withoutCode.split(/[\s.]+/);
  return parts[parts.length - 1] ?? withoutCode;
}

// ── Page helpers ──────────────────────────────────────────────────────────────

async function waitForStable(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {});
}

async function readKeyValue(page: Page, keyName: string): Promise<string> {
  try {
    const row = page.locator('tr').filter({
      has: page.locator('td').filter({ hasText: new RegExp(`^\\s*${keyName}\\s*$`) }),
    });
    return (await row.locator('td').nth(1).innerText({ timeout: 5_000 })).trim();
  } catch {
    return '';
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
          const span   = item.querySelector('.data-value');
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

/** Robust identification-link reader: scans the full page + shadow DOM for the videoid URL. */
async function readIdentificationLink(page: Page): Promise<string> {
  // Try the standard data-line-item mechanism first
  const idRow = await readDataLineItem(page, 'ID');
  if (idRow.href && idRow.href.includes('/identification/')) return idRow.href;
  if (idRow.text && idRow.text.includes('/identification/')) return idRow.text;

  // Fallback: scan every link and all text nodes for the identification URL pattern
  return await page.evaluate(() => {
    const pat = /https?:\/\/[a-z0-9.-]+\/identification\/[a-zA-Z0-9_\-%]+/;
    function search(root: Document | ShadowRoot): string {
      for (const a of Array.from(root.querySelectorAll('a'))) {
        const href = (a as HTMLAnchorElement).href || '';
        if (pat.test(href)) return href;
        const txt = a.textContent?.trim() || '';
        if (pat.test(txt)) return txt;
      }
      // Scan text content of all span/div/td elements
      for (const el of Array.from(root.querySelectorAll('span,div,td,p'))) {
        const txt = (el as HTMLElement).innerText?.trim() || '';
        const m = txt.match(pat);
        if (m) return m[0];
      }
      // Recurse into shadow DOM
      for (const el of Array.from(root.querySelectorAll('*'))) {
        const sr = (el as Element).shadowRoot;
        if (sr) {
          const found = search(sr);
          if (found) return found;
        }
      }
      return '';
    }
    return search(document);
  });
}

async function downloadLog(page: Page, logFilePath: string): Promise<'downloaded' | 'not_available'> {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });

  // Wait for tab content to fully render
  await page.waitForTimeout(2000);
  await waitForStable(page);

  // Click via JS — Angular/Material buttons sometimes aren't "visible" to Playwright
  // even though they're in the DOM. The text content is "get_app Download logs"
  // (Material icon prefix + label).
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => /download logs/i.test(b.textContent ?? ''));
      if (btn) { (btn as HTMLButtonElement).click(); return true; }
      return false;
    }),
  ]).catch(() => [null]);

  if (download) {
    await (download as any).saveAs(logFilePath);
    return 'downloaded';
  }

  return 'not_available';
}

// ── URL parsing ───────────────────────────────────────────────────────────────

function parsePageUrl(pageUrl: string): {
  issueId: string; sessionEventKey: string; sessionIdBase: string; eventId: string;
} {
  try {
    const u   = new URL(pageUrl);
    const sek = u.searchParams.get('sessionEventKey') ?? '';
    const sep = sek.lastIndexOf('_');
    const sessionIdBase = sep > 0 ? sek.slice(0, sep) : sek;
    const eventId       = sep > 0 ? sek.slice(sep + 1) : '';
    const m = u.pathname.match(/\/issues\/([a-f0-9]{8,})/i);
    return { issueId: m ? m[1] : '', sessionEventKey: sek, sessionIdBase, eventId };
  } catch {
    return { issueId: '', sessionEventKey: '', sessionIdBase: '', eventId: '' };
  }
}

function parseUserId(identLink: string): { userIdBase: string; userIdSuffix: string } {
  if (!identLink || identLink === 'not available') return { userIdBase: '', userIdSuffix: '' };
  const m = identLink.match(/\/identification\/([^/?#\s]+)/);
  if (!m) return { userIdBase: '', userIdSuffix: '' };
  const full     = m[1];
  const uuidPart = full.slice(0, 36);
  const suffix   = full.length > 36 ? full.slice(36) : '';
  return { userIdBase: uuidPart, userIdSuffix: suffix };
}

function buildEventUrl(issueId: string, sessionEventKey: string): string {
  const params = new URLSearchParams({
    time:            ISSUE_TIME_DEFAULT,
    versions:        BASE_QUERY.versions,
    types:           BASE_QUERY.types,
    sessionEventKey,
  });
  return `${FIREBASE_BASE}/${issueId}?${params.toString()}`;
}

// ── Core collection loop ──────────────────────────────────────────────────────

async function collectIssueType(
  page: Page,
  issueType: string,
  existingEventUrls: Set<string>,
): Promise<number> {
  const params  = new URLSearchParams({ ...BASE_QUERY, time: ISSUE_TIME_DEFAULT });
  const listUrl = `${FIREBASE_BASE}?${params.toString()}`;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🎯 Collecting: "${issueType}"`);
  console.log(`🌐 ${listUrl}`);

  await page.goto(listUrl);
  await waitForStable(page);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  const issueLink = page.locator('a.link-wrapper', {
    has: page.locator('mark.fire-highlight', { hasText: ISSUE_BASE }),
  }).filter({ hasText: issueType }).first();

  let usedDirectNav = false;
  try {
    await issueLink.waitFor({ timeout: 10_000 });
    await issueLink.click();
    await waitForStable(page);
  } catch {
    if (ISSUE_DIRECT_ID) {
      console.log(`⚠️  Not found on list — navigating directly (ISSUE_DIRECT_ID=${ISSUE_DIRECT_ID})`);
      const directParams = new URLSearchParams({ time: ISSUE_TIME_DEFAULT, versions: BASE_QUERY.versions, types: '' });
      await page.goto(`${FIREBASE_BASE}/${ISSUE_DIRECT_ID}?${directParams.toString()}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(5000);
      // Crashlytics issue overview doesn't auto-select an event — click the first session row.
      const sessionLink = page.locator('a[href*="sessionEventKey"]').first();
      const hasSessionLink = await sessionLink.isVisible({ timeout: 10_000 }).catch(() => false);
      if (hasSessionLink) {
        console.log(`🖱️  Clicking first session row from issue overview`);
        await sessionLink.click();
        await waitForStable(page);
      } else {
        console.log(`❓ No sessionEventKey link found — current URL: ${page.url().slice(-120)}`);
      }
      usedDirectNav = true;
    } else {
      console.log(`⚠️  Issue "${issueType}" not found on page. Skipping.`);
      return 0;
    }
  }

  // Wait for sessionEventKey to appear in the URL (Angular router updates it asynchronously).
  for (let ms = 0; ms < 10_000; ms += 300) {
    if (parsePageUrl(page.url()).sessionEventKey) break;
    await page.waitForTimeout(300);
  }
  console.log(`✅ Issue opened  url=${page.url().slice(-80)}`);

  const crashKind = deriveCrashKind(issueType);
  let issueId     = parsePageUrl(page.url()).issueId;
  let eventIndex  = 0;
  let collected   = 0;

  while (true) {
    eventIndex++;
    const { issueId: urlIssueId, sessionEventKey, sessionIdBase, eventId } = parsePageUrl(page.url());
    if (!issueId && urlIssueId) issueId = urlIssueId;

    const eventUrl = (issueId && sessionEventKey)
      ? buildEventUrl(issueId, sessionEventKey)
      : '';

    console.log(`\n📄 Event #${eventIndex}  sek=${sessionEventKey || '?'}`);

    const alreadySeen = (eventUrl && existingEventUrls.has(eventUrl))
      || (sessionEventKey && existingEventUrls.has(sessionEventKey));
    if (alreadySeen) {
      console.log(`⏭️  Already collected. Skipping.`);
    } else {

      // ── Data tab ────────────────────────────────────────────────────────
      await page.getByRole('tab', { name: 'Data', exact: true }).click();
      await waitForStable(page);

      const identification_link = (await readIdentificationLink(page)) || 'not available';
      const { app_version, os_version: rawOs, model, date } = await readEventSummary(page);
      const os_version         = cleanOsVersion(rawOs);
      const os_major_version   = extractOsMajorVersion(os_version);
      const orientationDevice  = (await readDataLineItem(page, 'Orientation (device)')).text;
      const orientationOs      = (await readDataLineItem(page, 'Orientation (OS)')).text;
      const jailbroken         = (await readDataLineItem(page, 'Jailbroken')).text;
      const ramFree            = (await readDataLineItem(page, 'RAM free')).text;
      const { userIdBase, userIdSuffix } = parseUserId(identification_link);
      console.log(`   ID:    ${identification_link}`);
      console.log(`   Model: ${model}  OS: ${os_version}  App: ${app_version}  Date: ${date}`);

      // ── Keys tab ────────────────────────────────────────────────────────
      await page.getByRole('tab', { name: 'Keys', exact: true }).click();
      await page.waitForTimeout(800);
      await waitForStable(page);

      const nserror_code           = await readKeyValue(page, 'nserror-code');
      const nserror_domain         = await readKeyValue(page, 'nserror-domain');
      const source                 = await readKeyValue(page, 'SOURCE');
      const status                 = await readKeyValue(page, 'STATUS');
      const configuration          = await readKeyValue(page, 'CONFIGURATION');
      const nslocalized_description = await readKeyValue(page, 'NSLocalizedDescription');

      // ── Logs & Breadcrumbs tab ──────────────────────────────────────────
      await page.getByRole('tab', { name: 'Logs & Breadcrumbs', exact: true }).click();
      await waitForStable(page);

      const logFilename       = eventId ? `${eventId}.log` : `unknown_${Date.now()}.log`;
      const logFilePath       = path.join(LOGS_DIR, logFilename);
      const breadcrumbs_status = await downloadLog(page, logFilePath);
      console.log(`   Breadcrumbs: ${breadcrumbs_status}`);

      // ── Write record ────────────────────────────────────────────────────
      const record: EventRecord = {
        event_url:               eventUrl,
        issue_id:                issueId,
        session_event_key:       sessionEventKey,
        session_id_full:         '',
        session_id_base:         sessionIdBase,
        report_index:            '',
        event_id:                eventId,
        user_id_base:            userIdBase,
        user_id_suffix:          userIdSuffix,
        identification_link,
        app_version,
        os_version,
        os_major_version,
        model,
        date,
        crash_kind:              crashKind,
        nserror_code,
        nserror_domain,
        source,
        status,
        configuration,
        breadcrumbs_status,
        nslocalized_description,
        orientation_device:      orientationDevice,
        ram_free_mib:            ramFree,
        jailbroken,
        orientation_os:          orientationOs,
        outcome:                 '',
        reason:                  '',
        last_step:               '',
        steps_reached:           '',
        screen_views:            '',
        n_status_changes:        '',
        first_breadcrumb_ts:     '',
        last_breadcrumb_ts:      '',
        session_elapsed_s:       '',
      };

      // Nothing was actually on the page: no identity (the URL never resolved a sessionEventKey)
      // AND no payload (the Data tab handed back Crashlytics' own "- - -" placeholders). Happens
      // when an issue has no event inside the current time window. Such a row carries no
      // information, and having no identity it can never match the alreadySeen dedup above — so
      // writing it would add one more junk row on EVERY re-run. Note the two conditions must BOTH
      // hold: an event with real fields but an unparseable URL is a genuine event, and is kept
      // (its breadcrumbs land in unknown_<ts>.log).
      const noIdentity = !eventUrl && !sessionEventKey && !eventId;
      const noPayload  = !app_version || app_version === '- - -';
      if (noIdentity && noPayload) {
        console.log(`⏭️  Empty event page (no id, no data) — not writing a row.`);
        break;
      }

      appendEventCsv(EVENTS_CSV, record);
      if (eventUrl) existingEventUrls.add(eventUrl);
      if (sessionEventKey) existingEventUrls.add(sessionEventKey);
      collected++;
      console.log(`✅ Saved event #${eventIndex} → total collected: ${collected}`);
      console.log(`[GFK:PROGRESS]`);

      if (COLLECT_LIMIT > 0 && collected >= COLLECT_LIMIT) {
        console.log(`🛑 Limit ${COLLECT_LIMIT} reached. Stopping.`);
        return collected;
      }
    }

    // ── Pagination ──────────────────────────────────────────────────────────
    const prevBtn       = page.locator('button[aria-label="Previous event"]');
    const MAX_WAIT_MS   = 10_000;
    const POLL_INTERVAL = 800;
    const startTime     = Date.now();
    let navigated       = false;

    while (Date.now() - startTime < MAX_WAIT_MS) {
      const isVisible = await prevBtn.isVisible().catch(() => false);
      if (!isVisible) { await page.waitForTimeout(POLL_INTERVAL); continue; }
      const isDisabled = await prevBtn.isDisabled().catch(() => true);
      if (!isDisabled) {
        await prevBtn.click();
        if (!alreadySeen) await waitForStable(page);
        await page.waitForTimeout(alreadySeen ? 200 : 600);
        navigated = true;
        break;
      }
      await page.waitForTimeout(POLL_INTERVAL);
    }

    if (!navigated) {
      console.log(`\n✋ "Previous" button stayed disabled — end of list after ${eventIndex} event(s).`);
      break;
    }
  }

  return collected;
}

// ── Main test ─────────────────────────────────────────────────────────────────

test('Collect 3.7.0 Crashlytics events', async ({ page }) => {
  test.setTimeout(10 * 60 * 60 * 1000);

  ensureDirExists(EVENTS_CSV);
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const existingEventUrls = readExistingKeys(EVENTS_CSV);
  if (FORCE_RECOLLECT_FK) forceRecollect(FORCE_RECOLLECT_FK, existingEventUrls);
  console.log(`📋 Existing events in CSV: ${existingEventUrls.size}`);
  console.log(`📋 Issue types to collect: ${ISSUE_TYPES_LIST.join(', ')}`);

  await page.goto('https://console.firebase.google.com');
  await waitForStable(page);

  // If the session expired Google shows an account chooser — click through it.
  const isChooser = await page.locator('text=Choose an account').isVisible().catch(() => false);
  if (isChooser) {
    const email = process.env.GOOGLE_EMAIL;
    const accountBtn = email
      ? page.locator(`[data-email="${email}"], li:has-text("${email}")`).first()
      : page.locator('[data-authuser], li[tabindex]').first();
    await accountBtn.click().catch(() => page.getByRole('listitem').filter({ hasText: '@' }).first().click());
    await waitForStable(page);
    await page.waitForTimeout(3000);
  }

  const isLoginPage = await page
    .locator('input[type="email"], [data-identifier="email"]')
    .isVisible()
    .catch(() => false);
  if (isLoginPage) throw new Error('BLOCKER: Login required. Run: npm run setup');

  let totalCollected = 0;
  for (const issueType of ISSUE_TYPES_LIST) {
    const count = await collectIssueType(page, issueType, existingEventUrls);
    totalCollected += count;
    if (count > 0) updateProcessedEvents(ISSUES_CSV, issueType, count);
    console.log(`\n📊 "${issueType}": ${count} new events collected.`);
  }

  console.log(`\n🎉 Done. Total new events: ${totalCollected}`);
});
