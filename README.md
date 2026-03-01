# GFK

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