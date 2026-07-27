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
const VERSIONS = process.argv.slice(2).length ? process.argv.slice(2) : ['3.8.0', '3.7.1', '3.7.0'];

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
  fs.writeFileSync(jsonPath, JSON.stringify(out));
  const mb = (fs.statSync(jsonPath).size / 1048576).toFixed(2);
  console.log(`built ${v}: ${out.length} events (${withLogs} with logs, ${missing} no log) → ${jsonPath} (${mb} MB)`);
}

for (const v of VERSIONS) buildVersion(v);
