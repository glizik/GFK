#!/usr/bin/env node
/**
 * Hologram-problem rooms (FaceKom sessions), A/B/C classification.
 *
 * Reads the pre-built data/events_<version>.json files, groups every event by FaceKom session
 * (the videoID token — the `-<unix_ts>` suffix is PART of the id), merges all crash reports of a
 * session, and classifies what happened at the hologram step:
 *
 *   A) `nextStep: hologram` arrived, but the recording screen was never reached
 *      (no HologramViewController → no WebRTC) — the user leaves on the info screen.
 *   B) HologramViewController + `WebRTC started`, but `nextStep: custom(type:"id-back-video")`
 *      never arrives — the user waits ~40-50 s on the recording screen, then quits.
 *   C) `incomplete-hologram-video` — the server rejects the recorded hologram video.
 *
 * Usage: node utils/hologram-report.js [--days N] [--md <file>]
 */
const fs = require('fs');
const path = require('path');

const VERSIONS = ['3.7.0', '3.7.1', '3.8.0', '3.8.1'];
const DATA = path.join(__dirname, '..', 'data');

const args = process.argv.slice(2);
const argVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DAYS = argVal('--days') ? Number(argVal('--days')) : null;
const MD_OUT = argVal('--md');

// ── same identity rules as index.html ────────────────────────────────────────
function facekomSessionId(ev) {
  if (ev.user_id_base) return ev.user_id_suffix ? `${ev.user_id_base}-${ev.user_id_suffix}` : ev.user_id_base;
  const m = (ev.identification_link || '').match(/\/identification\/([^/?#\s]+)/);
  return m ? m[1] : '';
}
function mergeGroupLogs(group) {
  const seen = new Set(), out = [];
  for (const ev of group) for (const l of (ev.logs || [])) {
    const k = l.rawTs + '|' + l.msg;
    if (seen.has(k)) continue;
    seen.add(k); out.push(l);
  }
  return out.sort((a, b) => a.rawTs - b.rawTs);
}
function normalizeOutcome(o) {
  if (o === 'approve' || o === 'finished') return 'approve';
  if (o === 'reject') return 'reject';
  if (o === 'aborted' || o === 'user closed') return 'aborted';
  if (o === 'failed') return 'failed';
  return 'other';
}
function deriveOutcome(ev) {
  const csvVal = (ev.outcome || '').trim();
  if (csvVal && csvVal !== '—') return csvVal;
  const desc = (ev.nslocalized_description || '').trim();
  const st = desc.match(/:\s*(finished|aborted|expired|failed)\b/i);
  if (st) {
    const s = st[1].toLowerCase();
    if (s === 'finished') return 'finished';
    if (s === 'aborted') return 'aborted';
    return 'failed';
  }
  let outcome = '';
  for (const log of (ev.logs || [])) {
    const msg = log.msg || '';
    if (msg.includes('finished with type:')) outcome = msg.split('finished with type:')[1].trim();
    else if (!outcome && msg.includes('finished with state: finished')) outcome = 'finished';
    else if (!outcome && msg.includes('finished with state: aborted')) outcome = 'aborted';
    else if (!outcome && msg.includes('finished with state: failed')) outcome = 'failed';
    else if (!outcome && msg.includes('user initiated closing')) outcome = 'user closed';
  }
  return outcome || '—';
}
function sessionOutcome(group) {
  const os = group.map(ev => normalizeOutcome(deriveOutcome(ev)));
  if (os.includes('approve')) return 'approve';
  if (os.includes('failed')) return 'failed';
  if (os.includes('aborted')) return 'aborted';
  return os.find(o => o !== 'other') || 'other';
}

const fmtTs = (ms) => ms ? new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Budapest' }) : '—';

// ── load + group ─────────────────────────────────────────────────────────────
// Two levels, mirroring buildReportSessions(): events are grouped by Firebase session, and the
// FaceKom room id is resolved from ANY report of that Firebase session (some reports carry no
// user_id). A room (fk lane) can span several Firebase sessions — each is one hologram attempt.
const fbSessions = new Map();   // session_id_base → { sid, events[], version }
for (const v of VERSIONS) {
  const file = path.join(DATA, `events_${v}.json`);
  if (!fs.existsSync(file)) continue;
  for (const ev of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    if (!ev.logs || !ev.logs.length) continue;
    const sid = ev.session_id_base || ev.event_id || '?';
    if (!fbSessions.has(sid)) fbSessions.set(sid, { sid, events: [], version: v });
    fbSessions.get(sid).events.push(ev);
  }
}
const rooms = new Map();        // fk lane key → { fk, fbOnly, attempts[], events[], versions:Set }
for (const fb of fbSessions.values()) {
  const fk = fb.events.map(facekomSessionId).find(Boolean) || '';
  const key = fk ? fk : 'fb:' + fb.sid;
  if (!rooms.has(key)) rooms.set(key, { fk: key, fbOnly: !fk, attempts: [], events: [], versions: new Set() });
  const r = rooms.get(key);
  r.attempts.push(fb);
  r.events.push(...fb.events);
  r.versions.add(fb.version);
}

// ── classify ─────────────────────────────────────────────────────────────────
const RE_HOLOGRAM_STEP = /nextStep:\s*hologram\(/;
const RE_ID_BACK_VIDEO = /nextStep:\s*custom\(type:\s*"id-back-video"/;
const RE_NEXT_STEP     = /FaceKom nextStep:/;
const RE_INCOMPLETE     = /incomplete-hologram-video/;
// The hologram is "accepted" when the server sends the FOLLOWING step. Which step that is depends on
// the document type: usually `custom(type:"id-back-video")`, but ~7% of flows go straight to
// twoFactor — so an id-back-video-only check would flag those as stalled. `end(status:"aborted")`
// is the SDK's own reaction to the user leaving, not a server answer, so it does not count.
const isServerAdvance = (msg) =>
  RE_NEXT_STEP.test(msg) && !RE_HOLOGRAM_STEP.test(msg) && !/end\(status:\s*"aborted"/.test(msg);
const RE_EXIT = /user initiated closing|did enter background at step|nextStep:\s*end\(|finished with state|SelfService stopped/;

const episodes = [];
let reachedHologram = 0;
const reachedByVersion = new Map();

for (const room of rooms.values()) {
  const outcome = sessionOutcome(room.events);
  let roomReached = false, roomVersion = null;

  // One Firebase session's breadcrumbs can hold SEVERAL retry/close cycles, so every
  // `nextStep: hologram` opens its own episode, closed by the next hologram step or the `end(…)`
  // of that cycle. Without this window a later successful retry would mask the earlier stall.
  for (const fb of room.attempts) {
    const logs = mergeGroupLogs(fb.events);
    const starts = logs.reduce((acc, l, i) => (RE_HOLOGRAM_STEP.test(l.msg || '') && acc.push(i), acc), []);
    if (!starts.length) continue;                  // this attempt never got to the hologram step
    roomReached = true;
    roomVersion = roomVersion || fb.version;

    starts.forEach((iHolo, n) => {
      const hardEnd = n + 1 < starts.length ? starts[n + 1] : logs.length;
      let stop = hardEnd;
      for (let i = iHolo + 1; i < hardEnd; i++) {
        if (/nextStep:\s*end\(/.test(logs[i].msg || '')) { stop = Math.min(hardEnd, i + 6); break; }
      }
      const win = logs.slice(iHolo, stop);

      const iHoloView   = win.findIndex(l => l.type === 'screen' && /HologramViewController/.test(l.msg || ''));
      const webrtc      = win.some(l => /WebRTC started/.test(l.msg || ''));
      const iIdBack     = win.findIndex(l => RE_ID_BACK_VIDEO.test(l.msg || ''));
      const iIncomplete = win.findIndex(l => RE_INCOMPLETE.test(l.msg || ''));
      const advanced    = win.some(l => isServerAdvance(l.msg || ''));

      let type = null;
      if (iIncomplete >= 0) type = 'C';                      // server rejected the recorded video
      else if (iHoloView < 0 && !webrtc) type = 'A';         // recording screen never reached
      else if (!advanced) type = 'B';                        // recorded, but no answer from the server
      if (!type) return;                                     // hologram went through fine

      // Two clocks: the whole hologram step (what the user experiences, and how the FaceKom
      // ticket frames it) and the dwell on the recording screen itself.
      let iAnchor = 0;
      for (let i = (iIncomplete >= 0 ? iIncomplete : win.length) - 1; i > 0; i--) {
        if (win[i].type === 'screen' && /HologramViewController/.test(win[i].msg || '')) { iAnchor = i; break; }
      }
      const exitFrom = (from) => win.slice(from + 1).find(l => RE_EXIT.test(l.msg || '')) || win[win.length - 1];
      const stepS = Math.round((exitFrom(0).rawTs - win[0].rawTs) / 1000);
      const recS  = iAnchor > 0 ? Math.round((exitFrom(iAnchor).rawTs - win[iAnchor].rawTs) / 1000) : null;

      // For C: how long between the id-back-video step and the failure.
      const cGapS = (type === 'C' && iIdBack >= 0 && iIncomplete > iIdBack)
        ? Math.round((win[iIncomplete].rawTs - win[iIdBack].rawTs) / 1000) : null;

      episodes.push({
        fk: room.fk, fbOnly: room.fbOnly, sid: fb.sid, version: fb.version,
        holoTs: win[0].rawTs, outcome, type, stepS, recS, cGapS, webrtc,
      });
    });
  }
  if (roomReached) {
    reachedHologram++;
    reachedByVersion.set(roomVersion, (reachedByVersion.get(roomVersion) || 0) + 1);
  }
}

// One row per room per problem type (a room that stalls twice is still one room for FaceKom);
// keep the latest episode and count the repeats.
const byRoomType = new Map();
for (const e of episodes) {
  const k = e.fk + '|' + e.type;
  const prev = byRoomType.get(k);
  if (!prev) byRoomType.set(k, { ...e, attempts: 1 });
  else { prev.attempts++; if (e.holoTs > prev.holoTs) Object.assign(prev, e, { attempts: prev.attempts }); }
}
const rows = [...byRoomType.values()].sort((a, b) => b.holoTs - a.holoTs);
const cutoff = DAYS ? Date.now() - DAYS * 86400000 : null;
const shown = cutoff ? rows.filter(r => r.holoTs >= cutoff) : rows;

// ── output ───────────────────────────────────────────────────────────────────
const count = (t, list) => list.filter(r => r.type === t).length;
const lines = [];
const P = (s = '') => lines.push(s);

P('# Hologram-problémás szobák (FaceKom session ID-k)');
P();
P(`**Forrás:** FaceKom iOS Crashlytics, ${VERSIONS.join(' + ')} — generálva: ${fmtTs(Date.now())}`);
if (DAYS) P(`**Időablak:** utolsó ${DAYS} nap`);
P();
P(`Hologram lépésig eljutott szoba: **${reachedHologram}** · problémás: **${rows.length}** ` +
  `(A: ${count('A', rows)} · B: ${count('B', rows)} · C: ${count('C', rows)})`);
P();
P('- **A)** `nextStep: hologram` megjön, de a felvételi képernyő (HologramViewController) sosem jön fel → **nincs WebRTC**, a user az info-képernyőn lép ki.');
P('- **B)** Felvételi képernyő + WebRTC elindul, de az `id-back-video` lépés **sosem érkezik meg** → a user ~40-50 mp várakozás után kilép.');
P('- **C)** `incomplete-hologram-video` — a szerver hiányosnak ítéli a felvett hologram-videót.');
P();
P('| Verzió | Hologramig eljutott szoba | A | B | C |');
P('|---|---|---|---|---|');
for (const v of VERSIONS) {
  const list = rows.filter(r => r.version === v);
  if (!reachedByVersion.get(v)) continue;
  P(`| ${v} | ${reachedByVersion.get(v)} | ${count('A', list)} | ${count('B', list)} | ${count('C', list)} |`);
}
P();

const table = (t, title, extraCol) => {
  const list = shown.filter(r => r.type === t);
  P(`## ${title} — ${list.length} szoba`);
  P();
  if (!list.length) { P('_Nincs ilyen eset ebben az időablakban._'); P(); return; }
  P(`| # | FaceKom session ID | Hologram lépés ideje | Verzió | Kimenet | ${extraCol} |`);
  P('|---|---|---|---|---|---|');
  list.forEach((r, i) => {
    const extra = t === 'C'
      ? (r.cGapS != null ? `${r.cGapS} mp` : '—')
      : `${r.stepS} mp${r.recS != null ? ` _(ebből felvételi képernyőn ${r.recS} mp)_` : ''}`;
    const rep = r.attempts > 1 ? ` _(${r.attempts}×)_` : '';
    P(`| ${i + 1} | \`${r.fk}\`${rep} | ${fmtTs(r.holoTs)} | ${r.version} | ${r.outcome} | ${extra} |`);
  });
  P();
};

table('A', 'A) Nincs WebRTC — a hologram el sem indul', 'Kilépésig eltelt idő');
table('B', 'B) WebRTC megy, de nem jön az id-back-video', 'Várakozás a felvételi képernyőn');
table('C', 'C) incomplete-hologram-video', 'Késleltetés');

const out = lines.join('\n');
if (MD_OUT) { fs.writeFileSync(MD_OUT, out + '\n'); console.error(`written: ${MD_OUT}`); }
else console.log(out);
