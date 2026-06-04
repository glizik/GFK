#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Incremental Crashlytics collection — SELF-REPORTING (Telegram), autonomous.
#
#   Usage:  ./collect-incremental.sh [1d|3d|7d|90d]  (default: 1d)
#           DRY=1 ./collect-incremental.sh 1d         (plan only: no collect/commit/Telegram)
#           NO_TG=1 ./collect-incremental.sh          (run but don't send Telegram)
#           NO_PUSH=1 ./collect-incremental.sh        (collect but don't commit/push)
#
# It reports to Telegram itself, so a cron job (or one manual run) does the whole
# daily flow — discovery + collect + commit/push — with NO model tokens (no agent
# in the loop). Order: discovery (90d refresh + login gate) → 3.7.1 (newest)
# small→large → 3.7.0 small→large; only COLLECT uses the narrow window. Sends a
# 10-min heartbeat while a long issue is collecting. Aborts cleanly (and pings
# Telegram) if not logged in — never spins.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")"

VERSIONS=("3.7.1" "3.7.0")          # newest first; add a new version at the front
HEARTBEAT=600                        # seconds between progress pings during a long issue

# ── window arg ──────────────────────────────────────────────────────────────
WINDOW="${1:-1d}"
case "$WINDOW" in
  1|1d) WINDOW=1d ;; 3|3d) WINDOW=3d ;; 7|7d|1w|week) WINDOW=7d ;; 90|90d) WINDOW=90d ;;
  *) echo "Usage: $0 [1d|3d|7d|90d]"; exit 2 ;;
esac

export HEADLESS=true LOGS_DIR=./data/logs COLLECT_LIMIT=0
DRY="${DRY:-0}"; NO_TG="${NO_TG:-0}"; NO_PUSH="${NO_PUSH:-0}"

# ── Telegram self-reporting (token read at runtime, NOT committed) ────────────
TG_ENV="$HOME/.claude/channels/telegram/.env"; TG_CHAT=8428080155
tg () {
  [ "$NO_TG" = "1" ] && return 0; [ "$DRY" = "1" ] && return 0
  [ -f "$TG_ENV" ] || return 0
  local tok; tok=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$TG_ENV" | cut -d= -f2-)
  [ -z "$tok" ] && return 0
  curl -s -o /dev/null "https://api.telegram.org/bot${tok}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT}" --data-urlencode "text=$1" || true
}

echo "==== incremental collection  window=$WINDOW dry=$DRY ===="
tg "▶️ Gyűjtés indul — window=$WINDOW (3.7.1 → 3.7.0, kicsitől nagyig). Self-reporting fut."

build_of () { awk -F, -v v="$1" 'NR>1 && $1==v {print $2}' data/version_releases.csv; }

# kill a pid and all its descendants (npm → npx → node → chromium); macOS has no setsid
kill_tree () {
  local p="$1" c
  for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done
  kill -9 "$p" 2>/dev/null
}

AUTH_OK=0; G171=0; G170=0
for ver in "${VERSIONS[@]}"; do
  build="$(build_of "$ver")"; [ -z "$build" ] && { echo "no build for $ver"; continue; }
  icsv="./data/issues_${ver}.csv"; ecsv="./data/events_${ver}.csv"
  vbefore=$(($(wc -l < "$ecsv")-1))

  echo "## $ver ($build) discovery (90d)"
  out="$(ISSUE_VERSIONS="$ver ($build)" ISSUES_CSV="$icsv" EVENTS_CSV="$ecsv" ISSUE_TIME_DEFAULT=90d npm run discover 2>&1)"
  echo "$out" | grep -E "Issue rows containing|Σ events_total" || true

  if [ "$AUTH_OK" -eq 0 ]; then
    if echo "$out" | grep -q 'GlifWebSignIn\|Issue rows containing "FaceKom": 0'; then
      echo "NOT LOGGED IN — aborting."
      tg "🔑 Nem vagy belépve (lejárt a session). Futtasd: npm run setup — aztán újra: collect. (Nem tekertem feleslegesen.)"
      exit 3
    fi
    AUTH_OK=1
  fi

  order="$(awk -F, 'NR>1 && $7 ~ /^[0-9]+$/ {print $7"\t"$2}' "$icsv" | sort -n | cut -f2-)"
  while IFS= read -r issue; do
    [ -z "$issue" ] && continue
    if [ "$DRY" = "1" ]; then echo "   dry: would collect $ver :: $issue"; continue; fi
    local_before=$(($(wc -l < "$ecsv")-1))
    echo "## collect $ver :: $issue"
    ISSUE_VERSIONS="$ver ($build)" ISSUE_TYPES_LIST="$issue" ISSUES_CSV="$icsv" EVENTS_CSV="$ecsv" \
      ISSUE_TIME_DEFAULT="$WINDOW" npm run collect > /tmp/_gfk_collect.out 2>&1 &
    cpid=$!
    secs=0
    while kill -0 "$cpid" 2>/dev/null; do
      # Session can expire mid-collect → Firebase redirects to Google's login page
      # (GlifWebSignIn) and the collector hangs forever on "Event #1 sek=?". Detect it
      # LIVE (checked before sleeping, so within ~30s), kill the hung tree, and abort —
      # never spin out +0 heartbeats on a dead session.
      if grep -q "BLOCKER\|GlifWebSignIn" /tmp/_gfk_collect.out; then
        kill_tree "$cpid"; wait "$cpid" 2>/dev/null
        tg "🔑 Közben lejárt a session ($ver $issue) — leállítottam. Lépj be (npm run setup) és indítsd újra: collect."
        echo "NOT LOGGED IN (mid-collect) — aborting."
        exit 3
      fi
      sleep 30; secs=$((secs+30))
      if [ $((secs % HEARTBEAT)) -eq 0 ]; then
        nownew=$(( $(($(wc -l < "$ecsv")-1)) - local_before ))
        tg "⏳ $ver $issue: +$nownew új eddig (window=$WINDOW)…"
      fi
    done
    wait "$cpid" || true
    if grep -q "BLOCKER\|GlifWebSignIn" /tmp/_gfk_collect.out; then
      tg "🔑 Közben lejárt a session ($ver $issue). Lépj be (npm run setup) és indítsd újra: collect."
      exit 3
    fi
    newcnt=$(( $(($(wc -l < "$ecsv")-1)) - local_before ))
    [ "$newcnt" -gt 0 ] && tg "✅ $ver $issue: +$newcnt új event"
  done <<< "$order"

  vnew=$(( $(($(wc -l < "$ecsv")-1)) - vbefore ))
  [ "$ver" = "3.7.1" ] && G171=$vnew; [ "$ver" = "3.7.0" ] && G170=$vnew
  [ "$DRY" = "1" ] || tg "📦 $ver kész: +$vnew új event (összes: $(($(wc -l < "$ecsv")-1)))"
done

# ── commit + push (autonomous) ───────────────────────────────────────────────
if [ "$DRY" = "1" ]; then echo "dry done"; exit 0; fi
if [ "$NO_PUSH" != "1" ]; then
  git add data/events_3.7.1.csv data/issues_3.7.1.csv data/events_3.7.0.csv data/issues_3.7.0.csv data/logs/ 2>/dev/null
  if git diff --cached --quiet; then
    echo "no changes to commit"
  else
    git commit -q -m "data: incremental collect (window=$WINDOW) — 3.7.1 +$G171, 3.7.0 +$G170

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" && git push -q origin development && echo "pushed"
  fi
fi

tg "🎉 Gyűjtés kész — window=$WINDOW · 3.7.1 +$G171 · 3.7.0 +$G170 · commit+push kész. A dashboard pár perc múlva frissül."
echo "==== DONE window=$WINDOW  3.7.1 +$G171  3.7.0 +$G170 ===="
