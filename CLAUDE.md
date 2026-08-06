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
- **Deploy:** push to `development` → **`.github/workflows/pages.yml`** builds a CURATED artifact
  (`index.html` + only the files the page fetches, and only for **active** versions ⇒ ~20 files /
  8 MB) and deploys it. Pages **Source must stay "GitHub Actions"** — the old "deploy from a
  branch" mode published all 6094 tracked files / 188 MB and blew the 10-minute deploy timeout.
  A local push hook sends a Telegram with the Pages link ~2 min later.
  New file the page needs at runtime ⇒ **add it to the workflow's copy list**, or it won't be live.
- **Pages deploy gotchas** (all three cost us an afternoon on 2026-08-06):
  - Concurrency groups are per-REPOSITORY. GitHub's built-in `pages-build-deployment` owns the
    group literally named `pages`, so ours must not be called that (it's `pages-dashboard`) —
    otherwise the two flows queue behind and cancel each other, and the build shows up as
    "cancelled after 15m" having never actually run.
  - Both flows run as long as Source is "deploy from a branch"; switching Source to GitHub
    Actions is what retires the legacy one.
  - **No "Run workflow" button**: `workflow_dispatch` is only offered for workflow files that
    exist on the DEFAULT branch (`main`), and ours lives on `development`. Trigger a deploy with
    a push, or with "Re-run all jobs" on an existing run.
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
- **`data/version_releases.csv` — `version,build,date,active`: the single source of truth for
  which versions are in play.** `active=1` ⇒ the dashboard offers it, `collect-incremental.sh`
  collects it, the Pages workflow publishes it; `active=0` ⇒ archived (data stays in the repo,
  hidden behind the 🗄 archív toggle, loadable locally, NOT published). Switching a version on/off
  = one character here. `build` feeds `ISSUE_VERSIONS="<v> (<build>)"`.
- `data/issues_<v>.csv`, `data/events_<v>.csv` — Crashlytics issues + per-event rows.
- `data/events_<v>.json` — what the dashboard actually loads (built by `build-data.js`, embeds
  every breadcrumb). Committed.
- `data/logs/<event_id>.log` — JSON `{ …, logs_and_breadcrumbs: [...] }` per crash report.
  **LOCAL ONLY — gitignored** (6k+ files / 121 MB). Only `build-data.js` reads them; it refuses to
  rewrite a JSON from fewer logs than it already contains, so a fresh clone can't blank the data.
- `data/developer_tasks.csv` — `id,title,priority,resolution,category,noteFile,attachedSessions`
  (attachedSessions = `|`-joined Firebase session ids).
- `data/investigations.json` — per-FaceKom-id outcome overrides `{ outcome, note, ts }`.
- `data/reviewed_sessions.json`, `data/version_releases.csv`.

### Code map (functions in index.html)
- **Load/render:** `loadData()` (reads `version_releases.csv` FIRST → `applyVersionConfig` fills
  `APP_VERSIONS`/`ARCHIVED_VERSIONS`) + `ensureVersionsLoaded()` (lazy per-version, also pulls that
  version's issue CSV) → `renderAll()`. `rebuildIssueIndex()` re-merges the Issue Types table when a
  version arrives late. Globals: `events`, `gVersionFilter` (a version key or `'all'`),
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
- **SDK message localization:** the SDK's status/error strings come out in the DEVICE language —
  en, de (3.7.1+) and hu (3.8.1+) all appear in the same data — and the placeholders move with the
  grammar (hu drops the colon: `Facekom végzett finished státusszal.`). `canonSdkMsg` folds every
  known variant back to the canonical **English** form and `canonEventLang` applies it to
  `nslocalized_description` + every breadcrumb **at load** (both `ensureVersionsLoaded` paths), so
  the data files stay verbatim and every parser downstream matches English only. The original is
  kept on `log.msgRaw` (timeline hover). **New language / new SDK string ⇒ add a row to
  `SDK_MSG_L10N` (+ its token to `SDK_MSG_L10N_HINT`), never a second pattern in a parser.**

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
- **≈ possibly approve:** a session that reached `twoFactor` and then just stops being reported —
  no `end(…)` of any status AND no `user initiated closing` — is a **telemetry gap, not a drop-off**
  (nothing can fail at 2FA any more). It derives as `approve` (`isPossiblyApprove`) but carries an
  `≈ possibly` chip everywhere, because the verdict is INFERRED, not SDK-reported. The missing close
  breadcrumb is the whole discriminator: users who really quit at 2FA (no SMS) do log it, and they
  stay `aborted` — they have no `end(aborted)` either, since 2FA isn't a video step. Gate every chip
  and counter on `isPossiblyApproveSession(group, fk)` (an `investigations` outcome override retires
  the marker); `normalizeOutcome`'s enum is deliberately unchanged — `≈ Possibly` is a *view* over
  the approve bucket. These lanes stay listed in the Report on purpose: they're the to-verify queue.
  `buildStepFunnel()` buckets outcomes **separately** from `deriveSessionOutcome` — keep both in sync.
- **PROD / TEST / DEV környezet:** három backend —
  `videoid-mobile.e-szigno.hu` (prod), `videoid-mobile-test.e-szigno.hu` (teszt),
  `videoid-mobile-dev.graphi.intra.microsec.hu` (dev, belső háló). Két független jel dönt, és nem
  mindig egyeznek: (1) az `identification_link` **hostja** = az a backend, amin a session
  **ténylegesen futott**; (2) `configuration` (Crashlytics `CONFIGURATION` key) = az **app build**
  (`PROD Release` / `INT Release`). PROD build teszt QR-rel a teszt backendre megy — ezért a host az
  erősebb jel, a build config csak fallback link nélküli reportokra (`envOfEvent`; `*.intra.*` host
  besorolhatatlanul is dev). Session-szint: egy nem-prod report az egész munkamenetet nem-proddá
  teszi, dev > test > prod sorrendben (`envOfGroup`). A globális **Env** szűrő alapból **PROD**
  (`gEnvFilter`), a `prod` bucket = "ami nem bizonyítottan test/dev", hogy a besorolhatatlan reportok
  ne tűnjenek el. Jelenleg csak 3.8.1-ben van nem-prod forgalom (10-ből 3 teszt lane, dev 0).
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
