#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3737;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const ISSUES_CSV = path.join(DATA_DIR, 'issues_3.7.0.csv');
const EVENTS_CSV = path.join(DATA_DIR, 'events_3.7.0.csv');
const REVIEWED_JSON = path.join(DATA_DIR, 'reviewed_sessions.json');

// ── CSV parser ────────────────────────────────────────────────────────────────

function splitCsvLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map(line => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (values[i] ?? '').trim()]));
  });
}

function readCsv(filePath) {
  try { return parseCsv(fs.readFileSync(filePath, 'utf-8')); }
  catch { return []; }
}

function readLog(eventId) {
  try { return JSON.parse(fs.readFileSync(path.join(LOGS_DIR, `${eventId}.log`), 'utf-8')); }
  catch { return null; }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function jsonResp(res, data) {
  cors(res);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sseStart(res) {
  cors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n'); // initial ping so browser fires 'open'
}

function sseWrite(res, event, data) {
  if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function runWithSSE(res, cmd, args, env = {}) {
  sseStart(res);

  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  child.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop(); // keep incomplete last line
    for (const line of lines) {
      if (line.includes('[GFK:PROGRESS]')) {
        sseWrite(res, 'progress', {});
      } else {
        sseWrite(res, 'output', { text: line + '\n' });
      }
    }
  });
  child.stderr.on('data', chunk => sseWrite(res, 'output', { text: chunk.toString(), err: true }));
  child.on('close', code => {
    if (stdoutBuf) sseWrite(res, 'output', { text: stdoutBuf });
    sseWrite(res, 'done', { code });
    res.end();
  });
  res.on('close', () => { try { child.kill(); } catch {} });
}

// ── Router ────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname, searchParams } = url;

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  // POST /api/save-note  { file: "Task-001.md", content: "..." }
  if (req.method === 'POST' && pathname === '/api/save-note') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { file, content } = JSON.parse(body);
        if (!file || !/^[A-Za-z0-9_-]+\.md$/.test(file)) {
          res.writeHead(400); res.end('Bad filename'); return;
        }
        const dest = path.join(ROOT, 'data', 'notes', file);
        fs.writeFileSync(dest, content, 'utf8');
        cors(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(500); res.end(e.message); }
    });
    return;
  }

  // POST /api/save-reviewed  { sessions: [...] }
  if (req.method === 'POST' && pathname === '/api/save-reviewed') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { sessions } = JSON.parse(body);
        if (!Array.isArray(sessions)) { res.writeHead(400); res.end('Bad request'); return; }
        fs.writeFileSync(REVIEWED_JSON, JSON.stringify(sessions, null, 2), 'utf8');
        cors(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(500); res.end(e.message); }
    });
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(DATA_DIR, 'dashboard.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500); res.end('dashboard.html not found');
    }
    return;
  }

  if (pathname === '/api/status') {
    const issues = readCsv(ISSUES_CSV);
    const events = readCsv(EVENTS_CSV).map(ev => {
      const eventId = (ev.session_event_key || '').split('_').pop();
      const log = eventId ? readLog(eventId) : null;
      return { ...ev, log };
    });
    jsonResp(res, { issues, events, ts: new Date().toISOString() });
    return;
  }

  if (pathname === '/api/discover') {
    const time = searchParams.get('time') || '';
    const env = { HEADLESS: 'true', ...(time ? { ISSUE_TIME_DEFAULT: time } : {}) };
    runWithSSE(res, 'npx', ['playwright', 'test', 'tests/discover-issues.spec.ts'], env);
    return;
  }

  if (pathname === '/api/collect') {
    const issueType = searchParams.get('issueType') || '';
    const time      = searchParams.get('time') || '';
    const env = {
      HEADLESS: 'true',
      ...(issueType ? { ISSUE_TYPES_LIST: issueType } : {}),
      ...(time      ? { ISSUE_TIME_DEFAULT: time }     : {}),
    };
    runWithSSE(res, 'npx', ['playwright', 'test', 'tests/collect.spec.ts'], env);
    return;
  }

  // Serve static files from the data/ directory (CSVs, logs)
  if (pathname.startsWith('/data/')) {
    const filePath = path.join(ROOT, pathname);
    try {
      const ext = path.extname(filePath);
      const mime = ext === '.csv' ? 'text/csv' : ext === '.log' ? 'application/json' : 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      cors(res);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  GFK Dashboard  →  http://localhost:${PORT}\n`);
});
