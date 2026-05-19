# GFK — AI Working Notes

Running context for the AI assistant (Claude in Cowork) working on the GFK
project. Updated whenever there is meaningful progress.

---

## 1. Project at a glance

- **Name:** GFK — "G FaceKom" (G = Gabor)
- **Path:** `/Users/lizik.gabor/DEV/GFK`
- **VCS:** git (`origin/main` + working branch `development`)
- **Type:** Playwright (TypeScript) scraper + Node.js (JavaScript) analyzer
- **Purpose:**
  1. **Collect** non-fatal FaceKom issues from Firebase Crashlytics into a
     local CSV + per-event JSON log files.
  2. **Analyze** the collected data to understand the FaceKom authentication
     flow: per-user attempts, funnel, durations, drop-offs, abandonment.

Two stages, kept separate:

| Stage | Entry point | Output |
|---|---|---|
| Collect | `tests/collect.spec.ts` via `npm run collect` | `data/issues.csv`, `data/logs/*.log`, time-window state |
| Analyze | `utils/analyze-logs.js` via `npm run analyze` | `data/step_timings.csv`, `data/flow_analysis.html` |

---

## 2. iOS app context

- iOS app: `hu.microsec.eszigno.mobile` (Firebase project
  `webszigno-dev-1532086359290`).
- The FaceKom flow asks the user to authenticate themselves on video.
- Users start a flow by scanning a QR code which encodes a base URL +
  identification UUID. The QR can be re-scanned to retry, subject to a hard
  limit that depends on which steps were reached.
- During **video** steps the connection breaks if the user backgrounds the
  app — the SDK does NOT resume mid-video. After the first video step
  finishes, the session can be resumed from the next step on a fresh QR scan.
- **iOS 3.6.1 (2662)** — old version. Frozen. Last collected up to 2026-03-29
  on `main`. We don't care about it anymore.
- **iOS 3.7.0 (2753), rolled out 2026-05-09** — new SDK, more edge cases
  handled, and the app now emits **multiple Crashlytics non-fatal reports
  per session**. Going forward, GFK targets this version. ~10 days of data
  sit in Crashlytics waiting to be collected.

### iOS source — what each Crashlytics record means

Gabor shared `SelfServicePresenter.swift` (the controller that owns the
flow). Mapping the Swift code to the Crashlytics issue types we see:

| Swift call | Crashlytics issue type (observed in CSV / expected) |
|---|---|
| `record(error: NSError(domain: "FaceKom handleFlow", code: 0))` in `handleFlow(closeType:)` | `FaceKom handleFlow (0)` — fires after every flow that completes (approve / reject). |
| `record(error: NSError(domain: "FaceKom stopAndClear", code: 0))` in `stopAndClear()` | `FaceKom stopAndClear (0)` — user closed mid-video step. |
| `record(error: SelfServiceRuntimeError.sessionBackgrounded(isVideoStep, currentStep))` in `didEnterBackground()` | **New in 3.7.0** — fires every time the app goes to background mid-flow. **This is the source of "multiple reports per session".** |
| `record(error: SelfServiceRuntimeError.sessionDisconnected(reason))` in `disconnectSelfService` | `FaceKom disconnected (0)` (current name). |
| `record(error: SelfServiceRuntimeError.sessionFinished(state))` in `reportAndShowFinish` | Fires at every finish (`finished` / `aborted` / `expired` / `failed`) regardless of `handleFlow` (which only fires when the user dismisses the finish screen). |
| `setCustomValue(status, forKey: "STATUS")` | The `STATUS` Key on the event (`finished` / `aborted` / `expired` / `failed`). |
| `setUserID(flowHandler.url?.absoluteString)` | The Crashlytics user ID = **full QR scan URL**, e.g. `https://videoid-mobile.e-szigno.hu/identification/<uuid>[-<extended>]`. |

### SDK step names (from `MicrosecStep` + `FKSelfService.Step`)

| MicrosecStep rawValue | Swift case name | Logged as in Crashlytics |
|---|---|---|
| `voice-liveness-check` | `voiceLivenessCheck` | `nextStep: custom(type: "voice-liveness-check", …)` |
| `deepfake-detection` | `deepFake` | `nextStep: custom(type: "deepfake-detection", …)` |
| `customer-portrait` | `customerPortrait` | `nextStep: customerPortrait(…)` |
| `id-front` | `idFront` | `nextStep: idFront(…)` |
| `id-back` | `idBack` | `nextStep: idBack(…)` |
| `hologram` | `hologram` | `nextStep: hologram(…)` |
| `id-back-video` | `idBackVideo` | `nextStep: custom(type: "id-back-video", …)` |
| `2-factor` | `secondFactor` | `nextStep: twoFactor(…)` |
| `end` | `end` | `nextStep: end(status: "<finished/…>", …)` |

This matches the analyzer's current `STEP_ORDER`. **3.7.0 likely keeps the
same names** since the SDK enum hasn't changed, but we'll confirm from a real
3.7.0 log before assuming.

### Re-entry / resume rules
- Voice-liveness-check, deepfake-detection, customer-portrait, id-back-video,
  hologram → **video steps**. Backgrounding aborts. User must rescan QR.
- id-front, id-back, twoFactor, end → **non-video steps**. Backgrounding
  doesn't necessarily kill the session.
- `isValidEntryStep` (resume entry points): `voiceLivenessCheck`, `idFront`,
  `idBack`, `hologram`, `idBackVideo`, `secondFactor`, `end`. So after the
  first video step is complete, the user can resume from `idFront` onward.

---

## 3. The right way to think about the data

The crucial reframe (after analysing the 2,420 3.6.1 rows AND reading the
Swift source):

> **One Crashlytics event ≠ one user.**
> The hierarchy is **user → attempt → session → report.**

| Level | Identifier | Notes |
|---|---|---|
| **User** | `user_id_base` (first 36 chars of `user_id`) | The physical person. **Variants** of the QR for the same person (extended UUID `<base>-<unix_ts>`) all belong here. We preserve every variant seen — see §4. |
| **Attempt** | `user_id` (`base_uuid` or `base_uuid-<unix_ts>`) | One QR scan / one issued identification link. The `-<unix_ts>` suffix marks a "modified" QR. |
| **Session** | log JSON `session_id` with `_DNE_N_v2` suffix stripped | The Firebase Analytics session inside the iOS app. |
| **Report** | full `session_id` (with `_DNE_N_v2`) | A single Crashlytics non-fatal report = one row in `issues.csv`. 3.7.0 emits multiple per session (every `didEnterBackground` fires one). |

### Why this matters

- **User-centric success** is what we care about. In 3.6.1 data: 1,278 users
  with real IDs ran 1,877 attempts; 1,193 (93 %) eventually got approved.
- "Abandoned" is **not** a session timeout. It's a property of a session
  (the user backgrounded mid-flow). Same user can have several abandoned
  sessions and still end up a successful user. Interesting questions:
  - Of users who abandoned at least once, how many ever succeeded?
  - At which step do they typically abandon?
  - Which step is the "point of no return" — once a user abandons after
    that step, they almost never succeed?

---

## 4. Data-model clarifications (per Gabor 2026-05-19)

1. **Don't lose UUID variant info when canonicalising.**
   When we merge `<uuid>` and `<uuid>-<unix_ts>` rows into one user, the
   user-level record keeps an **array of all variants observed** — including
   the full identification_link URLs — so we can still trace which QR scan
   produced which event. Implementation: per-user record has fields
   `user_id_variants: string[]` and `identification_links: string[]`.

2. **`user_id = "not available"` is NOT an anomaly.**
   Those are users who declined analytics. They still produce Crashlytics
   events (with `not available` as the User ID), we just don't get per-event
   identity. They are legitimate distinct events, not duplicates. The dedup
   key uses second-precision timestamps so they don't collide in practice.
   - The **real** anomaly is the (≈1) event with **no ID at all** — neither
     "not available" nor a UUID. Worth handling explicitly.

3. **Crashlytics event-count display.**
   Firebase rounds the page count to `1K`, `2K`, etc. above 1,000, so we
   can't expect an exact match. The sanity check counts up to 1,000 exactly
   and warns if our count is meaningfully below the displayed number.

4. **CSV strategy.**
   Clear `data/issues.csv` on `development` (3.6.1 stays on `main`). Add a
   `app_version` column (already present) so future versions can append to
   the same file and we can filter by version.

---

## 5. Dataset snapshot — 3.6.1 (frozen, for reference)

Analysed on 2026-05-19, source `data/issues.csv` (2,420 rows) — kept on
`main` for reference comparison.

| Slice | Count |
|---|---|
| Total rows | 2,420 |
| Rows with real user_id | 1,877 (77.6 %) |
| Rows with `user_id = "not available"` (analytics opt-out) | 543 (22.4 %) |
| Unique `user_id` strings | 1,278 |
| Unique `base_uuid` (canonicalised) | 1,095 |
| Users seen with both base and extended UUID variants | 129 |
| Date range collected | 2026-02-05 → 2026-03-29 (collector paused after that) |

### Per-user retry distribution (canonical base_uuid)
```
1 attempt   681 users
2           236
3            90
4            47
5            22
6             4
7             6
8             4
9             2
10            1
12            1
14            1   ← top retrier
```

### Per-user outcomes (close_type / status union)
```
ever_approved     1,193   (93.3 %)
ever_rejected        12   ( 0.9 %)
never_succeeded      73   ( 5.7 %)
```

### Success rate by attempt count (raw user_id, pre-canonicalisation)
```
1 attempt   883/911   (97 %)
2 attempts  212/239   (89 %)
3 attempts   62/ 69   (90 %)
4–5          31/ 48   (65 %)
6–10          5/ 11   (45 %)
```
The more attempts, the worse the eventual outcome. This is exactly the
"5 tries to get to the finish line" cohort Gabor wants surfaced.

### Issue-type / outcome counts
```
issue_type:  handleFlow (0) 1358  stopAndClear (0) 723  disconnected (0) 223  failed no available customer (0) 116
close_type:  unknown 1367  approve 981  reject 72
status:      finished 1817  aborted 447  unknown 111  failed 45
```

---

## 6. Known limitations of the current collector (to fix on `development`)

1. **Step names hardcoded** to the 3.6.1 SDK shape. Likely the same in 3.7.0,
   but we'll verify from a real 3.7.0 log before assuming.
2. **No time-window state.** `utils/state.ts` was defined but never wired in.
   Per Gabor: delete it and write a new module that understands Firebase's
   URL time-param convention (`?time=Nd` and `?time=<startMs>:<endMs>`).
   `utils/state.ts` is now a deprecation stub; see §10.
3. **No event-count verification.** Gabor flagged anomalies; we can at least
   sanity-check up to 1K against the issue-page total.
4. **No "incremental" mode.** Every run does a full 90-day pull.
5. **Pagination ends after a 10 s wait.** Could miss the last events if the
   UI is slow.
6. **Dedup key is `user_id + date`.** Fine for "not available" (different
   seconds), but unsafe for 3.7.0 multi-report (same session, same date
   string). Switch to log-payload `session_id` + Crashlytics event URL.

---

## 7. Plan summary (lives in `roadmap.md` in detail)

**Stage 1 — Collection (3.7.0):**
- Two modes: `collect:backfill` (90 days, clamped to "since 2026-05-09") and
  `collect:incremental` (yesterday + small overlap, for daily runs).
- Replace `state.ts` with a new module that uses Firebase URL conventions.
- New dedup key: Crashlytics event URL + full `session_id_full`.
- Add an event-count sanity check vs the issue-page total (up to 1K).
- Preserve all UUID variants per user when canonicalising.

**Stage 2 — Analysis (3.7.0):**
- Group reports → sessions → attempts → users.
- Per-user dashboard: # attempts, eventual outcome, step they kept
  abandoning at, time between attempts.
- Cohort tables: never-abandoned, persistent (abandoned + eventually
  succeeded), lost (abandoned + never succeeded).
- "Point of no return" view: P(success | last abandonment was at step X).
- Re-derive step names + labels from a real 3.7.0 log; move them into a
  small JSON config so future SDK changes don't require code edits.

---

## 8. Environment / dev setup

- `.env` IS tracked in git (Gabor confirmed). Currently set to
  `ISSUE_VERSIONS=3.7.0 (2753)`.
- `.gitignore` updated to add `.DS_Store` and `venv`.
- `auth/session.json` holds the Google login (run `npx ts-node auth/setup.ts`
  to refresh).
- `gfktest()` helper in `~/.zshrc` activates venv, ensures node deps, runs
  `npm run collect`, tees the log into `logs/log_YYYYMMDD_HHMMSS.log`.

---

## 9. Firebase Crashlytics URL conventions (notes for the new time-state module)

What we know from `tests/collect.spec.ts`:
- Base: `https://console.firebase.google.com/project/<project>/crashlytics/app/<app>/issues`
- Query params used:
  - `state=open` `tag=all` `sort=eventCount`
  - `versions=<version> (<build>)`
  - `types=error`
  - `issuesQuery=<text>`
  - `time=<window>` — either `Nd` (last N days) OR `<startMs>:<endMs>`
- For 3.7.0 we want both forms:
  - Backfill: `time=90d` (Crashlytics clamps to data availability anyway)
  - Incremental: `time=<startMs>:<endMs>` covering last ~36 h

We'll research Firebase's documented URL format before writing the new
state module, to handle edge cases (DST, ms vs s precision, the inclusive
vs exclusive nature of the endpoints).

---

## 10. Progress log

### 2026-05-19 — Session 1
- Connected the GFK folder. Read codebase end-to-end.
- Created and Gabor renamed working branch → **`development`**.
- Updated `.env` → `ISSUE_VERSIONS=3.7.0 (2753)`.
- Analysed `data/issues.csv` (2,420 rows) — see §5. Key insight: the
  user→attempt→session→report hierarchy is real and grounded in numbers
  (1,095 unique users, 93 % eventual success, multi-attempt retriers up to
  14 events).
- Read Gabor's iOS source for `SelfServicePresenter` — see §2 for the
  mapping of Swift `record(error:)` calls to Crashlytics issue types.
  Key finding: the new "multi-report" behaviour comes from
  `didEnterBackground` recording `sessionBackgrounded` every time.
- Corrections from Gabor logged:
  - "not available" rows are analytics opt-outs, not anomalies.
  - Don't lose UUID variant info when canonicalising — keep an array.
  - `.env` should be tracked.
  - Delete `utils/state.ts`; write a new Firebase-URL-aware state module.
  - Firebase rounds event counts above 1K, so anomaly check is approximate.
- Housekeeping: added `.DS_Store` + `venv` to `.gitignore`; replaced
  `utils/state.ts` with a deprecation stub (sandbox can't `rm` inside the
  repo, so leftover removal needs `git rm utils/state.ts` from Gabor's
  terminal); cleared the stale `.DS_Store` files.
- **Next:** Gabor will share one real 3.7.0 log. Then Stage 1.1 — confirm
  step names and Crashlytics issue-type names for 3.7.0, then start writing
  the new state module + collection modes.
