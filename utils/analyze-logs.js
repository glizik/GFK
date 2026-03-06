/**
 * analyze-logs.js
 *
 * Reads all downloaded .log files from LOGS_DIR, parses step timings,
 * writes a step_timings.csv, and generates an interactive HTML report.
 *
 * Usage:
 *   node utils/analyze-logs.js
 *
 * Output:
 *   data/step_timings.csv   — one row per session, columns per step duration
 *   data/flow_analysis.html — interactive timing visualization
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR   = process.env.LOGS_DIR   || './data/logs';
const OUTPUT_CSV  = process.env.OUTPUT_CSV  || './data/step_timings.csv';
const OUTPUT_HTML = process.env.OUTPUT_HTML || './data/flow_analysis.html';

// ── Step definitions ──────────────────────────────────────────────────────────

const STEP_ORDER = [
  'start',
  'voice-liveness-check',
  'deepfake-detection',
  'customerPortrait',
  'idFront',
  'idBack',
  'hologram',
  'id-back-video',
  'twoFactor',
  'end',
];

const STEP_LABELS = {
  'start':               'Session Start',
  'voice-liveness-check':'Voice Liveness',
  'deepfake-detection':  'Deepfake Detection',
  'customerPortrait':    'Customer Portrait',
  'idFront':             'ID Front Photo',
  'idBack':              'ID Back Photo',
  'hologram':            'Hologram Video',
  'id-back-video':       'ID Back Video',
  'twoFactor':           'Two-Factor Auth',
  'end':                 'End',
};

// ── Parser ────────────────────────────────────────────────────────────────────

function parseTs(tsStr) {
  // "Wed Feb 25 2026 15:21:14 GMT+0100 (Central European Standard Time)"
  const m = tsStr.match(/\w+ (\w+ \d+ \d+ \d+:\d+:\d+)/);
  if (!m) return null;
  const d = new Date(m[1] + ' UTC');
  return isNaN(d) ? null : d;
}

function extractSession(data, filename) {
  const logs = data.logs_and_breadcrumbs || [];
  const times = {};
  let outcome = 'unknown';
  let reason = '';

  for (const e of logs) {
    const ts = parseTs(e.timestamp);
    const msg = e.message || '';
    if (!msg || !ts) continue;

    if (msg.includes('FaceKom started from') && !times['start']) {
      times['start'] = ts;
    }

    if (msg.includes('FaceKom nextStep')) {
      // custom step
      const cm = msg.match(/nextStep: custom\(type: "([^"]+)"/);
      if (cm && !times[cm[1]]) times[cm[1]] = ts;

      // named steps: customerPortrait, idFront, idBack, hologram, twoFactor, end
      const nm = msg.match(/nextStep: (\w+)\(/);
      if (nm && !times[nm[1]]) times[nm[1]] = ts;

      // end status
      if (msg.includes('end(status:')) {
        const sm = msg.match(/status: "(\w+)"/);
        const rm = msg.match(/reason = "([^"]+)"/);
        if (sm) outcome = sm[1];
        if (rm) reason = rm[1];
        if (!times['end']) times['end'] = ts;
      }
    }

    if (msg.includes('FaceKom finished with type')) {
      const m = msg.match(/type: (\w+)/);
      if (m) outcome = m[1];
    }

    if (msg.includes('FaceKom failed') && !times['end']) {
      times['end'] = ts;
      if (outcome === 'unknown') outcome = 'failed';
    }
  }

  // Durations between consecutive steps
  const durations = {};
  for (let i = 0; i < STEP_ORDER.length - 1; i++) {
    const s1 = STEP_ORDER[i];
    const s2 = STEP_ORDER[i + 1];
    if (times[s1] && times[s2]) {
      const diff = (times[s2] - times[s1]) / 1000;
      if (diff >= 0 && diff <= 3600) { // sanity: 0s–1hr
        durations[`${s1}->${s2}`] = Math.round(diff);
      }
    }
  }

  // Last step reached
  let lastStep = 'start';
  for (const s of STEP_ORDER) {
    if (times[s]) lastStep = s;
  }

  const stepsReached = STEP_ORDER.filter(s => times[s]);

  return {
    filename,
    session_id: data.session_id || '',
    issue_id: data.issue_id || '',
    display_version: data.display_version || '',
    event_timestamp: data.event_timestamp || '',
    outcome,
    reason,
    last_step: lastStep,
    steps_reached: stepsReached,
    durations,
    times, // raw Date objects for reference
  };
}

// ── Load all logs ─────────────────────────────────────────────────────────────

function loadSessions() {
  if (!fs.existsSync(LOGS_DIR)) {
    console.error(`❌ LOGS_DIR not found: ${LOGS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log'));
  console.log(`📂 Found ${files.length} log files in ${LOGS_DIR}`);

  const sessions = [];
  let skipped = 0;

  for (const file of files) {
    const fpath = path.join(LOGS_DIR, file);
    try {
      const content = fs.readFileSync(fpath, 'utf-8').trim();
      if (!content || !content.startsWith('{')) { skipped++; continue; }
      const data = JSON.parse(content);
      if (!data.logs_and_breadcrumbs) { skipped++; continue; }
      sessions.push(extractSession(data, file));
    } catch {
      skipped++;
    }
  }

  console.log(`✅ Parsed ${sessions.length} sessions (${skipped} skipped — scraped/empty)`);
  return sessions;
}

// ── Write CSV ─────────────────────────────────────────────────────────────────

function writeCsv(sessions) {
  const transitionKeys = [];
  for (let i = 0; i < STEP_ORDER.length - 1; i++) {
    transitionKeys.push(`${STEP_ORDER[i]}->${STEP_ORDER[i+1]}`);
  }

  const headers = [
    'session_id', 'filename', 'display_version', 'outcome', 'reason',
    'last_step', 'steps_count', 'total_duration_s',
    ...transitionKeys.map(k => `dur_${k.replace(/[^a-z]/gi,'_')}`)
  ];

  const rows = sessions.map(s => {
    const totalDur = Object.values(s.durations).reduce((a, b) => a + b, 0);
    return [
      s.session_id,
      s.filename,
      s.display_version,
      s.outcome,
      s.reason,
      s.last_step,
      s.steps_reached.length,
      totalDur,
      ...transitionKeys.map(k => s.durations[k] ?? ''),
    ];
  });

  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.map(v => String(v).includes(',') ? `"${v}"` : v).join(','))
  ].join('\n') + '\n';

  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });
  fs.writeFileSync(OUTPUT_CSV, csvContent);
  console.log(`📊 CSV written: ${OUTPUT_CSV} (${sessions.length} rows)`);
}

// ── Compute stats ─────────────────────────────────────────────────────────────

function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return { mean: Math.round(mean), median, p25, p75, min, max, count: sorted.length };
}

function computeStepStats(sessions) {
  const result = {};

  // Funnel: how many sessions reached each step
  const reachCounts = {};
  for (const s of STEP_ORDER) reachCounts[s] = 0;
  for (const s of sessions) {
    for (const step of s.steps_reached) reachCounts[step]++;
  }

  // Duration stats per transition
  for (let i = 0; i < STEP_ORDER.length - 1; i++) {
    const s1 = STEP_ORDER[i];
    const s2 = STEP_ORDER[i + 1];
    const key = `${s1}->${s2}`;
    const vals = sessions.map(s => s.durations[key]).filter(v => v !== undefined);
    result[key] = {
      from: s1,
      to: s2,
      fromLabel: STEP_LABELS[s1],
      toLabel: STEP_LABELS[s2],
      reachedFrom: reachCounts[s1],
      reachedTo: reachCounts[s2],
      dropOff: reachCounts[s1] - reachCounts[s2],
      stats: stats(vals),
    };
  }

  // Outcome breakdown
  const outcomes = {};
  for (const s of sessions) outcomes[s.outcome] = (outcomes[s.outcome] || 0) + 1;

  // Drop-off reasons
  const dropReasons = {};
  for (const s of sessions) {
    if (s.reason) dropReasons[s.reason] = (dropReasons[s.reason] || 0) + 1;
  }

  return { transitions: result, reachCounts, outcomes, dropReasons, total: sessions.length };
}

// ── Generate HTML ─────────────────────────────────────────────────────────────

function generateHtml(sessions, stepStats) {
  const dataJson = JSON.stringify({
    sessions: sessions.map(s => ({
      session_id: s.session_id,
      outcome: s.outcome,
      reason: s.reason,
      last_step: s.last_step,
      steps_reached: s.steps_reached,
      durations: s.durations,
      total: Object.values(s.durations).reduce((a,b)=>a+b,0),
    })),
    stepStats,
    stepOrder: STEP_ORDER,
    stepLabels: STEP_LABELS,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>FaceKom Flow Timing Analysis</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
  :root {
    --bg:#07070d;--surface:#0f0f18;--surface2:#171724;--border:#252535;
    --approve:#00c896;--reject:#ff4d6d;--warn:#ffb347;--accent:#00e5ff;
    --text:#e0e0f0;--muted:#555570;--mono:'Space Mono',monospace;--sans:'Syne',sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);min-height:100vh;}
  body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 15% 20%,rgba(0,229,255,0.04) 0%,transparent 55%),radial-gradient(ellipse at 85% 80%,rgba(0,200,150,0.04) 0%,transparent 55%);pointer-events:none;z-index:0;}

  header{padding:1.5rem 2.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1;}
  header h1{font-size:1.6rem;font-weight:800;letter-spacing:-0.02em;}
  header h1 span{color:var(--accent);}
  header p{font-family:var(--mono);font-size:0.65rem;color:var(--muted);margin-top:0.2rem;}

  .main{padding:2rem 2.5rem;display:flex;flex-direction:column;gap:2rem;position:relative;z-index:1;}

  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.5rem;}
  .card-title{font-family:var(--mono);font-size:0.65rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:1.25rem;display:flex;align-items:center;gap:0.75rem;}
  .card-title::after{content:'';flex:1;height:1px;background:var(--border);}

  /* Funnel + timing grid */
  .steps-grid{display:flex;flex-direction:column;gap:0;}

  .step-row{display:grid;grid-template-columns:180px 1fr 340px;gap:1.5rem;align-items:center;padding:0.9rem 0;border-bottom:1px solid var(--border);}
  .step-row:last-child{border-bottom:none;}

  .step-name{font-size:0.8rem;font-weight:700;}
  .step-sub{font-family:var(--mono);font-size:0.6rem;color:var(--muted);margin-top:0.2rem;}

  /* Funnel bar */
  .funnel-col{display:flex;flex-direction:column;gap:0.3rem;}
  .funnel-bar-track{height:20px;background:var(--surface2);border-radius:4px;overflow:hidden;position:relative;}
  .funnel-bar-fill{height:100%;border-radius:4px;transition:width 1s cubic-bezier(0.16,1,0.3,1);}
  .funnel-label{font-family:var(--mono);font-size:0.62rem;color:var(--muted);display:flex;justify-content:space-between;}
  .drop-badge{color:var(--reject);font-weight:700;}

  /* Timing stats box */
  .timing-box{background:var(--surface2);border-radius:8px;padding:0.75rem 1rem;display:grid;grid-template-columns:repeat(5,1fr);gap:0.5rem;font-family:var(--mono);}
  .timing-stat{text-align:center;}
  .timing-val{font-size:0.9rem;font-weight:700;line-height:1;}
  .timing-key{font-size:0.55rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-top:0.2rem;}
  .timing-val.min{color:#7c3aed;}
  .timing-val.p25{color:var(--approve);}
  .timing-val.median{color:var(--accent);}
  .timing-val.p75{color:var(--warn);}
  .timing-val.max{color:var(--reject);}
  .timing-val.mean{color:var(--text);}
  .no-data{font-size:0.7rem;color:var(--muted);text-align:center;padding:0.5rem;}

  /* Charts row */
  .charts-row{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;}
  .chart-wrap{position:relative;height:260px;}

  /* Distribution chart per step */
  .step-dist-section{display:flex;flex-direction:column;gap:1rem;}
  .step-selector{display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.5rem;}
  .step-btn{padding:0.3rem 0.75rem;border-radius:5px;font-family:var(--mono);font-size:0.65rem;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--muted);transition:all 0.15s;letter-spacing:0.05em;}
  .step-btn.active{border-color:var(--accent);color:var(--accent);background:rgba(0,229,255,0.08);}
  .dist-chart-wrap{position:relative;height:200px;}

  /* Outcome summary */
  .outcome-pills{display:flex;gap:1rem;flex-wrap:wrap;}
  .outcome-pill{padding:0.6rem 1.2rem;border-radius:8px;border:1px solid;font-family:var(--mono);font-size:0.75rem;font-weight:700;}
  .outcome-pill .val{font-size:1.6rem;font-weight:800;display:block;line-height:1;}

  /* Session table */
  .table-wrap{overflow-x:auto;max-height:360px;overflow-y:auto;}
  table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:0.7rem;}
  thead th{position:sticky;top:0;background:var(--surface2);padding:0.5rem 0.75rem;text-align:left;color:var(--muted);font-weight:400;letter-spacing:0.08em;text-transform:uppercase;border-bottom:1px solid var(--border);white-space:nowrap;}
  tbody tr{border-bottom:1px solid #12121c;transition:background 0.1s;}
  tbody tr:hover{background:var(--surface2);}
  td{padding:0.45rem 0.75rem;color:#aaaacc;white-space:nowrap;}
  .outcome-approve{color:var(--approve);font-weight:700;}
  .outcome-reject{color:var(--reject);font-weight:700;}
  .outcome-unknown{color:var(--muted);}

  ::-webkit-scrollbar{width:4px;height:4px;}
  ::-webkit-scrollbar-track{background:var(--surface);}
  ::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}

  .filter-row{display:flex;gap:0.75rem;margin-bottom:1rem;align-items:center;flex-wrap:wrap;}
  select{background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:0.75rem;padding:0.4rem 0.7rem;border-radius:6px;outline:none;}
  select:focus{border-color:var(--accent);}
  .filter-label{font-family:var(--mono);font-size:0.62rem;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase;}
</style>
</head>
<body>
<header>
  <div>
    <h1>FaceKom <span>Flow Timing</span></h1>
    <p id="subtitle">STEP DURATION ANALYSIS · PER-EVENT · ALL LOG FILES</p>
  </div>
  <div style="font-family:var(--mono);font-size:0.7rem;color:var(--muted);text-align:right" id="header-stats"></div>
</header>

<div class="main">

  <!-- Outcome summary -->
  <div class="card">
    <div class="card-title">Outcome Summary</div>
    <div class="outcome-pills" id="outcome-pills"></div>
  </div>

  <!-- Funnel + step timings -->
  <div class="card">
    <div class="card-title">Step Funnel &amp; Timing Statistics</div>
    <div style="font-family:var(--mono);font-size:0.62rem;color:var(--muted);margin-bottom:1rem;display:flex;gap:2rem;">
      <span>Timing columns: <span style="color:#7c3aed">▪ min</span> <span style="color:var(--approve)">▪ p25</span> <span style="color:var(--accent)">▪ median</span> <span style="color:var(--warn)">▪ p75</span> <span style="color:var(--reject)">▪ max</span></span>
      <span>Time is spent between this step and the next.</span>
    </div>
    <div class="steps-grid" id="steps-grid"></div>
  </div>

  <!-- Charts -->
  <div class="charts-row">
    <div class="card">
      <div class="card-title">Total Duration Distribution</div>
      <div class="chart-wrap"><canvas id="chart-total-dist"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title">Step Time Comparison (Median)</div>
      <div class="chart-wrap"><canvas id="chart-step-median"></canvas></div>
    </div>
  </div>

  <!-- Per-step distribution -->
  <div class="card">
    <div class="card-title">Per-Step Duration Distribution</div>
    <div class="step-selector" id="step-selector"></div>
    <div class="dist-chart-wrap"><canvas id="chart-step-dist"></canvas></div>
  </div>

  <!-- Session table -->
  <div class="card">
    <div class="card-title">All Sessions</div>
    <div class="filter-row">
      <span class="filter-label">Outcome</span>
      <select id="filter-outcome" onchange="renderTable()">
        <option value="">All</option>
        <option value="approve">Approve</option>
        <option value="reject">Reject</option>
        <option value="finished">Finished</option>
        <option value="unknown">Unknown</option>
        <option value="failed">Failed</option>
      </select>
      <span class="filter-label" style="margin-left:1rem">Last step</span>
      <select id="filter-last-step" onchange="renderTable()">
        <option value="">All</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Session ID</th><th>Outcome</th><th>Last Step</th><th>Total (s)</th>
          <th>Voice (s)</th><th>Deepfake (s)</th><th>Portrait (s)</th>
          <th>ID Front (s)</th><th>ID Back (s)</th><th>Hologram (s)</th>
          <th>Reason</th>
        </tr></thead>
        <tbody id="table-body"></tbody>
      </table>
    </div>
  </div>

</div>

<script>
const DATA = ${dataJson};
const { sessions, stepStats, stepOrder, stepLabels } = DATA;
let distChart = null;

// ── Outcome summary ────────────────────────────────────────────────────────────
function renderOutcomes() {
  const counts = stepStats.outcomes;
  const total = stepStats.total;
  const colors = { approve:'var(--approve)', finished:'var(--approve)', reject:'var(--reject)', unknown:'var(--muted)', failed:'var(--reject)', aborted:'var(--warn)' };
  document.getElementById('outcome-pills').innerHTML = Object.entries(counts)
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v])=>\`<div class="outcome-pill" style="border-color:\${colors[k]||'var(--border)'}">
      <span class="val" style="color:\${colors[k]||'var(--text)'}">\${v}</span>
      \${k} · \${((v/total)*100).toFixed(1)}%
    </div>\`).join('');
  document.getElementById('header-stats').innerHTML = \`<span style="color:var(--accent)">\${total} sessions parsed</span><br>from log files\`;
}

// ── Steps grid ─────────────────────────────────────────────────────────────────
function fmt(s) {
  if (s === undefined || s === null) return '—';
  if (s < 60) return s + 's';
  return Math.floor(s/60) + 'm' + (s%60).toString().padStart(2,'0') + 's';
}

function renderStepsGrid() {
  const total = stepStats.total;
  const reach = stepStats.reachCounts;
  const trans = stepStats.transitions;

  let html = '';
  for (let i = 0; i < stepOrder.length; i++) {
    const step = stepOrder[i];
    const count = reach[step] || 0;
    const pct = total ? (count/total*100).toFixed(1) : 0;
    const color = pct > 80 ? 'var(--approve)' : pct > 50 ? 'var(--warn)' : 'var(--reject)';

    // Transition stats to NEXT step
    let timingHtml = '<div class="no-data">—</div>';
    if (i < stepOrder.length - 1) {
      const key = \`\${step}->\${stepOrder[i+1]}\`;
      const t = trans[key];
      if (t && t.stats) {
        const s = t.stats;
        timingHtml = \`<div class="timing-box">
          <div class="timing-stat"><div class="timing-val min">\${fmt(s.min)}</div><div class="timing-key">min</div></div>
          <div class="timing-stat"><div class="timing-val p25">\${fmt(s.p25)}</div><div class="timing-key">p25</div></div>
          <div class="timing-stat"><div class="timing-val median">\${fmt(s.median)}</div><div class="timing-key">median</div></div>
          <div class="timing-stat"><div class="timing-val p75">\${fmt(s.p75)}</div><div class="timing-key">p75</div></div>
          <div class="timing-stat"><div class="timing-val max">\${fmt(s.max)}</div><div class="timing-key">max</div></div>
        </div>\`;
      }
    }

    const dropOff = i < stepOrder.length-1 ? (reach[step]||0) - (reach[stepOrder[i+1]]||0) : 0;

    html += \`<div class="step-row">
      <div>
        <div class="step-name">\${stepLabels[step]}</div>
        <div class="step-sub">\${step}</div>
      </div>
      <div class="funnel-col">
        <div class="funnel-bar-track">
          <div class="funnel-bar-fill" style="width:\${pct}%;background:\${color}"></div>
        </div>
        <div class="funnel-label">
          <span>\${count} sessions (\${pct}%)</span>
          \${dropOff > 0 ? \`<span class="drop-badge">-\${dropOff} drop</span>\` : ''}
        </div>
      </div>
      \${timingHtml}
    </div>\`;
  }
  document.getElementById('steps-grid').innerHTML = html;
}

// ── Total duration distribution chart ─────────────────────────────────────────
function renderTotalDist() {
  const vals = sessions.map(s=>s.total).filter(v=>v>0&&v<3600);
  const bucketSize = 30; // 30s buckets
  const max = Math.max(...vals);
  const buckets = {};
  for (const v of vals) {
    const b = Math.floor(v/bucketSize)*bucketSize;
    buckets[b] = (buckets[b]||0)+1;
  }
  const keys = Object.keys(buckets).map(Number).sort((a,b)=>a-b);

  new Chart(document.getElementById('chart-total-dist'), {
    type: 'bar',
    data: {
      labels: keys.map(k=>\`\${k}-\${k+bucketSize}s\`),
      datasets: [{
        data: keys.map(k=>buckets[k]),
        backgroundColor: keys.map(k => {
          const mid = k + bucketSize/2;
          if (mid < 120) return 'rgba(0,200,150,0.7)';
          if (mid < 300) return 'rgba(0,229,255,0.7)';
          if (mid < 600) return 'rgba(255,179,71,0.7)';
          return 'rgba(255,77,109,0.7)';
        }),
        borderWidth: 0, borderRadius: 3,
      }]
    },
    options: {
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{color:'#555570',font:{family:'Space Mono',size:9},maxRotation:45},grid:{color:'#1a1a24'}},
        y:{ticks:{color:'#555570',font:{family:'Space Mono',size:10}},grid:{color:'#1a1a24'}}
      }
    }
  });
}

// ── Step median comparison ─────────────────────────────────────────────────────
function renderStepMedian() {
  const trans = stepStats.transitions;
  const labels = [], medians = [], p25s = [], p75s = [];
  for (let i=0;i<stepOrder.length-1;i++) {
    const key = \`\${stepOrder[i]}->\${stepOrder[i+1]}\`;
    const t = trans[key];
    if (t?.stats) {
      labels.push(stepLabels[stepOrder[i]]);
      medians.push(t.stats.median);
      p25s.push(t.stats.p25);
      p75s.push(t.stats.p75);
    }
  }

  new Chart(document.getElementById('chart-step-median'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'p25', data:p25s, backgroundColor:'rgba(0,200,150,0.5)', borderRadius:2, stack:'s' },
        { label:'median-p25', data:medians.map((m,i)=>Math.max(0,m-p25s[i])), backgroundColor:'rgba(0,229,255,0.7)', borderRadius:2, stack:'s' },
        { label:'p75-median', data:p75s.map((p,i)=>Math.max(0,p-medians[i])), backgroundColor:'rgba(255,179,71,0.5)', borderRadius:2, stack:'s' },
      ]
    },
    options: {
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{labels:{color:'#888899',font:{family:'Space Mono',size:10}}}},
      scales:{
        x:{stacked:true,ticks:{color:'#555570',font:{family:'Space Mono',size:9},maxRotation:45},grid:{color:'#1a1a24'}},
        y:{stacked:true,ticks:{color:'#555570',font:{family:'Space Mono',size:10}},grid:{color:'#1a1a24'},title:{display:true,text:'seconds',color:'#555570',font:{family:'Space Mono',size:10}}}
      }
    }
  });
}

// ── Per-step distribution ──────────────────────────────────────────────────────
function buildStepSelector() {
  const trans = stepStats.transitions;
  const sel = document.getElementById('step-selector');
  let first = true;
  for (let i=0;i<stepOrder.length-1;i++) {
    const key = \`\${stepOrder[i]}->\${stepOrder[i+1]}\`;
    if (!trans[key]?.stats) continue;
    const btn = document.createElement('button');
    btn.className = 'step-btn' + (first?' active':'');
    btn.textContent = stepLabels[stepOrder[i]];
    btn.dataset.key = key;
    btn.onclick = function() {
      document.querySelectorAll('.step-btn').forEach(b=>b.classList.remove('active'));
      this.classList.add('active');
      renderStepDist(this.dataset.key);
    };
    sel.appendChild(btn);
    if (first) { renderStepDist(key); first=false; }
  }
}

function renderStepDist(key) {
  const vals = sessions.map(s=>s.durations[key]).filter(v=>v!==undefined&&v<3600);
  const bucketSize = 10;
  const buckets = {};
  for (const v of vals) {
    const b = Math.floor(v/bucketSize)*bucketSize;
    buckets[b] = (buckets[b]||0)+1;
  }
  const keys = Object.keys(buckets).map(Number).sort((a,b)=>a-b);

  if (distChart) distChart.destroy();
  distChart = new Chart(document.getElementById('chart-step-dist'), {
    type: 'bar',
    data: {
      labels: keys.map(k=>\`\${k}s\`),
      datasets: [{
        data: keys.map(k=>buckets[k]),
        backgroundColor:'rgba(0,229,255,0.6)',
        borderColor:'rgba(0,229,255,0.9)',
        borderWidth:1,borderRadius:3,
      }]
    },
    options: {
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{
        title:items=>\`\${items[0].label} – \${items[0].label.replace('s','')*1+bucketSize}s\`,
        label:item=>\`\${item.raw} sessions\`
      }}},
      scales:{
        x:{ticks:{color:'#555570',font:{family:'Space Mono',size:10}},grid:{color:'#1a1a24'}},
        y:{ticks:{color:'#555570',font:{family:'Space Mono',size:10}},grid:{color:'#1a1a24'}}
      }
    }
  });
}

// ── Session table ──────────────────────────────────────────────────────────────
function renderTable() {
  const outcomeFilter = document.getElementById('filter-outcome').value;
  const lastStepFilter = document.getElementById('filter-last-step').value;

  // Populate last step filter
  const lastStepSel = document.getElementById('filter-last-step');
  if (lastStepSel.options.length <= 1) {
    const steps = [...new Set(sessions.map(s=>s.last_step))].sort();
    steps.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = stepLabels[s]||s;
      lastStepSel.appendChild(opt);
    });
  }

  const filtered = sessions.filter(s =>
    (!outcomeFilter || s.outcome === outcomeFilter) &&
    (!lastStepFilter || s.last_step === lastStepFilter)
  );

  const DUR_KEYS = [
    'start->voice-liveness-check',
    'voice-liveness-check->deepfake-detection',
    'deepfake-detection->customerPortrait',
    'customerPortrait->idFront',
    'idFront->idBack',
    'idBack->hologram',
  ];

  document.getElementById('table-body').innerHTML = filtered
    .sort((a,b)=>b.total-a.total)
    .map(s => {
      const oc = s.outcome==='approve'||s.outcome==='finished'?'outcome-approve':s.outcome==='reject'?'outcome-reject':'outcome-unknown';
      return \`<tr>
        <td style="font-size:0.62rem">\${s.session_id.substring(0,24)}...</td>
        <td class="\${oc}">\${s.outcome}</td>
        <td>\${stepLabels[s.last_step]||s.last_step}</td>
        <td>\${s.total||'—'}</td>
        \${DUR_KEYS.map(k=>\`<td>\${s.durations[k]??'—'}</td>\`).join('')}
        <td style="color:var(--reject);font-size:0.65rem">\${s.reason||'—'}</td>
      </tr>\`;
    }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderOutcomes();
renderStepsGrid();
renderTotalDist();
renderStepMedian();
buildStepSelector();
renderTable();
</script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(function main() {
  const sessions = loadSessions();
  if (!sessions.length) {
    console.error('❌ No sessions parsed. Check that LOGS_DIR contains downloaded JSON log files.');
    process.exit(1);
  }

  const stepStats = computeStepStats(sessions);

  console.log('\n📈 Step reach counts:');
  for (const [step, count] of Object.entries(stepStats.reachCounts)) {
    const pct = ((count / stepStats.total) * 100).toFixed(1);
    console.log(`   ${step.padEnd(25)} ${count} (${pct}%)`);
  }

  console.log('\n⏱  Step median durations:');
  for (const [key, t] of Object.entries(stepStats.transitions)) {
    if (t.stats) {
      console.log(`   ${key.padEnd(45)} median=${t.stats.median}s  p75=${t.stats.p75}s  max=${t.stats.max}s  n=${t.stats.count}`);
    }
  }

  writeCsv(sessions);

  const html = generateHtml(sessions, stepStats);
  fs.mkdirSync(path.dirname(OUTPUT_HTML), { recursive: true });
  fs.writeFileSync(OUTPUT_HTML, html);
  console.log(`\n🌐 HTML report written: ${OUTPUT_HTML}`);
  console.log('\n✅ Done.');
})();

// ── Backend data extension ─────────────────────────────────────────────────────
// To enrich sessions with backend data, create a JSON file at:
//   ./data/backend_events.json
// Format: array of objects with matching session_id or user_id:
// [
//   { "session_id": "...", "backend_step": "...", "duration_ms": 1234,
//     "operator_id": "...", "reject_reason": "...", "api_errors": [...] }
// ]
// The analyze-logs.js will merge these into session rows when present.
if (fs.existsSync('./data/backend_events.json')) {
  const backend = JSON.parse(fs.readFileSync('./data/backend_events.json', 'utf-8'));
  const backendMap = {};
  for (const b of backend) backendMap[b.session_id || b.user_id] = b;
  for (const s of sessions) {
    const b = backendMap[s.session_id] || backendMap[s.user_id];
    if (b) Object.assign(s, { backend: b });
  }
  console.log(`🔗 Merged backend data for ${Object.keys(backendMap).length} sessions`);
}
