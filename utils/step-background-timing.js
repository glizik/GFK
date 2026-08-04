// When does the app go to BACKGROUND during a step? Histogram of seconds since the step's screen
// appeared, per step type. A tight spike = a device/app timer, not user impatience.
//
// Result (2026-08-04, all versions): the card-facing steps spike hard at 26-27 s —
// hologram 26/36, id-back-video 24/32, id-front 8/19, and nothing past 28 s — while the
// face-facing steps (deepfake, customer-portrait, voice-liveness) show no spike at all
// (flat 32-62 s). 11 different iPhone models, so not a device fault. Since successful hologram
// detection needs a median of 26 s (p90 31 s), the ~27 s timer and the server answer are in a
// race: the B-class dead rooms are the ones the timer wins.
//
// Leading hypothesis: display auto-lock. On card steps the user looks at the ID, not the screen,
// so Face ID attention-awareness does not hold the display awake; it locks, the app is
// backgrounded, and the SDK aborts the video step. Fix on our side: isIdleTimerDisabled = true
// for the duration of a video step.
const fs = require('fs');
const merge = evs => { const s = new Set(), o = []; for (const e of evs) for (const l of (e.logs || [])) { const k = l.rawTs + '|' + l.msg; if (!s.has(k)) { s.add(k); o.push(l); } } return o.sort((a, b) => a.rawTs - b.rawTs); };
const fbs = new Map();
for (const v of ['3.7.0', '3.7.1', '3.8.0', '3.8.1']) for (const ev of JSON.parse(fs.readFileSync('data/events_' + v + '.json'))) {
  if (!ev.logs || !ev.logs.length) continue;
  const sid = ev.session_id_base || ev.event_id;
  if (!fbs.has(sid)) fbs.set(sid, { sid, events: [], version: v });
  fbs.get(sid).events.push(ev);
}

// For every "did enter background at step: X", how long since the last screen change (≈ last time
// the user touched the UI) and since the last WebRTC start?
const rows = [];
for (const fb of fbs.values()) {
  const logs = merge(fb.events);
  for (let i = 0; i < logs.length; i++) {
    const m = logs[i].msg || '';
    const mm = m.match(/did enter background at step: ([a-zA-Z0-9-]+), isVideoStep: (\w+)/);
    if (!mm) continue;
    let lastScreen = null, lastRTC = null;
    for (let j = i - 1; j >= 0; j--) {
      if (!lastScreen && logs[j].type === 'screen') lastScreen = logs[j];
      if (!lastRTC && /WebRTC started/.test(logs[j].msg || '')) lastRTC = logs[j];
      if (lastScreen && lastRTC) break;
    }
    rows.push({
      step: mm[1], isVideo: mm[2] === 'true',
      sinceScreen: lastScreen ? Math.round((logs[i].rawTs - lastScreen.rawTs) / 1000) : null,
      sinceRTC: lastRTC ? Math.round((logs[i].rawTs - lastRTC.rawTs) / 1000) : null,
      screen: lastScreen ? (lastScreen.msg || '') : '?',
    });
  }
}

const hist = (vals, label, max = 70) => {
  const m = new Map();
  vals.filter(v => v != null && v >= 0 && v <= max).forEach(v => m.set(v, (m.get(v) || 0) + 1));
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`  ${label}: n=${vals.filter(v => v != null).length}, leggyakoribb másodpercek:`,
    top.map(([s, n]) => `${s}s×${n}`).join('  '));
};

console.log('=== background events per step ===');
const byStep = new Map();
for (const r of rows) { if (!byStep.has(r.step)) byStep.set(r.step, []); byStep.get(r.step).push(r); }
[...byStep.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([step, l]) => {
  console.log(`\n-- ${step} (video: ${l[0].isVideo}) — ${l.length} db`);
  hist(l.map(r => r.sinceScreen), 'képernyőváltás óta');
  if (l[0].isVideo) hist(l.map(r => r.sinceRTC), 'WebRTC start óta  ');
});

console.log('\n=== all VIDEO steps pooled: seconds since the recording screen appeared ===');
const vid = rows.filter(r => r.isVideo && r.sinceScreen != null && r.sinceScreen <= 90);
const buckets = new Map();
for (const r of vid) { const b = Math.floor(r.sinceScreen / 5) * 5; buckets.set(b, (buckets.get(b) || 0) + 1); }
[...buckets.entries()].sort((a, b) => a[0] - b[0]).forEach(([b, n]) =>
  console.log(`  ${String(b).padStart(2)}-${String(b + 4).padStart(2)}s ${'█'.repeat(Math.ceil(n / 2))} ${n}`));

console.log('\n=== exact-second spike, video steps, 20-35s ===');
const spike = new Map();
for (const r of vid) if (r.sinceScreen >= 20 && r.sinceScreen <= 35) spike.set(r.sinceScreen, (spike.get(r.sinceScreen) || 0) + 1);
[...spike.entries()].sort((a, b) => a[0] - b[0]).forEach(([s, n]) => console.log(`  ${s}s ${'▌'.repeat(n)} ${n}`));
