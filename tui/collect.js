'use strict';

// ── Process orchestration: local server, auth setup, and the collector ──────────

const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const { ROOT, buildCollectEnv, hasAuth } = require('./data');

const SERVER_PORT = process.env.PORT || 3737;

// Is something already listening on the dashboard port?
function isPortOpen(port, host = '127.0.0.1', timeout = 600) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = ok => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

// Start server.js in the background if it isn't already running.
// Resolves { started, port }. Leaves the server running on exit so the HTML
// dashboard stays reachable from the phone.
async function ensureServer(onLog = () => {}) {
  if (await isPortOpen(SERVER_PORT)) {
    onLog(`server already up on :${SERVER_PORT}`);
    return { started: false, port: SERVER_PORT, child: null };
  }
  onLog(`starting server.js on :${SERVER_PORT} …`);
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  // give it a moment to bind
  for (let i = 0; i < 20; i++) {
    if (await isPortOpen(SERVER_PORT)) { onLog(`server up on :${SERVER_PORT}`); break; }
    await new Promise(r => setTimeout(r, 150));
  }
  return { started: true, port: SERVER_PORT, child };
}

// Spawn a Playwright run, stream stdout line-by-line, surface [GFK:PROGRESS] ticks.
// handlers: { onLog(line), onProgress(), onDone(code) }. Returns the child process.
function runPlaywright(args, env, handlers) {
  const { onLog = () => {}, onProgress = () => {}, onDone = () => {} } = handlers;
  const child = spawn('npx', args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let buf = '';
  const pump = chunk => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.includes('[GFK:PROGRESS]')) onProgress();
      else onLog(line);
    }
  };
  child.stdout.on('data', pump);
  child.stderr.on('data', pump);
  child.on('close', code => {
    if (buf) onLog(buf);
    onDone(code);
  });
  return child;
}

// Run the collector for a given config selection.
function runCollect(cfg, handlers) {
  return runPlaywright(
    ['playwright', 'test', 'tests/collect.spec.ts'],
    buildCollectEnv(cfg),
    handlers,
  );
}

// Run the interactive auth setup (opens a real browser on the desktop).
function runSetup(handlers) {
  return runPlaywright(['playwright', 'test', '--project=setup'], {}, handlers);
}

module.exports = { SERVER_PORT, isPortOpen, ensureServer, runCollect, runSetup, hasAuth };
