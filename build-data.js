#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Pre-process collected data for the dashboard.
//
// The dashboard's old load path fetched events_<v>.csv AND one data/logs/<id>.log
// per event (hundreds–thousands of tiny HTTP requests), then ran processLogs in
// the browser. On weak/old browsers that storm of requests + JSON parsing was the
// real cause of slow loads and crashes.
//
// This script does that work once, at build time, and emits a single compact
// data/events_<v>.json = [{ ...csvRow, logs:[{ts,rawTs,type,msg}], startTs }].
// The dashboard then loads each version with ONE fetch + ONE JSON.parse.
//
//   node build-data.js                 # all known versions
//   node build-data.js 3.7.1 3.7.0     # only these
//
// processLogs/parseTs/fmtTs below MUST stay in sync with index.html.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const LOGS = path.join(DATA, 'logs');
const VERSIONS = process.argv.slice(2).length ? process.argv.slice(2) : ['3.8.1', '3.8.0', '3.7.1', '3.7.0'];

// ── CSV parsing (mirror of index.html parseCsv/splitLine) ────────────────────
function splitLine(line) {
  const out = []; let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}
function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = splitLine(lines[0]);
  return lines.slice(1).filter(Boolean).map(line => {
    const vals = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (vals[i] ?? '').trim()]));
  });
}

// ── Log processing (mirror of index.html parseTs/fmtTs/processLogs) ──────────
function pad(n) { return String(n).padStart(2, '0'); }
function parseTs(ts) {
  if (!ts) return 0;
  const n = typeof ts === 'number' ? ts : new Date(ts).getTime();
  return isNaN(n) ? 0 : n;
}
function fmtTs(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function processLogs(items) {
  return (items || []).map(item => {
    const rawTs = parseTs(item.timestamp);
    if (item.name === 'screen_view')
      return { ts: fmtTs(item.timestamp), rawTs, type: 'screen', msg: item.params?.firebase_screen_class || '?' };
    const msg = item.message || '';
    let type = 'log';
    if (/error|failed|abort/i.test(msg) && !/success/i.test(msg)) type = 'error';
    else if (/success|verified|connected/i.test(msg)) type = 'log-ok';
    return { ts: fmtTs(item.timestamp), rawTs, type, msg };
  });
}

// ── Build one version ────────────────────────────────────────────────────────
function buildVersion(v) {
  const csvPath = path.join(DATA, `events_${v}.csv`);
  if (!fs.existsSync(csvPath)) { console.log(`skip ${v}: ${csvPath} missing`); return; }
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  let withLogs = 0, missing = 0;
  const out = rows.map(ev => {
    const eventId = (ev.session_event_key || '').split('_').pop();
    let logs = [];
    if (eventId) {
      const logPath = path.join(LOGS, `${eventId}.log`);
      if (fs.existsSync(logPath)) {
        try { logs = processLogs(JSON.parse(fs.readFileSync(logPath, 'utf8')).logs_and_breadcrumbs); withLogs++; }
        catch { missing++; }
      } else missing++;
    }
    return { ...ev, logs, startTs: logs[0]?.rawTs || null };
  });
  const jsonPath = path.join(DATA, `events_${v}.json`);
  // data/logs/ is local-only (gitignored), so on a fresh clone it can be empty or partial while
  // the COMMITTED json still holds every breadcrumb. Rebuilding from a thinner set of logs would
  // silently overwrite good data with empty `logs: []` arrays, so refuse and keep what we have.
  if (fs.existsSync(jsonPath)) {
    let prevWithLogs = 0;
    try { prevWithLogs = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).filter(e => (e.logs || []).length).length; }
    catch { prevWithLogs = 0; }
    if (withLogs < prevWithLogs) {
      console.log(`REFUSING to rewrite ${v}: only ${withLogs} events have a local log file, the existing ` +
                  `JSON has ${prevWithLogs}. Is data/logs/ complete on this machine? (nothing written)`);
      return;
    }
  }
  fs.writeFileSync(jsonPath, JSON.stringify(out));
  const mb = (fs.statSync(jsonPath).size / 1048576).toFixed(2);
  console.log(`built ${v}: ${out.length} events (${withLogs} with logs, ${missing} no log) → ${jsonPath} (${mb} MB)`);
}

// ── data/crashes.json (the dashboard's Crashes section) ──────────────────────
// The collector's crash pass (COLLECT_CRASHES=1) puts FaceKom crash events into events_<v>.csv
// with crash_kind=CRASH and their stack trace / fatal message into the log file's `crash` block.
// Built across ALL active versions (not just the ones on the command line), because the section
// ignores the version filter. A hand-written `title` / `diagnosis` survives rebuilds: carried over by
// issue_id from the current file, else from the pre-3.9.0 archive.
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function crashedStep(logs) {
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = /currentStep: (\w+)/.exec(logs[i].msg) || /nextStep: custom\(type: "([^"]+)"/.exec(logs[i].msg)
           || /nextStep: (\w+)\(/.exec(logs[i].msg);
    if (m && m[1] !== 'end') return m[1];
  }
  return '';
}

function buildCrashes() {
  const relCsv = path.join(DATA, 'version_releases.csv');
  const active = fs.existsSync(relCsv)
    ? parseCsv(fs.readFileSync(relCsv, 'utf8')).filter(r => r.version && (r.active ?? '1') !== '0').map(r => r.version)
    : VERSIONS;
  const outPath = path.join(DATA, 'crashes.json');
  const prev = readJson(outPath)?.issues || [];
  const archived = readJson(path.join(ROOT, 'archive/pre-3.9.0/data/crashes.json'))?.issues || [];
  // Hand-kept fields: `title` (the raw one is a mangled Swift symbol) and `diagnosis`.
  const keptOf = (id, k) => prev.find(i => i.issue_id === id)?.[k] || archived.find(i => i.issue_id === id)?.[k] || '';
  // Fresh clone without data/logs: keep the previously built event entry instead of blanking it.
  const prevEvent = new Map(prev.flatMap(i => i.events || []).map(e => [e.event_id, e]));

  const byIssue = new Map();
  for (const v of active) {
    const csvPath = path.join(DATA, `events_${v}.csv`);
    if (!fs.existsSync(csvPath)) continue;
    for (const ev of parseCsv(fs.readFileSync(csvPath, 'utf8')).filter(r => r.crash_kind === 'CRASH')) {
      const log = readJson(path.join(LOGS, `${ev.event_id}.log`));
      const crash = log?.crash;
      if (!crash && prevEvent.has(ev.event_id)) {
        const old = prevEvent.get(ev.event_id);
        if (!byIssue.has(ev.issue_id)) byIssue.set(ev.issue_id, { ev, crash: null, events: [] });
        byIssue.get(ev.issue_id).events.push(old);
        continue;
      }
      const logs = processLogs(log?.logs_and_breadcrumbs);
      if (!byIssue.has(ev.issue_id)) byIssue.set(ev.issue_id, { ev, crash, events: [] });
      const slot = byIssue.get(ev.issue_id);
      if (!slot.crash && crash) slot.crash = crash;
      slot.events.push({
        event_id:        ev.event_id,
        session_id_base: ev.session_id_base,
        facekom_session: (/\/identification\/([^/?#]+)/.exec(ev.identification_link) || [])[1] || '',
        app_version:     ev.app_version,
        os_version:      ev.os_version,
        model:           ev.model,
        date:            ev.date,
        crashed_step:    crashedStep(logs),
        console_url:     (ev.event_url || '').replace('types=error', 'types=crash'),
        stack_trace:     crash?.stack_trace || [],
        breadcrumbs:     logs.map(({ ts, type, msg }) => ({ ts, type, msg })),
      });
    }
  }

  const issues = [...byIssue.entries()].map(([id, { ev, crash, events }]) => {
    const prevIss = prev.find(i => i.issue_id === id) || {};
    events.sort((a, b) => new Date(b.date) - new Date(a.date));
    return {
      issue_id:      id,
      title:         keptOf(id, 'title') || crash?.title || ev.nserror_domain || 'crash',
      symbol:        crash?.symbol || prevIss.symbol || '',
      blame:         crash?.blame || prevIss.blame || '',
      exception:     crash?.exception || prevIss.exception || '',
      fatal_message: crash?.fatal_message || prevIss.fatal_message || '',
      diagnosis:     keptOf(id, 'diagnosis'),
      events_total:  events.length,
      users_total:   new Set(events.map(e => e.facekom_session || e.session_id_base)).size,
      version_range: [...new Set(events.map(e => (e.app_version || '').split(' ')[0]).filter(Boolean))].join(', '),
      app_version:   events[0]?.app_version || '',
      console_url:   (ev.event_url || '').replace('types=error', 'types=crash').replace(/&sessionEventKey=[^&]*/, ''),
      events,
    };
  }).sort((a, b) => b.events_total - a.events_total);

  fs.writeFileSync(outPath, JSON.stringify({
    generated: new Date().toISOString(),
    note: 'FaceKom FATAL Crashlytics issues of the active versions — built by build-data.js from the collector crash pass (COLLECT_CRASHES=1).',
    issues,
  }, null, 2) + '\n');
  console.log(`built crashes.json: ${issues.length} issue(s), ${issues.reduce((a, i) => a + i.events.length, 0)} event(s)`);
}

for (const v of VERSIONS) buildVersion(v);
buildCrashes();
