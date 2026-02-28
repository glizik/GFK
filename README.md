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