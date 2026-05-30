'use strict';

// ── Pure data helpers for the GFK TUI ──────────────────────────────────────────
// No blessed / no side effects here so this stays unit-testable from plain node.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

// Minimal CSV reader (handles quoted fields with embedded commas).
function splitCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function readCsv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = splitCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]));
  });
}

// All known app versions, newest first → [{ version, build, date, label }]
function listVersions() {
  const rows = readCsv(path.join(DATA_DIR, 'version_releases.csv'));
  return rows
    .map(r => ({ version: r.version, build: r.build, date: r.date, label: `${r.version} (${r.build})` }))
    .sort((a, b) => (a.version < b.version ? 1 : -1));
}

// Issue names tracked for a given app version → [{ name, events, users }]
function listIssues(version) {
  const rows = readCsv(path.join(DATA_DIR, `issues_${version}.csv`));
  return rows
    .filter(r => r.issue_name)
    .map(r => ({
      name: r.issue_name,
      events: Number(r.events_total || 0),
      users: Number(r.users_total || 0),
    }));
}

const TIME_OPTIONS = [
  { key: '24h', label: 'Last 24 hours' },
  { key: '7d',  label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
];

// Sensible "ready to go" defaults — 3.7.1, all its issues, 90d window.
function defaultConfig() {
  const versions = listVersions();
  const v = versions.find(x => x.version === '3.7.1') || versions[0];
  return {
    version: v ? v.version : '3.7.1',
    build: v ? v.build : '',
    issues: listIssues(v ? v.version : '3.7.1').map(i => i.name), // all preselected
    time: '90d',
  };
}

// Translate a config selection into the env the Playwright collector reads.
function buildCollectEnv(cfg) {
  return {
    HEADLESS: 'true',
    ISSUE_VERSIONS: cfg.build ? `${cfg.version} (${cfg.build})` : cfg.version,
    ISSUE_TYPES_LIST: (cfg.issues || []).join(','),
    ISSUE_TIME_DEFAULT: cfg.time || '90d',
    EVENTS_CSV: `./data/events_${cfg.version}.csv`,
    ISSUES_CSV: `./data/issues_${cfg.version}.csv`,
  };
}

function hasAuth() {
  return fs.existsSync(path.join(ROOT, 'auth', 'session.json'));
}

module.exports = {
  ROOT, DATA_DIR,
  readCsv, listVersions, listIssues,
  TIME_OPTIONS, defaultConfig, buildCollectEnv, hasAuth,
};
