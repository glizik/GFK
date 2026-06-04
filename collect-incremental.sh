#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Incremental Crashlytics collection (the daily/normal workflow).
#
#   Usage:  ./collect-incremental.sh [1d|3d|7d]      (default: 1d)
#           DRY=1 ./collect-incremental.sh 1d         (plan only, no collect)
#
# What it does, in order:
#   1) AUTH CHECK — a quick discovery; if not logged in (Google sign-in / 0 issues)
#      it ABORTS immediately so we never spin uselessly. Fix: `npm run setup`.
#   2) For each version (newest first: 3.7.1 then 3.7.0):
#        a) discovery (refresh issue list + counts)
#        b) collect each issue SMALL → LARGE, only events inside the window
#           (event_url dedup means already-collected events are skipped → fast).
#
# The window only limits how far back we fetch events; the events CSVs keep
# accumulating across runs. Builds are read from data/version_releases.csv.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")"

# Versions to collect, NEWEST FIRST. Add a new version at the front when it ships.
VERSIONS=("3.7.1" "3.7.0")

# ── window arg ──────────────────────────────────────────────────────────────
WINDOW="${1:-1d}"
case "$WINDOW" in
  1|1d)        WINDOW=1d ;;
  3|3d)        WINDOW=3d ;;
  7|7d|1w|week) WINDOW=7d ;;
  *) echo "Usage: $0 [1d|3d|7d]  (default 1d)"; exit 2 ;;
esac

export HEADLESS=true
export LOGS_DIR=./data/logs
export COLLECT_LIMIT=0
DRY="${DRY:-0}"

echo "════════════════════════════════════════════════════════════"
echo "Incremental collection — window=$WINDOW  dry=$DRY  versions=${VERSIONS[*]}"
echo "════════════════════════════════════════════════════════════"

build_of () { awk -F, -v v="$1" 'NR>1 && $1==v {print $2}' data/version_releases.csv; }

# Discovery always runs at 90d: keeps issue totals accurate, ordering stable, and makes the
# login check reliable (a logged-in account always has FaceKom issues in 90d, so "0 issues"
# unambiguously means signed out). Only COLLECT uses the narrow $WINDOW.
discover_version () { # $1=ver $2=build $3=icsv $4=ecsv  -> prints discovery output
  ISSUE_VERSIONS="$1 ($2)" ISSUES_CSV="$3" EVENTS_CSV="$4" ISSUE_TIME_DEFAULT="90d" \
    npm run discover 2>&1
}

AUTH_OK=0
for ver in "${VERSIONS[@]}"; do
  build="$(build_of "$ver")"
  if [ -z "$build" ]; then echo "!! no build for $ver in version_releases.csv — skipping"; continue; fi
  icsv="./data/issues_${ver}.csv"; ecsv="./data/events_${ver}.csv"

  echo; echo "########## VERSION $ver ($build) ##########"
  echo ">>> DISCOVERY ($ver, 90d refresh)"
  out="$(discover_version "$ver" "$build" "$icsv" "$ecsv")"
  echo "$out" | grep -E "Issue rows containing|Σ events_total|Saved worklist" || true

  # ── auth gate (only needs to pass once) ──
  if [ "$AUTH_OK" -eq 0 ]; then
    if echo "$out" | grep -q 'GlifWebSignIn\|Issue rows containing "FaceKom": 0'; then
      echo "!! NOT LOGGED IN (Google sign-in / 0 issues). Run: npm run setup — then retry."
      echo "!! Aborting without collecting (no useless spinning)."
      exit 3
    fi
    AUTH_OK=1
    echo ">>> AUTH OK"
  fi

  # ── order issues SMALL → LARGE by events_total (col 7); issue_name = col 2 ──
  order="$(awk -F, 'NR>1 && $7 ~ /^[0-9]+$/ {print $7"\t"$2}' "$icsv" | sort -n | cut -f2-)"
  echo ">>> COLLECT ORDER ($ver, small→large):"; echo "$order" | sed 's/^/      - /'

  while IFS= read -r issue; do
    [ -z "$issue" ] && continue
    echo; echo ">>> COLLECT $ver :: $issue"
    if [ "$DRY" = "1" ]; then
      echo "    (dry-run: would collect this issue, window=$WINDOW)"
    else
      ISSUE_VERSIONS="$ver ($build)" ISSUE_TYPES_LIST="$issue" \
        ISSUES_CSV="$icsv" EVENTS_CSV="$ecsv" ISSUE_TIME_DEFAULT="$WINDOW" \
        npm run collect 2>&1 | grep -E "Collecting|new events collected|Done. Total|BLOCKER|GlifWebSignIn" || true
    fi
  done <<< "$order"
done

echo; echo "════════════════════════════════════════════════════════════"
echo "DONE — window=$WINDOW.  events: 3.7.1=$(($(wc -l < data/events_3.7.1.csv)-1)) | 3.7.0=$(($(wc -l < data/events_3.7.0.csv)-1))"
echo "════════════════════════════════════════════════════════════"
