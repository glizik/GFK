# GFK Roadmap

Status legend: ☐ todo · ◐ in progress · ☑ done · ⏸ paused / blocked

The project has **two stages** that should be developed and reasoned about
separately:

- **Stage 1 — Collection.** Scrape Firebase Crashlytics into a local CSV +
  raw log files. The output is the source of truth for everything downstream.
- **Stage 2 — Analysis.** Read the collected data and produce insights
  (per-user attempts, funnel, durations, drop-offs, abandonment). No
  network calls.

---

## Where we are right now (2026-05-19)

- `main` branch: tuned for **iOS 3.6.1 (2662)**. Working, 2,420 rows
  collected. Frozen — we no longer maintain it.
- Working branch: **`development`** (renamed by Gabor).
- `.env` switched to `ISSUE_VERSIONS=3.7.0 (2753)`.
- `.env` is **tracked** in git (per Gabor).
- iOS 3.7.0 rolled out **2026-05-09**. ~10 days of data sit in Crashlytics
  uncollected.
- `utils/state.ts` deprecated (stub left); a new Firebase-URL-aware time
  state module will replace it.
- iOS source for `SelfServicePresenter` reviewed — see `ai.md` §2.
- **No 3.7.0 code changes yet.** Waiting on one real 3.7.0 log so we can
  ground the data-model changes in observed payload shape rather than
  guesses.

---

## Stage 1 — Collection

### 1.1 Discovery & calibration (do this BEFORE coding)
- ☐ Gabor: share one real 3.7.0 Crashlytics log (manual export is fine).
- ☐ Open the log file and document:
  - exact step/event names emitted by 3.7.0 (vs the iOS enum names
    captured in `ai.md` §2 — should match, confirm).
  - whether `session_id` still has the `_DNE_N_v2` shape and what each
    suffix means in 3.7.0.
  - whether `SelfServiceRuntimeError.sessionBackgrounded` appears in the
    Crashlytics issue list as its own issue, or rolls into existing types.
  - any new Keys-tab entries.
- ☐ Write findings into `ai.md` §"3.7.0 SDK shape" (new section).

### 1.2 Data model (after 1.1)
- ☐ Clear `data/issues.csv` on `development` (3.6.1 data stays on `main`).
- ☐ Extend `IssueRecord` in `utils/csv.ts`:
  - `app_version`           — already present, used for filtering
  - `event_url`             — deep link to the specific event (new — used as
                              primary dedup key, immune to multi-report)
  - `session_id_full`       — `abc..._DNE_2_v2`
  - `session_id_base`       — `abc...`
  - `report_index`          — int from `_DNE_<i>_v2`
  - `user_id_base`          — first 36 chars of `user_id` (canonical user)
  - `user_id_suffix`        — `-<unix_ts>` part, or empty
  - `crash_kind`            — `handleFlow` / `stopAndClear` /
                              `sessionBackgrounded` / `sessionDisconnected` /
                              `sessionFinished` / …
  - `crashlytics_user_id`   — full URL from Crashlytics setUserID (for
                              cross-reference)
- ☐ Dedup: prefer `event_url`. Fallback: `(session_id_full, date, user_id)`.

### 1.3 Collection modes
- ☐ `npm run collect:backfill`
  - lookback = 90 days, clamped to "since 2026-05-09" so we don't waste
    time on the pre-rollout window.
  - on success, records the run + last-seen-event-date in the new state
    module.
- ☐ `npm run collect:incremental`
  - default window: yesterday → now, with a small overlap (e.g. start
    from `last_completed_at - 1h`).
  - if no prior state exists, fall back to backfill mode.
- ☐ Both modes write to the same CSV; dedup by `event_url` makes overlap safe.

### 1.4 New time-state module (replaces `state.ts`)
- ☐ Research Firebase Crashlytics URL conventions:
  - `?time=Nd` (relative)
  - `?time=<startMs>:<endMs>` (absolute, millisecond precision)
  - Time zone handling, inclusive/exclusive endpoints, DST quirks.
- ☐ New module at `utils/timeWindow.ts` (or similar):
  - `buildTimeParam(mode: 'backfill'|'incremental', issueType: string)`
  - `markCompleted(issueType, lastEventTs)` — persists to
    `data/collector-state.json`.
  - `getLastRun(issueType)` — for incremental mode.
- ☐ `git rm utils/state.ts` (Gabor, in his terminal — sandbox can't).

### 1.5 Event-count anomaly check
- ☐ On each issue page, read the "Events" total displayed by Crashlytics
      (rounded above 1K, but exact below).
- ☐ After collecting that issue, compare new + existing rows in the same
      window to the displayed total.
- ☐ Log a clear ⚠ warning if:
  - displayed < 1000 AND collected < displayed (we missed events), OR
  - displayed ≥ 1K AND collected meaningfully below the rounded floor.
- ☐ Save a screenshot of the issue page on warning for audit.

### 1.6 Robustness
- ☐ Per-event retry with backoff on transient locator failures (instead
      of silently writing `unknown`).
- ☐ Persist progress every N events to a temp file so a crashed run can
      resume without losing the last batch.
- ☐ Log-file naming includes `report_index` to avoid collisions when 3.7.0
      sends multiple reports per session.
- ☐ Handle the rare "no ID at all" event explicitly (Gabor's "1 anomaly"
      — record with a synthetic key and a `notes` flag).

---

## Stage 2 — Analysis

### 2.1 Hierarchical reconstruction
- ☐ Group rows: report → session (strip `_DNE_N_v2`) → attempt
      (raw `user_id`) → user (`user_id_base`).
- ☐ Merge `logs_and_breadcrumbs` across reports of the same session in
      chronological order; dedupe identical breadcrumbs.
- ☐ Per-user record keeps `user_id_variants[]` and
      `identification_links[]` so the QR-variant trail is preserved.
- ☐ Canonical session outcome: outcome of the **last** report.

### 2.2 Abandonment & user-centric metrics
- ☐ `is_abandoned` per session: last report shows
      `sessionBackgrounded` OR the user backgrounded without a subsequent
      `end(status:)`.
- ☐ Per-user fields:
  - `attempts_count`              — distinct attempts (raw user_ids)
  - `sessions_count`              — distinct sessions across all attempts
  - `ever_succeeded`              — any session with approve/finished
  - `first_success_attempt_index` — 1, 2, 3… or null
  - `last_step_when_abandoning`   — modal step at abandonment
  - `total_elapsed_first_to_last` — overall time invested
- ☐ Cohort tables:
  - one-shot success vs one-shot fail (never abandoned)
  - persistent (abandoned ≥ 1 session, eventually succeeded)
  - lost (only abandoned, never succeeded)
- ☐ "Point of no return" view: for each step, P(eventually succeed |
      last abandonment was at this step).

### 2.3 SDK step names
- ☐ Confirm 3.7.0 step names from the real log (likely unchanged from
      3.6.1 per `ai.md` §2 table).
- ☐ Move `STEP_ORDER` + `STEP_LABELS` to `config/steps.json`.

### 2.4 Reporting
- ☐ Keep funnel + median/p75/max transitions view.
- ☐ Add a "Users" tab to `flow_analysis.html` covering 2.2.
- ☐ Add `data/users.csv` export — one row per user for product slicing.
- ☐ (Stretch) compare 3.7.0 to 3.6.1 baseline (load both CSVs).

---

## Cross-cutting / housekeeping

- ☑ Branch rename `feature/3.7.0` → `development` (Gabor, locally).
- ☑ Add `.DS_Store` + `venv` to `.gitignore`.
- ☑ `utils/state.ts` → deprecation stub (Gabor to `git rm` it).
- ☐ Commit `ai.md`, `roadmap.md`, `.env`, `.gitignore`, `utils/state.ts`
      stub on `development`.
- ☐ Decide whether to archive `data/issues.csv` (3.6.1) under
      `data/archive/` on `development`, or just leave it untouched on
      `main` for retrieval via `git checkout main -- data/issues.csv`.
- ☐ Consider committing a sanitised sample 3.7.0 log as an analyzer
      test fixture.

---

## Future / nice-to-have

- Live dashboard that auto-refreshes off the CSV.
- Slack/email digest when abandonment spikes on a particular step.
- Cross-version regression alerts (step X got slower in 3.7.0 vs 3.6.1).
- Pull backend events automatically rather than via
  `data/backend_events.json`.
- Cowork scheduled task: run `collect:incremental` + `analyze` every
  morning, push a one-page diff.

---

## Open questions for Gabor

1. **3.7.0 sample log** — please share one real Crashlytics export for a
   3.7.0 event so we can confirm payload shape before coding.
2. **Issue-type names in 3.7.0** — does the Crashlytics issue list now show
   a new `FaceKom sessionBackgrounded …` issue, or does it roll into one of
   the existing buckets?
3. **CSV migration** — OK to clear `data/issues.csv` on `development` (the
   3.6.1 data stays on `main`)?
