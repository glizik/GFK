#!/usr/bin/env node
'use strict';

// ── GFK TUI — Phase 1: collection config + live progress ────────────────────────
// Mouse + keyboard. Starts the local server, runs auth setup if needed, then the
// Playwright collector, streaming progress. (Timeline view arrives in Phase 2.)

const blessed = require('blessed');
const data = require('./data');
const collect = require('./collect');

const COLORS = {
  accent: '#38bdf8',   // analytics blue, matches the dashboard
  good: '#22c55e',
  warn: '#fb923c',
  dim: 'grey',
};

const screen = blessed.screen({
  smartCSR: true,
  mouse: true,
  fullUnicode: true,
  title: 'GFK Collector',
  autoPadding: true,
});

// Track child processes so we can clean up on quit.
const children = new Set();
function track(child) { if (child) { children.add(child); child.on('close', () => children.delete(child)); } return child; }
function quit() {
  for (const c of children) { try { c.kill(); } catch {} }
  screen.destroy();
  process.exit(0);
}
screen.key(['q', 'C-c'], quit);

// Header bar
const header = blessed.box({
  parent: screen, top: 0, left: 0, height: 1, width: '100%',
  tags: true, style: { fg: 'black', bg: COLORS.accent },
  content: ' GFK Collector  {bold}·{/bold}  Phase 1 — setup & collect ',
});

// Footer hint bar
const footer = blessed.box({
  parent: screen, bottom: 0, left: 0, height: 1, width: '100%',
  tags: true, style: { fg: COLORS.dim },
  content: ' Space/click: toggle   Tab/↑↓: move   Enter: start   q: quit ',
});

// ── Shared selection state ──────────────────────────────────────────────────────
const state = data.defaultConfig();          // { version, build, issues:[names], time }
const versions = data.listVersions();

let configBox = null;

// ── Config screen ───────────────────────────────────────────────────────────────
function buildConfig() {
  if (configBox) { configBox.destroy(); configBox = null; }

  const issues = data.listIssues(state.version);
  // Keep selection sane when switching versions: keep names that still exist,
  // default to all when the set is unknown.
  const known = new Set(issues.map(i => i.name));
  if (!state.issues.some(n => known.has(n))) state.issues = issues.map(i => i.name);

  configBox = blessed.box({
    parent: screen, top: 2, left: 'center', width: '90%', height: '100%-4',
    label: ' Collection setup ', border: 'line',
    style: { border: { fg: COLORS.accent }, label: { fg: COLORS.accent } },
    tags: true, keys: true, scrollable: true, alwaysScroll: true,
  });

  let y = 1;
  const heading = txt => blessed.text({
    parent: configBox, top: y++, left: 2, tags: true,
    content: `{bold}${txt}{/bold}`,
  });

  // App version (radio)
  heading('App version');
  const verSet = blessed.radioset({ parent: configBox, top: y, left: 4, height: 1, width: '90%' });
  let vx = 0;
  for (const v of versions) {
    const rb = blessed.radiobutton({
      parent: verSet, left: vx, top: 0, mouse: true, keys: true,
      content: v.label + (v.version === '3.7.0' ? ' (older — no FaceKom grouping)' : ''),
      checked: v.version === state.version,
    });
    rb.on('check', () => {
      if (state.version === v.version) return;
      state.version = v.version; state.build = v.build;
      buildConfig(); // issues differ per version → rebuild
    });
    vx += v.label.length + 6;
  }
  y += 2;

  // Issues (checkboxes)
  heading(`Issues to collect  {grey-fg}(${issues.length}){/grey-fg}`);
  for (const issue of issues) {
    const cb = blessed.checkbox({
      parent: configBox, top: y++, left: 4, mouse: true, keys: true,
      content: `${issue.name}  {grey-fg}· ${issue.events} ev / ${issue.users} users{/grey-fg}`,
      tags: true,
      checked: state.issues.includes(issue.name),
    });
    const sync = () => {
      const on = cb.checked;
      const has = state.issues.includes(issue.name);
      if (on && !has) state.issues.push(issue.name);
      if (!on && has) state.issues = state.issues.filter(n => n !== issue.name);
    };
    cb.on('check', sync);
    cb.on('uncheck', sync);
  }
  y += 1;

  // Time window (radio)
  heading('Time window');
  const timeSet = blessed.radioset({ parent: configBox, top: y, left: 4, height: 1, width: '90%' });
  let tx = 0;
  for (const t of data.TIME_OPTIONS) {
    const rb = blessed.radiobutton({
      parent: timeSet, left: tx, top: 0, mouse: true, keys: true,
      content: t.key, checked: t.key === state.time,
    });
    rb.on('check', () => { state.time = t.key; });
    tx += t.key.length + 6;
  }
  y += 2;

  // Start button
  const start = blessed.button({
    parent: configBox, top: y, left: 4, height: 3, width: 26,
    content: '▶  Start collection', align: 'center', valign: 'middle',
    mouse: true, keys: true, shrink: true, padding: { left: 2, right: 2 },
    style: { fg: 'black', bg: COLORS.good, focus: { bg: COLORS.accent }, hover: { bg: COLORS.accent } },
    border: 'line',
  });
  start.on('press', startCollection);
  screen.key(['enter'], () => { if (configBox) startCollection(); });

  start.focus();
  screen.render();
}

// ── Progress screen ───────────────────────────────────────────────────────────
function startCollection() {
  const cfg = { version: state.version, build: state.build, issues: state.issues.slice(), time: state.time };
  if (!cfg.issues.length) { footer.setContent(' {red-fg}Pick at least one issue first.{/red-fg} '); screen.render(); return; }

  if (configBox) { configBox.destroy(); configBox = null; }
  screen.key(['enter'], () => {}); // disarm

  const startTs = Date.now();
  let collected = 0;
  let pulse = 0;
  let running = true;

  const info = blessed.box({
    parent: screen, top: 2, left: 'center', width: '90%', height: 6,
    label: ' Collecting ', border: 'line', tags: true,
    style: { border: { fg: COLORS.accent }, label: { fg: COLORS.accent } },
  });
  const bar = blessed.progressbar({
    parent: screen, top: 8, left: 'center', width: '90%', height: 3,
    border: 'line', ch: '█', filled: 0,
    style: { bar: { bg: COLORS.accent }, border: { fg: COLORS.dim } },
  });
  const logBox = blessed.log({
    parent: screen, top: 11, left: 'center', width: '90%', height: '100%-13',
    label: ' Output ', border: 'line', tags: false,
    style: { border: { fg: COLORS.dim } },
    scrollback: 1000, scrollbar: { ch: ' ', style: { bg: COLORS.dim } },
    mouse: true, keys: true,
  });

  const fmtElapsed = () => {
    const s = Math.floor((Date.now() - startTs) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const spin = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  function refresh() {
    const sp = running ? spin[pulse % spin.length] : '✓';
    info.setContent(
      `\n  {bold}${sp}{/bold}  ${running ? 'Collecting…' : 'Done.'}` +
      `   elapsed {bold}${fmtElapsed()}{/bold}   new events {bold}${collected}{/bold}\n` +
      `  version {bold}${cfg.version} (${cfg.build}){/bold}   window {bold}${cfg.time}{/bold}` +
      `   issues {bold}${cfg.issues.length}{/bold}`
    );
    if (running) { pulse++; bar.setProgress((pulse * 7) % 100); } // indeterminate pulse
    else bar.setProgress(100);
    screen.render();
  }
  const ticker = setInterval(refresh, 120);
  refresh();

  const onLog = line => { if (line && line.trim()) logBox.log(line.replace(/\s+$/,'')); };

  function finish(code) {
    running = false;
    clearInterval(ticker);
    refresh();
    const url = `http://192.168.135.102:${collect.SERVER_PORT}`;
    info.setContent(
      `\n  {bold}✓ Collection finished{/bold}  (exit ${code})` +
      `   new events {bold}${collected}{/bold}   elapsed {bold}${fmtElapsed()}{/bold}\n` +
      `  HTML dashboard: {underline}${url}{/underline}   ·   Timeline view: coming in Phase 2`
    );
    footer.setContent(' Collection done.   r: run again   q: quit ');
    screen.key(['r'], () => { footer.setContent(''); info.destroy(); bar.destroy(); logBox.destroy(); buildConfig(); });
    screen.render();
  }

  (async () => {
    await collect.ensureServer(onLog);
    if (!collect.hasAuth()) {
      onLog('⚠️  No auth/session.json — launching setup (a browser opens on the Mac desktop)…');
      track(collect.runSetup({
        onLog, onProgress: () => {},
        onDone: code => {
          if (code === 0 && collect.hasAuth()) { onLog('✅ Auth saved. Starting collection…'); go(); }
          else { onLog('❌ Setup did not complete. Fix auth, then press r.'); finish(code); }
        },
      }));
    } else {
      go();
    }
  })();

  function go() {
    track(collect.runCollect(cfg, {
      onLog,
      onProgress: () => { collected++; },
      onDone: finish,
    }));
  }
}

buildConfig();
screen.render();
