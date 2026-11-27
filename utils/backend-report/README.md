# Backend meeting list (FaceKom attempts per user)

Made for the 2026-11-27 backend meeting (new prod backend 1.9.11.44, 11-18 17:00 → 11-26).
Uses the dashboard's own logic (buildReportSessions, laneAbortCategory, deriveAbortExits), PROD only,
whatever data is in `data/` — so `node server.js` must be running.

```bash
NODE_PATH=$PWD/node_modules node utils/backend-report/export-rows.js /tmp/rows.json
python3 utils/backend-report/make-list.py /tmp/rows.json ~/Desktop/lista.md
NODE_PATH=$PWD/node_modules node utils/backend-report/md2pdf.js ~/Desktop/lista.md ~/Desktop/lista.pdf
```

One row = one attempt (split at every abort exit; an attempt starts at the previous abort or at the
Firebase session it lives in). Users (QR uuid) numbered once, further attempts `x2`, `x3`…
Old apps (< 3.9.0) first, then 3.9.0 with the stall summary (count + % of attempts) and
users / attempts approve rates. The title and the 3.9.0 split are hard-coded in make-list.py.
