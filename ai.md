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

### Crashlytics record types in 3.7.0 (verified against iOS source)

| Swift call | Crashlytics issue (observed / expected) |
|---|---|
| `NSError(domain: "FaceKom handleFlow", code: 0)` in `handleFlow(closeType:)` | `FaceKom handleFlow (0)` — flow dismissed by user (after finish screen). |
| `NSError(domain: "FaceKom stopAndClear", code: 0)` in `stopAndClear()` | `FaceKom stopAndClear (0)` — user closed mid-video step. |
| `SelfServiceRuntimeError.sessionBackgrounded(...)` in `didEnterBackground()` | **`hu.microsec.eszigno.mobile.SelfServiceRuntimeError`** — fires every time the app goes to background mid-flow. Source of the "multiple reports per session" behaviour. |
| `SelfServiceRuntimeError.sessionDisconnected(reason)` | Same Swift type, different `code`. |
| `SelfServiceRuntimeError.sessionFinished(state)` in `reportAndShowFinish` | Same Swift type, code **`30803`** (verified from real event). Fires at every finish regardless of `handleFlow`. |
| `setCustomValue(status, forKey: "STATUS")` | The Keys-tab `STATUS` value (was present in 3.6.1; 3.7.0 may have replaced it with `NSLocalizedDescription`). |
| `setUserID(flowHandler.url?.absoluteString)` | Crashlytics user ID = **full QR URL** `https://videoid-mobile.e-szigno.hu/identification/<uuid>[-<extended>]`. |

The big difference vs. 3.6.1: errors are recorded as **Swift typed errors**,
not `NSError` with a `"FaceKom <name>"` domain string. So the issue list
groups by `hu.microsec.eszigno.mobile.SelfServiceRuntimeError` + an integer
code (e.g. `30803` = `sessionFinished`). One Swift type can produce
multiple issue rows, one per case.

### SDK step names (3.6.1 and 3.7.0 — same)

| MicrosecStep rawValue | Swift case | Logged as in Crashlytics |
|---|---|---|
| `voice-liveness-check` | `voiceLivenessCheck` | `currentStep: voiceLivenessCheck`, or `nextStep: custom(type: "voice-liveness-check", …)` |
| `deepfake-detection` | `deepFake` | `currentStep: deepFake`, or `nextStep: custom(type: "deepfake-detection", …)` |
| `customer-portrait` | `customerPortrait` | `nextStep: customerPortrait(…)` |
| `id-front` | `idFront` | `nextStep: idFront(…)` |
| `id-back` | `idBack` | `nextStep: idBack(…)` |
| `hologram` | `hologram` | `nextStep: hologram(…)` |
| `id-back-video` | `idBackVideo` | `nextStep: custom(type: "id-back-video", …)` |
| `2-factor` | `secondFactor` | `nextStep: twoFactor(…)` |
| `end` | `end` | `nextStep: end(status: "<finished/…>", …)` |

**Confirmed in 3.7.0 from a real log** (`data/fixtures/sample_3.7.0_…json`):
`currentStep: voiceLivenessCheck` appears verbatim — analyzer's existing
`STEP_ORDER` is reusable.

### Re-entry / resume rules
- Voice-liveness-check, deepfake-detection, customer-portrait, id-back-video,
  hologram → **video steps**. Backgrounding aborts. User must rescan QR.
- id-front, id-back, twoFactor, end → **non-video steps**. Backgrounding
  doesn't necessarily kill the session.
- Resume entry points: `voiceLivenessCheck`, `idFront`, `idBack`, `hologram`,
  `idBackVideo`, `secondFactor`, `end`. After first video step the user can
  resume from `idFront` onward.

---

## 3. Firebase Crashlytics URL conventions (from real 3.7.0 page sources)

### Issue list (all events for a version)
```
https://console.firebase.google.com/u/<u>/project/<project>/crashlytics/app/<app>/issues
   ?time=90d
   &state=open
   &tag=all
   &sort=eventCount
   &versions=<version> (<build>)
   &types=error
   &issuesQuery=<query>
```

### Single issue (one error type / domain+code)
```
.../crashlytics/app/<app>/issues/<issue_id>
   ?time=90d
   &versions=<version> (<build>)
   &types=error
   &sessionEventKey=<session_id_base>_<event_id>
```

### Key fields decoded
- **`issue_id`** (e.g. `1782c2128a0148281dace39bf8664159`) — Firebase's
  hash for the (domain, code, app) tuple. Stable across events of the
  same issue type.
- **`sessionEventKey`** — two parts joined by `_`:
  - `session_id_base` (32-char hex) — same across all reports of one
    Firebase Analytics session.
  - `event_id` (numeric, ~19 digits) — unique per Crashlytics non-fatal
    event. **This is the dedup key we want.**
- **`time`** — `Nd` (relative, e.g. `90d`) **or** `<startMs>:<endMs>`.

### Inside the downloaded JSON
```
{
  "title":      "Crashlytics - Custom logs",
  "bundle_identifier": "hu.microsec.eszigno.mobile",
  "platform":   "apple",
  "display_version": "3.7.0",
  "build_version":   "2753",
  "issue_id":   "...",
  "session_id": "<session_id_base>_DNE_<N>_v2",
  "event_timestamp": "Tue May 19 2026 09:15:21 GMT+0200 (...)",
  "logs_and_breadcrumbs": [ ... ]   // the gold
}
```

The `_DNE_<N>_v2` suffix is the **report index within the session** —
this is how 3.7.0 ships multiple reports for one session.

### Event counts on the page
- Firebase rounds **above 1,000** to `1K`, `2K`, etc.
- Below that we get the exact number. From the sample run:
  - 3.7.0 total non-fatals: **977**.
  - Single issue `SelfServiceRuntimeError (30803)`: **583** events.
  - "Users": **255** — Gabor confirmed this is Firebase Installation IDs
    (≈ distinct device installs), not unique humans.

---

## 4. What one 3.7.0 event actually looks like (sample fixture)

Saved at `data/fixtures/sample_3.7.0_sessionFinished_aborted_30803.json`.

- Issue: `hu.microsec.eszigno.mobile.SelfServiceRuntimeError (30803)` →
  `sessionFinished(state:)` in the Swift code.
- App version: `3.7.0 (2753)`, iPhone XR, iOS 18.7.9, 242 MB RAM free.
- Event timestamp: `2026-05-19 09:15:21 +0200`.
- User ID (Crashlytics): full QR URL,
  `https://videoid-mobile.e-szigno.hu/identification/5b66dedc-c3b7-4ad8-abf7-c0c790f3ac73`.
- Keys: `CONFIGURATION=PROD Release`, `SOURCE=videoId`, `nserror-code=30803`,
  `nserror-domain=hu.microsec.eszigno.mobile.SelfServiceRuntimeError`,
  `NSLocalizedDescription=Facekom finished with state: aborted(message: nil)`.

### What the user actually did (reconstructed from 23 breadcrumbs)
| t (s) | event |
|---|---|
| 0 | screen: EULAScreen |
| 18 | screen: LoginStartScreen |
| 78 | screen: LoginQrReaderScreen *(user scanned the QR)* |
| 83 | screen: VideoUserAgreementsScreen |
| 85 | screen: VideoAssistanceScreen |
| 88 | `FaceKom started from: videoId` / `started with assistance: false` |
| 88 | screen: VideoIntroScreen |
| 110 | `FaceKom ID Verified` |
| 111 | screen: IdVerificationScreen |
| 113 | `FaceKom SelfService started` |
| 114 | screen: SelfServiceViewController |
| 115 | `FaceKom getSettings success` → `status: connecting` |
| 118 | `status: disconnected` → `connect socket error: timeOut` |
| 119 | screen: UIAlertController *(error popup)* |
| 121 | `error: timeOut happened, stop and show abort` → retry `connecting` → `failed to stop with error: networkError from SelfService error, currentStep: voiceLivenessCheck. Aborted.` → `Facekom finished with state: aborted(message: nil)` |
| 121 | screen: FinishViewController *(user shown the abort screen)* |

### What this tells us
1. **This particular abort is not user behaviour, it's backend.** Socket
   timed out before the first video step started. The user did everything
   right; the FaceKom server didn't respond.
2. **`currentStep: voiceLivenessCheck`** is in the message body — proves the
   3.7.0 SDK still emits step names like 3.6.1.
3. **No `FaceKom nextStep:` messages here at all.** This session never got
   past the socket-handshake. So the analyzer's funnel for this session
   would be `start → end (aborted, reason=networkError)` with zero step
   transitions — exactly the kind of "user reached zero steps" case the
   cohort report should call out separately from real drop-offs.
4. **`Facekom finished with state: <X>(message: <Y>)`** is the canonical
   outcome line (`X ∈ {finished, aborted, expired, failed}`). The new
   `NSLocalizedDescription` Key exposes this same string in the Keys tab,
   so the collector can read outcome without parsing breadcrumbs.

---

## 5. The right way to think about the data

> **One Crashlytics event ≠ one user.**
> The hierarchy is **user → attempt → session → report.**

| Level | Identifier | Notes |
|---|---|---|
| **User** | `user_id_base` (first 36 chars of user_id) | Physical person. **Variants** of the QR for the same person (extended UUID `<base>-<unix_ts>`) all belong here. Per-user record keeps an array of every variant seen — `user_id_variants[]`, `identification_links[]`. |
| **Attempt** | `user_id` — `base_uuid` or `base_uuid-<unix_ts>` | One QR scan / one identification link. |
| **Session** | `session_id_base` (from log JSON OR `sessionEventKey` URL param) | The Firebase Analytics session inside the iOS app. |
| **Report** | full `session_id` with `_DNE_<N>_v2` suffix; or full `sessionEventKey` (`base_eventId`) for unique per-event identity | A single Crashlytics non-fatal report = one row in `issues.csv`. 3.7.0 emits multiple per session (every `didEnterBackground` fires one). |

### Why this matters
- **User-centric success** is what we care about. In 3.6.1 data: 1,278 users
  with real IDs ran 1,877 attempts; 1,193 (93 %) eventually got approved.
- "Abandoned" is **not** a session timeout — it's a property of a session
  (the user backgrounded mid-flow). Same user can have several abandoned
  sessions and still end up a successful user.
- Aborts caused by **backend network failures** (like the sample event)
  must be cleanly separated from user-driven aborts — we can read this off
  the breadcrumbs (`networkError`, `timeOut`, `disconnected`).

---

## 6. Data-model clarifications (per Gabor 2026-05-19)

1. **Don't lose UUID variant info when canonicalising users.** Per-user
   record carries `user_id_variants[]` and `identification_links[]`.
2. **`user_id = "not available"` is NOT an anomaly.** Users who declined
   analytics. They produce legitimate distinct events. The real anomaly is
   the (≈1) event with **no ID at all**.
3. **Crashlytics event-count display rounds above 1,000.** Below 1K we
   get the exact number. The sanity check uses the displayed total as a
   floor — if we collected less, warn.
4. **CSV strategy.** Clear `data/issues.csv` on `development`. Add an
   `app_version` column (already present) for future versions to append
   to the same file.

---

## 7. Per-event fields we want in the CSV (3.7.0)

Based on what Gabor listed plus what the JSON exposes:

### Identity & dedup
- `event_url` — deep link to the event (built from `issue_id` +
  `sessionEventKey`). **Primary dedup key.**
- `issue_id`, `session_event_key` (raw, for traceability).
- `session_id_full` (e.g. `..._DNE_0_v2`).
- `session_id_base` (suffix stripped).
- `report_index` (int from `_DNE_<N>_v2`).
- `event_id` (numeric, second half of `sessionEventKey`).
- `user_id_base` (first 36 chars of `user_id`).
- `user_id_suffix` (the `-<unix_ts>` part, or empty).
- `identification_link` (full QR URL from Crashlytics setUserID).

### Event summary
- `app_version` (e.g. `3.7.0 (2753)`).
- `os_version` (cleaned: `iOS 18.7.9`).
- `os_major_version`.
- `model` (e.g. `iPhone XR`).
- `date` (event timestamp as ISO).

### Keys tab
- `crash_kind` (`sessionFinished` / `sessionBackgrounded` / `handleFlow` /
  `stopAndClear` / `sessionDisconnected` / …) — **derived** from
  `nserror_domain` + `nserror_code` mapping.
- `nserror_code` (int, e.g. 30803).
- `nserror_domain` (string).
- `source` (`videoId`, …).
- `status` (3.6.1 only; may be absent in 3.7.0).
- `configuration` (`PROD Release`).
- `nslocalized_description` (3.7.0 — has outcome embedded).

### Device / OS / crash context
- `orientation_device`, `ram_free_mib`, `jailbroken`, `orientation_os` —
  Gabor explicitly asked for these.

### Derived from breadcrumbs (the gold)
- `outcome` (`approve` / `reject` / `aborted` / `expired` / `failed` /
  `no-customer`) — parsed from "Facekom finished with state: X" and the
  `handleFlow` close type.
- `reason` (free text, e.g. `networkError`, `no-available-customer`,
  `consent timer expired`) — parsed from breadcrumbs.
- `last_step` (the highest MicrosecStep reached in breadcrumbs).
- `steps_reached[]` (which of the canonical steps appeared).
- `screen_views[]` — the ordered list of `firebase_screen_class` values.
- `n_status_changes` — how many `status changed:` messages (high counts
  mean reconnect loops).
- `first_breadcrumb_ts`, `last_breadcrumb_ts`, `session_elapsed_s`.

The **whole `logs_and_breadcrumbs` array** also lives in the per-event
JSON file under `data/logs/`, so the CSV doesn't need to contain it
verbatim — but every column above can be derived from it.

---

## 8. Dataset snapshot — 3.6.1 (frozen, reference baseline)

Analysed on 2026-05-19, source `data/issues.csv` (2,420 rows on `main`).

| Slice | Count |
|---|---|
| Total rows | 2,420 |
| Rows with real user_id | 1,877 (77.6 %) |
| Rows with `user_id = "not available"` (analytics opt-out) | 543 (22.4 %) |
| Unique `user_id` strings | 1,278 |
| Unique `base_uuid` (canonicalised) | 1,095 |
| Users seen with both base and extended UUID variants | 129 |
| Date range collected | 2026-02-05 → 2026-03-29 |

### Per-user retry distribution (canonical base_uuid)
```
1 attempt   681 users      6           4
2           236            7           6
3            90            8           4
4            47            9–14       (long tail to 14)
5            22
```

### Per-user outcomes
```
ever_approved     1,193   (93.3 %)
ever_rejected        12   ( 0.9 %)
never_succeeded      73   ( 5.7 %)
```

### Success rate by attempt count (raw user_id)
```
1 attempt   883/911   (97 %)
2 attempts  212/239   (89 %)
3 attempts   62/ 69   (90 %)
4–5          31/ 48   (65 %)
6–10          5/ 11   (45 %)
```

---

## 9. Known limitations of the current collector (to fix on `development`)

1. **Dedup key is `user_id + date`.** Unsafe for 3.7.0 multi-report (same
   session, same date string). Switch to `event_url` built from
   `(issue_id, sessionEventKey)`.
2. **`utils/state.ts` is deprecated.** Replaced by a Firebase-URL-aware
   time module (§3 above).
3. **No event-count verification.** Read the issue page's "Events" total,
   compare to collected rows.
4. **No "incremental" mode.** Every run does a full 90-day pull.
5. **Pagination ends after a 10 s wait.** Can miss tail events.
6. **Step names** in 3.6.1's analyzer are reusable for 3.7.0 (confirmed
   from real log).

---

## 10. Plan summary (lives in `roadmap.md` in detail)

**Stage 1 — Collection (3.7.0):**
- Two modes: `collect:backfill` (90 days, clamped to "since 2026-05-09")
  and `collect:incremental` (yesterday + small overlap).
- New dedup key: `event_url` (built from `issue_id` + `sessionEventKey`).
- New issue-types list: `SelfServiceRuntimeError` cases by `nserror_code`
  (e.g. `30803 = sessionFinished`), `handleFlow (0)`, `stopAndClear (0)`,
  plus whichever other Swift typed errors appear.
- Event-count sanity check vs the issue-page total (up to 1K).
- Preserve all UUID variants per user.

**Stage 2 — Analysis (3.7.0):**
- Group reports → sessions (strip `_DNE_<N>_v2`) → attempts → users.
- Per-user dashboard: # attempts, eventual outcome, step they kept
  abandoning at, time between attempts.
- Cohort tables: never-abandoned (one-shot success/fail), persistent
  (abandoned + eventually succeeded), lost.
- Separate **user-driven aborts** from **backend errors** (read
  `networkError` / `timeOut` from breadcrumbs).
- "Point of no return" view: P(success | last abandonment was at step X).

---

## 11. Environment / dev setup

- `.env` IS tracked in git. Currently set to `ISSUE_VERSIONS=3.7.0 (2753)`.
- `.gitignore` adds `.DS_Store` and `venv`.
- `auth/session.json` holds the Google login.
- `gfktest()` helper in `~/.zshrc` for one-shot runs.

---

## 12. Progress log

### 2026-05-19 — Session 1
- Connected the GFK folder. Read codebase end-to-end.
- Gabor renamed working branch → **`development`**.
- Updated `.env` → `ISSUE_VERSIONS=3.7.0 (2753)`.
- Analysed `data/issues.csv` (2,420 rows) — see §8.
- Read Gabor's iOS source for `SelfServicePresenter`.
- Updated `.gitignore` (`.DS_Store`, `venv`); deprecated `utils/state.ts`.

### 2026-05-19 — Session 2
- Gabor shared a real 3.7.0 Crashlytics export (`SelfServiceRuntimeError
  30803`, 583 events on that issue, 977 events total on the version).
- Saved as `data/fixtures/sample_3.7.0_sessionFinished_aborted_30803.json`
  — first reusable analyzer test fixture.
- Decoded the Firebase URL conventions (§3): `sessionEventKey` is
  `<session_id_base>_<event_id>` and is the right primary dedup key.
- Decoded the new issue-grouping behaviour: Swift typed errors produce
  `<full-type-name>` issues with integer codes per case
  (`30803 = sessionFinished`).
- Confirmed SDK step names unchanged in 3.7.0 — `currentStep:
  voiceLivenessCheck` verbatim in the breadcrumb stream.
- Walked the 23-breadcrumb sample (§4) — shows that this particular abort
  was a backend socket timeout, not user-driven. Argues for parsing
  breadcrumbs into `outcome + reason` columns.
- Compiled the full list of per-event CSV fields (§7), including the
  device/OS extras Gabor asked for plus breadcrumb-derived fields.
- **Next:** propose the additional fields back to Gabor; once approved,
  draft the new `IssueRecord` shape and the Firebase-URL state module.
