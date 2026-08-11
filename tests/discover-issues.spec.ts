/**
 * GFK – Crashlytics issue DISCOVERY (Stage 1, step 0)
 *
 * Walks the Crashlytics issue list (one version, one types= filter) and
 * produces a worklist CSV — issues_<version>.csv — that the per-event
 * collector (events_<version>.csv) iterates over.
 *
 * Output schema (matches data/issues_3.7.0.csv):
 *
 *   rank, issue_name, nserror_domain, nserror_code,
 *   issue_id, events_total, users_total,
 *   processed_events, analysed_events, last_scraped
 *
 * On re-run, existing rows are matched by issue_name (and by issue_id
 * when available) and processed_events / analysed_events / last_scraped
 * are PRESERVED. Only events_total, users_total and rank are refreshed.
 *
 * The DOM specifics encoded here are documented in tests/discover.txt
 * (the "discovery notes" file). Notable ones:
 *
 * - URL shape (§1): types=error means non-fatals, types=crash means
 *   real crashes. We derive `kind` from BASE_QUERY.types, NOT from
 *   row text — Crashlytics doesn't always print the word in the row.
 * - Angular Router links (§3a/§3b): the issue title sits inside
 *   `a.fire-router-link-host.link-wrapper`, and the title text is
 *   inside a `span.copy-target`. The visible href is often "#" — the
 *   actual route is in `getAttribute('href')`. Reading `a.href` (the
 *   resolved property) is unreliable on these elements.
 * - Lazy rendering (§7): the list virtualises; a small scroll nudge
 *   before counting helps stable rendering.
 *
 * Run:
 *   npm run discover            (visible browser)
 *   npm run discover:headless   (headless)
 */

import { test, Page } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// ── Config (mirrors collect.spec.ts) ─────────────────────────────────────────

const FIREBASE_BASE =
  `https://console.firebase.google.com/project/${process.env.FIREBASE_PROJECT}` +
  `/crashlytics/app/${process.env.FIREBASE_APP}/issues`;

const ISSUE_BASE          = process.env.ISSUE_BASE          ?? 'FaceKom';
const ISSUE_TIME_DEFAULT  = process.env.ISSUE_TIME_DEFAULT  ?? '90d';

const BASE_QUERY = {
  state:        process.env.ISSUE_STATE        ?? 'open',
  tag:          process.env.ISSUE_TAG          ?? 'all',
  sort:         process.env.ISSUE_SORT         ?? 'eventCount',
  versions:     process.env.ISSUE_VERSIONS     ?? '',
  types:        process.env.ISSUE_QUERY_TYPES  ?? 'error',
  issuesQuery:  process.env.ISSUE_QUERY        ?? 'FaceKom',
};

/** Derive the bundle ID from FIREBASE_APP=`ios:hu.microsec.eszigno.mobile`. */
const BUNDLE_ID = (process.env.FIREBASE_APP ?? '').replace(/^[a-z]+:/i, '');

/** "3.7.0 (2753)" → "3.7.0" for filenames. */
function versionSlug(raw: string): string {
  const m = raw.match(/^([\d.]+)/);
  return m ? m[1] : 'unknown';
}
const VERSION_SLUG = versionSlug(BASE_QUERY.versions);

/** Issue worklist CSV — overridable via ISSUES_CSV env. */
const ISSUES_CSV = path.resolve(
  process.env.ISSUES_CSV ?? `./data/issues_${VERSION_SLUG}.csv`,
);

/** Optional rich JSON dump for debugging (off by default). */
const ISSUES_JSON_DEBUG = process.env.ISSUES_JSON_DEBUG === 'true'
  ? path.resolve(process.env.ISSUES_JSON_DEBUG_PATH ?? `./data/issues_${VERSION_SLUG}.debug.json`)
  : '';

// ── CSV schema ───────────────────────────────────────────────────────────────

const HEADERS = [
  'rank',
  'issue_name',
  'nserror_domain',
  'nserror_code',
  'issue_id',
  'variants_total', // Firebase column 1: number of distinct crash signatures grouped under this issue
  'events_total',   // Firebase column 2: total number of crash/error events
  'users_total',    // Firebase column 3: distinct affected users
  'processed_events',
  'analysed_events',
  'last_scraped',
] as const;
type Header = typeof HEADERS[number];
type IssueRow = Record<Header, string>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildIssuesListUrl(timeParam: string): string {
  const params = new URLSearchParams({ ...BASE_QUERY, time: timeParam });
  return `${FIREBASE_BASE}?${params.toString()}`;
}

async function waitForStable(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
}

/** Extract `issue_id` from a Crashlytics issue URL like .../issues/<hex>?... */
function extractIssueId(href: string): string {
  if (!href) return '';
  const m = href.match(/\/issues\/([a-f0-9]{8,})/i);
  return m ? m[1] : '';
}

/** Convert a Firebase event-count label ("1K", "2.3K", "583") to a number. */
function parseCount(label: string): { value: number; rounded: boolean; raw: string } {
  const raw = (label ?? '').trim();
  if (!raw) return { value: NaN, rounded: false, raw };
  const k = raw.match(/^([\d.]+)\s*K$/i);
  if (k)  return { value: Math.round(parseFloat(k[1]) * 1_000),     rounded: true,  raw };
  const mm = raw.match(/^([\d.]+)\s*M$/i);
  if (mm) return { value: Math.round(parseFloat(mm[1]) * 1_000_000), rounded: true,  raw };
  const n = raw.replace(/,/g, '').match(/^\d+$/);
  if (n)  return { value: parseInt(n[0], 10),                        rounded: false, raw };
  return { value: NaN, rounded: false, raw };
}

/**
 * Parse Crashlytics issue title → { nserror_domain, nserror_code }.
 *
 * Observed titles (see data/issues_3.7.0.csv):
 *   "SelfServiceRuntimeError (30803) — Facekom finished"
 *      → domain "hu.microsec.eszigno.mobile.SelfServiceRuntimeError", code 30803
 *   "FaceKom handleFlow (0)"
 *      → domain "FaceKom handleFlow", code 0
 *   "UndefinedUIError.openMessage (30302)"
 *      → domain "hu.microsec.eszigno.mobile.UndefinedUIError.openMessage", code 30302
 *
 * Heuristic: take everything before the parenthesised numeric code.
 * If the captured token contains no whitespace AND we know the
 * bundle ID, prefix it with the bundle ID — that's how native
 * Swift error types are namespaced in Crashlytics. FaceKom-style
 * titles (with a space) are kept verbatim.
 *
 * This is a best-effort approximation. The collector overwrites
 * nserror_domain / nserror_code from the Keys tab on the first
 * scraped event for the issue.
 */
function parseIssueTitle(title: string): { nserror_domain: string; nserror_code: string } {
  const clean = title.trim().replace(/\s+/g, ' ');
  // Match "<domain> (<code>)" with optional " — <suffix>" trailing.
  const m = clean.match(/^(.+?)\s*\((-?\d+)\)/);
  if (!m) return { nserror_domain: clean, nserror_code: '' };
  const captured = m[1].trim();
  const code     = m[2].trim();
  const isNamespacedToken = /^\S+$/.test(captured); // no whitespace
  const domain = isNamespacedToken && BUNDLE_ID
    ? `${BUNDLE_ID}.${captured}`
    : captured;
  return { nserror_domain: domain, nserror_code: code };
}

// ── Minimal CSV read/write (avoid pulling papaparse) ────────────────────────

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

function readIssuesCsv(csvPath: string): IssueRow[] {
  if (!fs.existsSync(csvPath)) return [];
  const text = fs.readFileSync(csvPath, 'utf-8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]).map(h => h.trim()) as Header[];
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {} as IssueRow;
    HEADERS.forEach(h => { row[h] = ''; });
    headers.forEach((h, i) => {
      if ((HEADERS as readonly string[]).includes(h)) row[h] = values[i] ?? '';
    });
    return row;
  });
}

function writeIssuesCsv(csvPath: string, rows: IssueRow[]) {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const header = HEADERS.map(escapeCsv).join(',');
  const body = rows.map(r => HEADERS.map(h => escapeCsv(r[h] ?? '')).join(','));
  fs.writeFileSync(csvPath, header + '\n' + body.join('\n') + '\n', 'utf-8');
}

// ── The test ─────────────────────────────────────────────────────────────────

test('Discover Crashlytics issues for the configured version', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);

  const url = buildIssuesListUrl(ISSUE_TIME_DEFAULT);
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`🌐 Discovery URL:`);
  console.log(`   ${url}`);
  console.log(`📦 Bundle ID for namespacing: ${BUNDLE_ID || '(none)'}`);
  console.log(`🏷️  Filter kind:               ${BASE_QUERY.types}  (error = non-fatals, crash = crashes)`);
  console.log(`📄 Writing worklist CSV:      ${ISSUES_CSV}`);
  console.log(`${'═'.repeat(72)}\n`);

  // ── Login guard (matches collect.spec.ts) ───────────────────────────────
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
  if (isLoginPage) {
    throw new Error('BLOCKER: Login required. Run: npm run setup (or gfksetup).');
  }

  // ── Navigate to the issue list ──────────────────────────────────────────
  await page.goto(url);
  await waitForStable(page);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);

  // ── Page totals (e.g. "2 Crashes", "11 Non-fatals") ─────────────────────
  const pageText = await page.evaluate(() => document.body.innerText);
  const totals: Record<string, number> = {};
  const totalRe = /(\d[\d.,]*\s*[KM]?)\s+(Crash(?:es)?|Non[-\s]?fatals?|ANRs?)\b/gi;
  let tm: RegExpExecArray | null;
  while ((tm = totalRe.exec(pageText)) !== null) {
    const kind = tm[2].toLowerCase().replace(/[-\s]/g, '');
    const norm =
      kind.startsWith('crash')    ? 'crashes'    :
      kind.startsWith('nonfatal') ? 'non_fatals' :
      kind.startsWith('anr')      ? 'anrs'       : kind;
    const { value } = parseCount(tm[1]);
    if (!Number.isNaN(value)) totals[norm] = value;
  }
  console.log(`📊 Page totals (header):`, totals);

  // ── Issue rows containing ISSUE_BASE in the title ───────────────────────
  // Per discover.txt §3a: issue titles live inside a.fire-router-link-host,
  // and the actual text node is span.copy-target. We use the same outer
  // selector as collect.spec.ts (a.link-wrapper) so both stages agree.
  // `mark.fire-highlight` is the SEARCH highlight, so this match only works while issuesQuery is
  // set. With ISSUE_BASE="" (no text filter) take every row instead — that is the only way to see
  // crash issues, whose titles are the crashing frame (e.g. "…uploadLivenessV2Photo… EXC_BREAKPOINT")
  // and never contain the word "FaceKom".
  const issueAnchors = ISSUE_BASE
    ? page.locator('a.link-wrapper', { has: page.locator('mark.fire-highlight', { hasText: ISSUE_BASE }) })
    : page.locator('a.link-wrapper');

  // The dashboard's data can lag well behind domcontentloaded (the
  // crash-free/trends widgets keep spinning), so the issue list often
  // renders empty for several seconds after navigation. Poll until at
  // least one issue row appears before counting — otherwise a still-
  // loading table is scraped as 0 FaceKom issues (a race that silently
  // skips a whole version). List virtualises, so nudge while we wait.
  let anyRows = 0;
  for (let attempt = 0; attempt < 12; attempt++) {   // up to ~30s
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(500);
    anyRows = await page.locator('a.link-wrapper').count();
    if (anyRows > 0) break;
    await page.waitForTimeout(1500);
  }
  if (anyRows === 0) {
    console.log('⚠️  Issue list still empty after waiting — page may not have loaded.');
  }

  const found = await issueAnchors.count();
  console.log(`🔍 Issue rows containing "${ISSUE_BASE}": ${found}`);

  type DiscoveredIssue = {
    rank: number;
    title: string;
    href_attr: string;            // getAttribute('href') — may be "#" for Angular stubs
    href_property: string;        // a.href — resolved URL (sometimes useful)
    issue_id: string;
    variant_count: { value: number; rounded: boolean; raw: string } | null; // Firebase col 1
    event_count:   { value: number; rounded: boolean; raw: string } | null; // Firebase col 2
    user_count:    { value: number; rounded: boolean; raw: string } | null; // Firebase col 3
    row_text: string;
    kind: 'non-fatal' | 'crash' | 'unknown';
    nserror_domain: string;
    nserror_code: string;
  };

  // kind comes from the URL filter, NOT the row text (per §1).
  const filterKind: DiscoveredIssue['kind'] =
    BASE_QUERY.types === 'crash' ? 'crash' :
    BASE_QUERY.types === 'error' ? 'non-fatal' :
    'unknown';

  const discovered: DiscoveredIssue[] = [];

  for (let i = 0; i < found; i++) {
    const anchor = issueAnchors.nth(i);

    const data = await anchor.evaluate((el) => {
      const a = el as HTMLAnchorElement;

      // §3a: real title sits in span.copy-target inside the anchor.
      // Fall back to anchor.textContent if not present.
      const copySpan = a.querySelector('span.copy-target') as HTMLElement | null;
      const title =
        (copySpan?.textContent ?? a.textContent ?? '')
          .trim()
          .replace(/\s+/g, ' ');

      // §3b: getAttribute('href') is the route attribute as authored,
      // a.href is the resolved property. Capture both — extractIssueId
      // tries them in order.
      const href_attr     = a.getAttribute('href') ?? '';
      const href_property = a.href ?? '';

      // Walk up to the row container so we can read sibling cells.
      let row: HTMLElement | null = a;
      for (let depth = 0; depth < 8 && row; depth++) {
        const parent: HTMLElement | null = row.parentElement;
        if (!parent) break;
        row = parent;
        if (row.tagName === 'TR') break;
        if (row.tagName === 'LI') break;
        if (row.getAttribute('role') === 'row') break;
      }
      const rowText = row?.textContent?.trim().replace(/\s+/g, ' ') ?? '';

      // Collect numeric-looking cells inside the row (excluding the title).
      const candidateTexts: string[] = [];
      if (row) {
        const cells = Array.from(row.querySelectorAll(
          'td, [role="cell"], .cell, .mat-mdc-cell, .mat-cell, span'
        ));
        for (const c of cells) {
          const t = (c.textContent ?? '').trim();
          if (!t) continue;
          if (t.length > 30) continue;
          if (t === title) continue;
          if (/^\d[\d.,]*\s*[KM]?$/i.test(t)) candidateTexts.push(t);
        }
      }

      return { href_attr, href_property, title, rowText, candidateTexts };
    });

    // Firebase shows Variants/Events/Users (3 cols) for some issues and
    // Events/Users (2 cols) for others. Detect by how many numeric cells are present.
    const uniqCounts = [...new Set(data.candidateTexts)];
    let variantLabel = '', eventLabel = '', userLabel = '';
    if (uniqCounts.length >= 3) {
      variantLabel = uniqCounts[0];
      eventLabel   = uniqCounts[1];
      userLabel    = uniqCounts[2];
    } else {
      eventLabel = uniqCounts[0] ?? '';
      userLabel  = uniqCounts[1] ?? '';
    }

    // Prefer the attribute (route) for issue_id; fall back to the
    // resolved href property if needed.
    const issue_id =
      extractIssueId(data.href_attr) ||
      extractIssueId(data.href_property);

    const { nserror_domain, nserror_code } = parseIssueTitle(data.title);

    const issue: DiscoveredIssue = {
      rank: i + 1,
      title: data.title,
      href_attr: data.href_attr,
      href_property: data.href_property,
      issue_id,
      variant_count: variantLabel ? parseCount(variantLabel) : null,
      event_count:   eventLabel   ? parseCount(eventLabel)   : null,
      user_count:    userLabel    ? parseCount(userLabel)    : null,
      row_text: data.rowText,
      kind: filterKind,
      nserror_domain,
      nserror_code,
    };
    discovered.push(issue);

    const vr = issue.variant_count?.raw ?? '—';
    const ev = issue.event_count?.raw   ?? '—';
    const us = issue.user_count?.raw    ?? '—';
    console.log(
      `   [${String(issue.rank).padStart(2)}] ${issue.kind.padEnd(9)} ` +
      `var=${vr.padStart(6)} ev=${ev.padStart(6)} us=${us.padStart(6)}  ${issue.title}`,
    );
    if (!issue.issue_id) {
      console.log(`        ⚠️  could not extract issue_id (href_attr="${data.href_attr}")`);
    }
  }

  // ── Sanity check: collected events vs page totals ───────────────────────
  const summedEvents = discovered.reduce(
    (acc, it) => acc + (it.event_count?.value || 0),
    0,
  );
  console.log(`\nΣ events_total across discovered ${ISSUE_BASE} issues: ${summedEvents}`);
  if (typeof totals.non_fatals === 'number' && filterKind === 'non-fatal') {
    const delta = summedEvents - totals.non_fatals;
    console.log(`Page non_fatals total: ${totals.non_fatals}  (delta vs Σ ${ISSUE_BASE} events: ${delta})`);
  }
  if (typeof totals.crashes === 'number' && filterKind === 'crash') {
    const delta = summedEvents - totals.crashes;
    console.log(`Page crashes total: ${totals.crashes}  (delta vs Σ ${ISSUE_BASE} events: ${delta})`);
  }

  // ── Merge with existing CSV, preserving progress columns ────────────────
  const existing = readIssuesCsv(ISSUES_CSV);
  console.log(`📋 Existing worklist rows: ${existing.length}`);

  // Index existing rows by issue_name and by issue_id (when set).
  const byName = new Map<string, IssueRow>();
  const byId   = new Map<string, IssueRow>();
  for (const r of existing) {
    if (r.issue_name) byName.set(r.issue_name, r);
    if (r.issue_id)   byId.set(r.issue_id, r);
  }

  const nowIso = new Date().toISOString();
  const merged: IssueRow[] = discovered.map((d) => {
    const prior = (d.issue_id && byId.get(d.issue_id)) || byName.get(d.title) || null;
    return {
      rank:             String(d.rank),
      issue_name:       d.title,
      nserror_domain:   d.nserror_domain,
      nserror_code:     d.nserror_code,
      issue_id:         d.issue_id,
      variants_total:   d.variant_count ? String(d.variant_count.value) : '0',
      events_total:     d.event_count   ? String(d.event_count.value)   : '',
      users_total:      d.user_count    ? String(d.user_count.value)    : '',
      processed_events: prior?.processed_events ?? '0',
      analysed_events:  prior?.analysed_events  ?? '0',
      last_scraped:     prior?.last_scraped     ?? '',
    };
  });

  // Anything that was in the prior CSV but no longer shows up on the
  // page — keep it, with rank cleared, so we don't lose history.
  const seenNames = new Set(merged.map(r => r.issue_name));
  const carryOver: IssueRow[] = [];
  for (const r of existing) {
    if (!seenNames.has(r.issue_name) && r.issue_name) {
      carryOver.push({ ...r, rank: '' });
    }
  }
  if (carryOver.length) {
    console.log(`📎 Carrying over ${carryOver.length} previously-seen issue(s) not on the page right now.`);
  }

  // Stamp last_scraped on every refreshed row.
  for (const r of merged) r.last_scraped = nowIso;

  // Finding NOTHING is not evidence that every issue disappeared — it is exactly what an expired
  // Crashlytics login looks like (the page renders, the list comes back empty). Writing then would
  // push every existing row through the carry-over branch above and blank its rank, quietly wrecking
  // the worklist the dashboard and the collector both key on. Leave the CSV untouched; the audit
  // screenshot below is still taken, and that is what diagnoses the failed login.
  if (!discovered.length) {
    console.log(`⚠️  0 ${ISSUE_BASE} issues discovered — leaving ${ISSUES_CSV} untouched (expired login / page change?).`);
  } else {
    writeIssuesCsv(ISSUES_CSV, [...merged, ...carryOver]);
    console.log(`💾 Saved worklist → ${ISSUES_CSV}  (${merged.length} active + ${carryOver.length} carried-over)`);
  }

  // ── Optional: rich JSON dump for debugging ──────────────────────────────
  if (ISSUES_JSON_DEBUG) {
    const dump = {
      discovered_at: nowIso,
      url,
      query: BASE_QUERY,
      time: ISSUE_TIME_DEFAULT,
      bundle_id: BUNDLE_ID,
      kind: filterKind,
      page_totals: totals,
      count_found: found,
      issues: discovered,
    };
    fs.mkdirSync(path.dirname(ISSUES_JSON_DEBUG), { recursive: true });
    fs.writeFileSync(ISSUES_JSON_DEBUG, JSON.stringify(dump, null, 2));
    console.log(`🧪 Debug JSON   → ${ISSUES_JSON_DEBUG}`);
  }

  // ── Audit screenshot ────────────────────────────────────────────────────
  const _d = new Date(), _p = (n: number) => String(n).padStart(2, '0');
  const shotTs = `${_d.getFullYear()}${_p(_d.getMonth()+1)}${_p(_d.getDate())}_${_p(_d.getHours())}${_p(_d.getMinutes())}${_p(_d.getSeconds())}`;
  const shotPath = path.resolve(
    './data/screenshots',
    `discover_${VERSION_SLUG}_${shotTs}.png`,
  );
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true });
  console.log(`📸 Screenshot → ${shotPath}`);
});
