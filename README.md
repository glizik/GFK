# GFK

FaceKom iOS identity-verification dashboard built from Firebase Crashlytics data.
Dashboard: `node server.js` → http://localhost:3737 · deployed to GitHub Pages on every push to
`development`. Architecture, data model and conventions: **`CLAUDE.md`** (and `ai.md`).

## Collecting data (current)

```bash
./collect-incremental.sh            # last 1 day (default)
./collect-incremental.sh 3d         # 1d | 3d | 7d | 90d
```

Collects, rebuilds `data/events_<v>.json`, commits + pushes, and reports to Telegram by itself.
Nothing older than the data epoch (`COLLECT_SINCE`, set in the script: 2026-11-26 16:25, the prod
backend config change) is ever requested — older data lives in `archive/`.

### Two collection paths

| | **One pass, all versions** (default) | **Per version** (old path) |
|---|---|---|
| Switch | `COLLECT_ALL=1` (default) | `COLLECT_ALL=0 ./collect-incremental.sh 1d` |
| How | ONE collector run, ONE browser, no version filter. FaceKom issue list straight from the Crashlytics API, every event routed to `events_<its version>.csv`, then one more API call per version for the per-version issue totals. | For every active version: UI discovery (90d) → one collector run (and browser) per issue. |
| New app version | added to `data/version_releases.csv` automatically (active) | must be added to `data/version_releases.csv` by hand |
| Speed (quiet day) | ~20–30 s | ~30 min |

Keep the old path working: the API endpoints are internal and undocumented. If the one-pass run
breaks, `COLLECT_ALL=0` is the first fallback, `COLLECT_MODE=scrape` (UI walk instead of the API)
the second.

**1000-event cap:** Crashlytics returns at most 1000 events per issue per query (the newest ones).
When an issue hits it, the run sends a 🚨 Telegram message and logs it in `data/collect-gaps.jsonl`.

### First-time login / expired session
```bash
npm run setup
```

---

*Everything below is the original (2026-05) README of the first, UI-scraping collector — kept for
reference, partly outdated.*

added helper method to ~/.zshrc

# GFK – Crashlytics collector
gfktest() {
    local GFK_DIR="/Users/lizik.gabor/DEV/GFK"

    cd "$GFK_DIR" || return

    # Python venv (auto-create if missing)
    if [ ! -d "$GFK_DIR/venv" ]; then
        echo "🐍 Creating venv..."
        python3 -m venv "$GFK_DIR/venv" || return
    fi
    source "$GFK_DIR/venv/bin/activate" || return

    # Node deps (install if node_modules missing)
    if [ ! -d "$GFK_DIR/node_modules" ]; then
        echo "📦 Installing npm dependencies..."
        npm --prefix "$GFK_DIR" install || return
        npx --prefix "$GFK_DIR" playwright install chromium || return
    fi

    # Auth check
    if [ ! -f "$GFK_DIR/auth/session.json" ]; then
        echo "⚠️  No auth session found. Run: npx ts-node auth/setup.ts"
        return
    fi

    mkdir -p "$GFK_DIR/logs" "$GFK_DIR/data/logs"

    npm --prefix "$GFK_DIR" run collect 2>&1 | tee "$GFK_DIR/logs/log_$(date +"%Y%m%d_%H%M%S").log"
}

# GFK – Firebase Crashlytics Issue Collector

Playwright-based tool that collects non-fatal FaceKom issues from Firebase Crashlytics and builds an incrementally-updated CSV database.

---

### 1. Authenticate (first time only)
```bash
npx ts-node auth/setup.ts
```
A browser will open. Log in to your Google / Firebase account, then close it. Your session is saved to `auth/session.json` (gitignored).

### 2. Run the collector
```bash
npm run collect          # visible browser (good for debugging)
npm run collect:headless # headless
```

Every run:
- Opens Crashlytics, finds the issue matching `ISSUE_TYPE` from `.env` (default: `FaceKom handleFlow(0)`)
- Reads the Data tab (ID, Event summary → App/OS/Model/Date)
- Reads the Keys tab (SOURCE, STATUS)
- Downloads and renames the log file
- Appends new rows to `data/issues.csv`, **skipping already-seen sessions**

---

### 3. Cleanup
node utils/cleanup-unknown.js


## Session deduplication

A **session** is identified by the composite key:

```
session_key = identification + "__" + date
```

The same user ID can appear multiple times (they retried); each attempt on a different date is a new row.

---

## CSV columns

| Column | Description |
|---|---|
| `session_key` | Unique composite key (ID + date) |
| `identification` | Firebase ID value |
| `identification_link` | Deep link to the event in Firebase |
| `app_version` | App version from Event summary |
| `os_version` | Cleaned OS version (`iOS 16.1`, not `iosiOS 16.1`) |
| `os_major_version` | Major version number (`16`) |
| `model` | Device model |
| `date` | Event date |
| `source` | SOURCE key from Keys tab |
| `status` | STATUS key from Keys tab |
| `log_filename` | Renamed log file in `data/logs/` |
| `issue_type` | Issue title |
| `collected_at` | ISO timestamp of collection |
| `is_error` | Always `true` for error-type issues |

---

## Configuration (`.env`)

```
FIREBASE_URL=https://console.firebase.google.com/project/.../crashlytics/...
ISSUE_TYPE=FaceKom handleFlow(0)
ISSUE_VERSIONS=3.6.1 (2662)
CSV_OUTPUT=./data/issues.csv
LOGS_DIR=./data/logs
HEADLESS=false
```

---

## Log files

Saved to `data/logs/` and named:
```
{identification}_{date}.log
```
Special characters replaced with `_` for safe filenames.

---

## Visualisation (coming next)

The CSV is already enriched with `os_major_version`, `is_error`, and `issue_type` columns to support dashboards. Future slices:
- All FaceKom events
- Errors only
- Specific error types (handleFlow(0), etc.)
- Events by OS major version
- Events by app version