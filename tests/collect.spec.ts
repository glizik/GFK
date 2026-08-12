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
/** 'scrape' = walk the console UI (default, the fallback); 'api' = call the console's own JSON API. */
const COLLECT_MODE            = (process.env.COLLECT_MODE ?? 'scrape').toLowerCase();
/** How many times to re-open an issue that comes up with no event selected before giving up. */
const MAX_EMPTY_TRIES         = parseInt(process.env.MAX_EMPTY_TRIES ?? '3');
/** Append-only record of issues we could not collect — so a silent gap stays visible. */
const COLLECT_GAPS            = path.resolve(process.env.COLLECT_GAPS ?? './data/collect-gaps.jsonl');
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

/**
 * An issue we opened but could not collect a single event from. Appended as JSONL so a gap never
 * disappears silently: `versions` + `window` say what we asked Crashlytics for, `url` is the page
 * as the console actually resolved it (its effective time range often differs from ours).
 */
function recordCollectGap(issueType: string, url: string, tries: number) {
  const entry = {
    ts:       new Date().toISOString(),
    versions: BASE_QUERY.versions,
    issue:    issueType,
    window:   ISSUE_TIME_DEFAULT,
    tries,
    url,
  };
  try {
    ensureDirExists(path.dirname(COLLECT_GAPS));
    fs.appendFileSync(COLLECT_GAPS, JSON.stringify(entry) + '\n');
    console.log(`📝 Gap recorded → ${COLLECT_GAPS}`);
  } catch (e) {
    console.log(`⚠️  Could not write gap log: ${(e as Error).message}`);
  }
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
  const waitForEventKey = async () => {
    for (let ms = 0; ms < 10_000; ms += 300) {
      if (parsePageUrl(page.url()).sessionEventKey) return true;
      await page.waitForTimeout(300);
    }
    return false;
  };
  await waitForEventKey();
  console.log(`✅ Issue opened  url=${page.url().slice(-80)}`);

  // Re-open the issue from the list — used to retry an "empty" issue page. The console sometimes
  // serves an issue with no event selected even though events exist in the window (and the time
  // filter it actually applies is not always the one we asked for), so one attempt is not proof.
  const reopenFromList = async (): Promise<boolean> => {
    await page.goto(listUrl);
    await waitForStable(page);
    await page.waitForTimeout(2000);
    const link = page.locator('a.link-wrapper', {
      has: page.locator('mark.fire-highlight', { hasText: ISSUE_BASE }),
    }).filter({ hasText: issueType }).first();
    try {
      await link.waitFor({ timeout: 10_000 });
      await link.click();
      await waitForStable(page);
    } catch {
      return false;
    }
    return waitForEventKey();
  };

  const crashKind = deriveCrashKind(issueType);
  let issueId     = parsePageUrl(page.url()).issueId;
  let eventIndex  = 0;
  let collected   = 0;
  let emptyTries  = 0;

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
        // Retry before believing it: an empty page is usually the console not selecting an event,
        // not an issue that really has none. Only after MAX_EMPTY_TRIES do we record a gap — that
        // is the case worth looking at by hand (Crashlytics withholding the newest events).
        emptyTries++;
        if (emptyTries < MAX_EMPTY_TRIES) {
          console.log(`🔁 Empty event page — retry ${emptyTries}/${MAX_EMPTY_TRIES - 1}…`);
          const ok = await reopenFromList();
          console.log(ok ? `   ↳ event selected, continuing` : `   ↳ still empty`);
          eventIndex--;   // this pass collected nothing; don't count it as an event
          continue;
        }
        console.log(`⏭️  Empty event page after ${emptyTries} tries — not writing a row.`);
        recordCollectGap(issueType, page.url(), emptyTries);
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

// ── API collection path (COLLECT_MODE=api) ───────────────────────────────────
// The console itself drives Crashlytics through a plain JSON API, and calling that directly fixes
// the one thing the UI gets wrong: the time window. On a single `time=3d` page load the issue list
// asks for [day-2 … day-0] while the event list asks for [day-3 … day-1] — a whole day apart — so
// the newest events are simply never offered and the issue page renders empty. Here WE pass the
// interval. It also collapses four tab clicks + a file download per event into one GET.
// The endpoints are internal and undocumented, hence the switch: the scraper stays the default.

type ApiCtx = { base: string; key: string; headers: Record<string, string> };
type EventKey = { sessionId: string; eventId: string };

/** ISSUE_TIME_DEFAULT ("90d", "3d" or "<startMs>:<endMs>") → the interval the API expects. */
function apiInterval(): { startTime: string; endTime: string } {
  const now = Date.now();
  const days = /^(\d+)d$/.exec(ISSUE_TIME_DEFAULT);
  if (days) return { startTime: new Date(now - +days[1] * 86_400_000).toISOString(), endTime: new Date(now).toISOString() };
  const range = /^(\d+):(\d+)$/.exec(ISSUE_TIME_DEFAULT);
  if (range) return { startTime: new Date(+range[1]).toISOString(), endTime: new Date(+range[2]).toISOString() };
  return { startTime: new Date(now - 90 * 86_400_000).toISOString(), endTime: new Date(now).toISOString() };
}

/** "3.8.2 (2823)" → the API's version filter shape. */
function apiVersionFilters(): Array<{ buildVersions: string[]; displayVersion: string }> {
  const m = /^(.+?)\s*\((.+?)\)\s*$/.exec(BASE_QUERY.versions.trim());
  return m ? [{ buildVersions: [m[2].trim()], displayVersion: m[1].trim() }] : [];
}

/**
 * Load the console once and capture a real API call: the `authorization` header is a time-bound
 * SAPISIDHASH computed by the console's own JS, so it cannot be forged — only borrowed.
 */
async function captureApiCtx(page: Page): Promise<ApiCtx> {
  let hit: { url: string; headers: Record<string, string> } | null = null;
  const onReq = (req: { url(): string; headers(): Record<string, string> }) => {
    if (hit) return;
    if (/crashlytics-pa\.clients6\.google\.com\/v1\/projects\/\d+\/clients\//.test(req.url()))
      hit = { url: req.url(), headers: req.headers() };
  };
  page.on('request', onReq);
  const params = new URLSearchParams({ ...BASE_QUERY, time: ISSUE_TIME_DEFAULT });
  await page.goto(`${FIREBASE_BASE}?${params.toString()}`);
  for (let ms = 0; ms < 60_000 && !hit; ms += 500) await page.waitForTimeout(500);
  page.off('request', onReq);
  if (!hit) throw new Error('BLOCKER: no Crashlytics API call observed — the session is probably expired. Run: npm run setup');
  const url = new URL(hit!.url);
  const m = /^(\/v1\/projects\/\d+\/clients\/[^/]+)/.exec(url.pathname);
  if (!m) throw new Error(`Unexpected API path: ${url.pathname}`);
  const ctx = { base: `${url.origin}${m[1]}`, key: url.searchParams.get('key') ?? '', headers: hit!.headers };
  console.log(`🔌 API ready: ${ctx.base}`);
  return ctx;
}

/**
 * Issue the request from INSIDE the console page: the call is authenticated by the session cookie
 * plus the borrowed header, and from Node (context.request) the same call returns 401.
 */
async function apiCall<T>(page: Page, ctx: ApiCtx, endpoint: string, body?: unknown): Promise<T> {
  // The borrowed SAPISIDHASH is time-bound. On a 401 we re-load the console once to mint a fresh
  // one and retry — a long run must not die halfway through just because the token aged out.
  for (let attempt = 0; ; attempt++) {
    const url = `${ctx.base}${endpoint}${endpoint.includes('?') ? '&' : '?'}alt=json&key=${ctx.key}`;
    const res = await page.evaluate(async (a: { url: string; headers: Record<string, string>; body?: unknown }) => {
      const h: Record<string, string> = { 'content-type': 'application/json' };
      for (const k of ['authorization', 'x-goog-authuser']) if (a.headers[k]) h[k] = a.headers[k];
      const r = await fetch(a.url, {
        method: a.body === undefined ? 'GET' : 'POST',
        headers: h,
        body: a.body === undefined ? undefined : JSON.stringify(a.body),
        credentials: 'include',
      });
      return { status: r.status, text: await r.text() };
    }, { url, headers: ctx.headers, body });
    if (res.status === 200) return JSON.parse(res.text) as T;
    if (res.status === 401 && attempt === 0) {
      console.log(`🔑 API credentials aged out — re-capturing…`);
      const fresh = await captureApiCtx(page);
      ctx.base = fresh.base; ctx.key = fresh.key; ctx.headers = fresh.headers;
      continue;
    }
    throw new Error(`API ${endpoint} → ${res.status}: ${res.text.slice(0, 300)}`);
  }
}

/** The issue list, matched by "<signalName> (<signalCode>)" — the same name the CSVs use. */
async function findIssueApi(page: Page, ctx: ApiCtx, issueType: string): Promise<{ id: string; eventsCount: number }> {
  const res = await apiCall<{ topIssues?: any[] }>(page, ctx, '/metrics:listFirebaseTopOpenIssues', {
    filters: {
      categories: [], customKeys: [], eventType: ['NON_FATAL'], manufacturerModels: [],
      osVersions: [], rollouts: [], tagFilter: { tagTypes: ['TAG_UNSPECIFIED'] },
      versionFilters: apiVersionFilters(),
    },
    interval: apiInterval(),
    orderBy: 'ORDER_EVENTS',
    pageDetails: { pageSize: '100', pageToken: '' },
    searchTerm: { term: BASE_QUERY.issuesQuery },
  });
  const found = (res.topIssues ?? []).find(i =>
    `${i?.caption?.signalName} (${i?.caption?.signalCode})` === issueType);
  return { id: found?.id ?? '', eventsCount: +(found?.eventsCount ?? 0) };
}

async function listEventKeysApi(page: Page, ctx: ApiCtx, issueId: string): Promise<EventKey[]> {
  const res = await apiCall<{ sessionEventKeys?: EventKey[] }>(
    page, ctx, `/issues/${issueId}/metrics:listSessionEventIds`, {
      direction: 'BOTH',
      filters: {
        categories: [], customKeys: [], excludedSubIssues: [], includedSubIssues: [],
        manufacturerModels: [], osVersions: [], rollouts: [], versionFilters: apiVersionFilters(),
      },
      interval: apiInterval(),
      maxNumResults: 1000,
    });
  return res.sessionEventKeys ?? [];
}

/** "Aug 2, 2026, 10:21:17 AM" — the exact shape the scraped rows carry. */
function fmtEventDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

/** Same file the Logs & Breadcrumbs download produced, so build-data.js needs no change. */
function writeApiLogFile(ev: any, issueId: string): string {
  const d = ev?.eventDataExternal ?? {};
  const items = (d.logs ?? []).map((l: any) => l.analyticsObject
    ? { timestamp: new Date(l.time).toString(), name: l.analyticsObject.name ?? '', source: 'analytics', params: l.analyticsObject.params ?? {} }
    : { timestamp: new Date(l.time).toString(), message: l.logLine ?? '', source: 'crashlytics' });
  fs.writeFileSync(path.join(LOGS_DIR, `${ev.eventId}.log`), JSON.stringify({
    title:             'Crashlytics - Custom logs',
    bundle_identifier: (process.env.FIREBASE_APP ?? '').replace(/^ios:/, ''),
    platform:          'apple',
    display_version:   d.application?.displayVersion ?? '',
    build_version:     d.application?.buildVersion ?? '',
    issue_id:          issueId,
    session_id:        ev.sessionId ?? '',
    event_timestamp:   d.eventTime ? new Date(d.eventTime).toString() : '',
    logs_and_breadcrumbs: items,
  }, null, 2));
  return items.length ? 'downloaded' : 'not_available';
}

function recordFromApiEvent(ev: any, issueId: string, sessionIdBase: string, issueType: string, breadcrumbs: string): EventRecord {
  const d    = ev?.eventDataExternal ?? {};
  const keys = d.customKeys ?? {};
  const identification_link = d.user?.id || 'not available';
  const { userIdBase, userIdSuffix } = parseUserId(identification_link);
  const osName     = d.operatingSystem?.name === 'IOS' ? 'iOS' : (d.operatingSystem?.name ?? '');
  const os_version = d.operatingSystem?.displayVersion ? `${osName} ${d.operatingSystem.displayVersion}`.trim() : '';
  const sek        = `${sessionIdBase}_${ev.eventId}`;
  return {
    event_url:               buildEventUrl(issueId, sek),
    issue_id:                issueId,
    session_event_key:       sek,
    session_id_full:         ev.sessionId ?? '',
    session_id_base:         sessionIdBase,
    report_index:            ev.eventIndex != null ? String(ev.eventIndex) : '',
    event_id:                ev.eventId ?? '',
    user_id_base:            userIdBase,
    user_id_suffix:          userIdSuffix,
    identification_link,
    app_version:             d.application ? `${d.application.displayVersion} (${d.application.buildVersion})` : '',
    os_version,
    os_major_version:        extractOsMajorVersion(os_version),
    model:                   d.device?.marketingName ?? d.device?.model ?? '',
    date:                    d.eventTime ? fmtEventDate(d.eventTime) : '',
    crash_kind:              deriveCrashKind(issueType),
    nserror_code:            keys['nserror-code'] ?? '',
    nserror_domain:          keys['nserror-domain'] ?? '',
    source:                  keys['SOURCE'] ?? '',
    status:                  keys['STATUS'] ?? '',
    configuration:           keys['CONFIGURATION'] ?? '',
    breadcrumbs_status:      breadcrumbs,
    nslocalized_description: keys['NSLocalizedDescription'] ?? '',
    orientation_device:      d.orientation?.device ?? '',
    ram_free_mib:            '',
    jailbroken:              '',
    orientation_os:          d.orientation?.ui ?? '',
    outcome: '', reason: '', last_step: '', steps_reached: '', screen_views: '',
    n_status_changes: '', first_breadcrumb_ts: '', last_breadcrumb_ts: '', session_elapsed_s: '',
  };
}

async function collectIssueTypeViaApi(page: Page, ctx: ApiCtx, issueType: string, existingKeys: Set<string>): Promise<number> {
  console.log(`\n${'═'.repeat(60)}\n🎯 Collecting via API: "${issueType}"`);
  const { id: issueId, eventsCount } = await findIssueApi(page, ctx, issueType);
  if (!issueId) { console.log(`⚠️  Not found in the issue list for this interval. Skipping.`); return 0; }

  const keys = await listEventKeysApi(page, ctx, issueId);
  console.log(`🔑 ${keys.length} event key(s) in the interval (issue list reports ${eventsCount})`);
  // The issue list and the event list are two different queries; if the second returns fewer than
  // the first promises, something was withheld or truncated — exactly the case worth recording.
  if (keys.length < eventsCount) recordCollectGap(issueType, `api:${issueId} keys=${keys.length} expected=${eventsCount}`, 1);

  let collected = 0;
  for (const k of keys) {
    const sek = `${k.sessionId}_${k.eventId}`;
    if (existingKeys.has(sek) || existingKeys.has(buildEventUrl(issueId, sek))) continue;
    let ev: any;
    try {
      ev = await apiCall<any>(page, ctx, `/processedevents/${sek}`);
    } catch (e) {
      console.log(`⚠️  ${sek}: ${(e as Error).message.slice(0, 160)}`);
      continue;
    }
    const breadcrumbs = writeApiLogFile(ev, issueId);
    appendEventCsv(EVENTS_CSV, recordFromApiEvent(ev, issueId, k.sessionId, issueType, breadcrumbs));
    existingKeys.add(sek);
    collected++;
    console.log(`✅ ${sek}  (${breadcrumbs})`);
    console.log(`[GFK:PROGRESS]`);
    if (COLLECT_LIMIT > 0 && collected >= COLLECT_LIMIT) { console.log(`🛑 Limit ${COLLECT_LIMIT} reached.`); break; }
  }
  return collected;
}

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

  const apiCtx = COLLECT_MODE === 'api' ? await captureApiCtx(page) : null;
  console.log(`⚙️  Collect mode: ${COLLECT_MODE}`);

  let totalCollected = 0;
  for (const issueType of ISSUE_TYPES_LIST) {
    const count = apiCtx
      ? await collectIssueTypeViaApi(page, apiCtx, issueType, existingEventUrls)
      : await collectIssueType(page, issueType, existingEventUrls);
    totalCollected += count;
    if (count > 0) updateProcessedEvents(ISSUES_CSV, issueType, count);
    console.log(`\n📊 "${issueType}": ${count} new events collected.`);
  }

  console.log(`\n🎉 Done. Total new events: ${totalCollected}`);
});
