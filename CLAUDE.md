# CLAUDE.md — GFK dashboard

Orientation for working in this repo. Deep data-model notes live in **`ai.md`**; the plan in
**`roadmap.md`**; per-issue Hungarian notes in **`data/notes/Task-*.md`** (the owner edits these —
don't overwrite without an explicit request).

## What this is
A single-page HTML dashboard for analysing **FaceKom iOS identity-verification sessions** pulled from
Firebase Crashlytics. The goal: explain **why verification sessions abort/fail**, with a FaceKom
session id + timestamp the owner (no prod access) can hand to his boss to verify in production.

## Run / deploy
- **Local server:** `node server.js` → http://localhost:3737 (serves `data/dashboard.html` at `/`,
  static `data/`, plus `/api/save-note|discover|collect|save-investigations|save-reviewed`).
  `LOGS_DIR = data/logs`. If `:3737` is stuck: `lsof -ti tcp:3737 | xargs kill -9`.
- **Deploy:** GitHub **Pages serves from the `development` branch**. Commit **and push** to
  `development` to publish. A local push hook sends a Telegram with the Pages link ~2 min later.
- **`cp index.html data/dashboard.html` before every `index.html` commit, and commit BOTH files** —
  the server/Pages serve `data/dashboard.html`, so an un-synced edit won't show up.
- **Collect data:**
  `HEADLESS=true ISSUE_VERSIONS="3.7.1 (2759)" ISSUES_CSV=./data/issues_3.7.1.csv EVENTS_CSV=./data/events_3.7.1.csv npm run discover`
  then `npm run collect`.

## Verify UI changes (do this before committing)
Headless Playwright against the running server, capturing page errors:
```
NODE_PATH=/Users/lizik.gabor/DEV/GFK/node_modules node <script>.js   # page.goto :3737, page.on('pageerror', …)
```
Wait for `#reportTable table.report-table` (or the gantt) to render before asserting. Data loads
async and top-level `let` vars (e.g. `events`) are NOT on `window` — wait on the DOM, not `window.events`.

## Architecture
Everything user-facing is **`index.html`** (~3000 lines: CSS + markup + one big script). `server.js`
is a thin static+API server. Data is CSV/JSON/log files under `data/`.

Page sections (top→bottom): global filter bar → **Report** → Day Timeline (gantt) → Stats/Issues/
Analytics/Step-funnel → Events grid → Dev tasks.

### Key data files
- `data/issues_3.7.x.csv`, `data/events_3.7.x.csv` — Crashlytics issues + per-event rows.
- `data/logs/<event_id>.log` — JSON `{ …, logs_and_breadcrumbs: [...] }` per crash report.
- `data/developer_tasks.csv` — `id,title,priority,resolution,category,noteFile,attachedSessions`
  (attachedSessions = `|`-joined Firebase session ids).
- `data/investigations.json` — per-FaceKom-id outcome overrides `{ outcome, note, ts }`.
- `data/reviewed_sessions.json`, `data/version_releases.csv`.

### Code map (functions in index.html)
- **Load/render:** `loadData()` + `ensureVersionsLoaded()` (lazy per-version; default 3.7.1) →
  `renderAll()` (calls every render fn). Globals: `events`, `gVersionFilter` (`'3.7.1'|'3.7.0'|'all'`),
  `gOutcomeFilter`, `gFkFilter`, `investigations`, `devTasks`, `reviewedSessions`.
- **Report view:** `buildReportSessions()` (group all version-scoped events into FaceKom-session
  lanes, across all days) → `renderReport()`. Abort engine: **`deriveAbortExits(group)`** +
  `mergeGroupLogs(group)`; step helpers `stepFromMsg`, `deriveStuckStep`, `deriveLastStepSmart`;
  `ticketOf` (task_t9 → `Task-009`), `toggleReport`, `reportFilterFk`.
- **Day Timeline (gantt):** `buildGanttModel()` → `renderGantt` / `renderGanttTimeline` /
  `renderGanttList`; `buildTimeMap`. Groups by Firebase session, lanes by FaceKom session.
- **Event card:** `renderSessionCard(group, idx)` (reports sorted by end-time, latest/most-complete
  selected), `openGanttCard(sessId)`; `getAbortCause(group)`, `deriveSessionOutcome`, `deriveLastStep`.
- **Dev tasks:** `loadDevTasksFromCSV()`, `renderDevTasks()`, `getTasksForSession(sessId)`.
- **Util:** `esc`/`escAttr`, `fmtTs`, `parseTs`, `gStartTs`/`gEndTs`, `gDayKeyOf`, `normalizeOutcome`,
  `facekomSessionId(ev)`, `fkBase(fk)` (= identity).

## Domain glossary
- **Firebase session** = `session_id_base` (32-char hex). **FaceKom session** = the videoID token
  `<uuid4>[-<unix_ts>]`. **The `-<ts>` suffix is PART of the id** — `<uuid>-<ts>` ≠ `<uuid>` ≠
  `<uuid>-<other ts>` (separate identifications). `fkBase()` is identity; never strip the suffix.
- **Hierarchy:** user → attempt (FaceKom session) → Firebase session → crash report(s). One FaceKom
  session can span several Firebase sessions, even across days. One Firebase session's breadcrumbs can
  hold several retry/close cycles — **merge all its crash reports** to see the full timeline.
- **Verification flow:** voice-liveness-check → deepfake-detection → customerPortrait → idFront →
  idBack → hologram → id-back-video → twoFactor → end(finished)→approve (varies by doc type).
- **Outcome:** approve / aborted / failed / reject / other (`deriveSessionOutcome`); per-FaceKom-id
  override via `investigations`. Reject/fail reason is in `end(status:"failed", … reason = "X")`.
- **What counts as an ABORT:** the SDK fires `nextStep: end(status:"aborted")` **only when the user
  leaves a VIDEO step** (voice-liveness, deepfake, customerPortrait, id-back-video, hologram).
  Backgrounding a **non-video** step — e.g. 2-factor to read the SMS (`did enter background … ,
  isVideoStep:false`) — is NORMAL, the user returns, **not** an abort. Don't count every close.
- **Main finding:** ~70% approve; the real failures cluster at the live video steps (deepfake,
  voice-liveness) where the detection stalls and users wait 1–4 min, retry, then quit. See
  `data/notes/Task-009.md` and `non_approved_report.md`.

## Working conventions (owner = "G", Hungarian; talks via Telegram)
- Reply in **Hungarian** on Hungarian threads. Ack first, then work; report progress, don't go silent.
- After a task: **commit and push** without asking (G checks Pages). Split `git add` and
  `git commit` into separate calls. End commit messages with the Co-Authored-By trailer.
- **Don't send dashboard screenshots** — G verifies the deployed page himself. Still verify locally.
- Don't write the owner's `data/notes/*.md` without an explicit request (his source of truth).
