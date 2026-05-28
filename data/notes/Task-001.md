# CustomerPortrait: silent rejection loop


**Affected:** 112 sessions with `finished with type: reject`, 71 with explicit retry loops

## What happens

1. User passes voice-liveness-check ✅ and deepfake-detection ✅
2. Server sends `customerPortrait` step
3. ~37–50 seconds pass with no server response — no UI feedback, no progress
4. SDK reconnects (`connecting → connected`) — server re-sends `customerPortrait` as `retry Step`
5. Repeats until SDK gives up: `finished with type: reject`
6. User sees *"Ismeretlen hiba történt!"* — generic unknown error
7. User must restart from QR code

## Session 19013e43 — detailed trace (11:13–11:32, 19 minutes)

This user made **5 full FaceKom attempts** before giving up (app went to background).

| # | Assistance | Voice/Deepfake | CustomerPortrait result |
|---|---|---|---|
| 1 | ✗ | ✓ | timeout loop ×2 → reject |
| 2 | ✗ | skipped | immediate integrity check failure |
| 3 | ✗ | ✓ | timeout loop + error 46 → reject |
| 4 | ✓ | skipped | immediate integrity check failure |
| 5 | ✓ | ✓ | timeout loop + error 46 → reject |

## Two distinct failure modes

### Mode A — Server timeout loop (attempts 1, 3, 5)

These are the full-flow attempts where voice and deepfake succeeded.

- `nextStep: customerPortrait` arrives with `retry: Optional(false)`
- No `SelfieViewController` appears — user stays on `SelfServiceViewController` with zero UI feedback
- After exactly **~37–50 seconds**, the socket disconnects with no error logged
- SDK reconnects and server re-sends `customerPortrait` again — still `retry: Optional(false)`
- The `retry: false` flag **never changes**, even on the 3rd, 4th cycle — the server either isn't setting it or treats every reconnect as a fresh start
- Occasionally `FaceKomError hiba 46 (timeOut)` surfaces in the log before the next reconnect
- Pattern repeats until `finished with type: reject`

**The reconnect is NOT triggered by a network drop.** There is no `FaceKom session disconnected` or socket error before it. The server itself times out on portrait processing and drops the connection. The SDK's reconnect is a response to the server going silent.

### Mode B — Integrity check failure on fast QR rescan (attempts 2, 4)

When the user scanned a new QR code within ~1 minute of a previous attempt:

- Server skips voice-liveness-check and deepfake entirely, jumps straight to `customerPortrait`
- `FaceKom failed integrity check at step: customer-portrait, aborted.` fires at the **exact same millisecond** as `nextStep: customerPortrait` — it's instantaneous
- The server is reusing cached voice/deepfake data from the old session token but the new QR has a different token — mismatch detected, immediate abort

This is a separate server-side state management bug: the session is not properly invalidated on reject, so the next QR scan inherits a zombie state.

## Ghost connections after reject

After `finished with type: reject` and the user navigates back to QR screen, the SDK reconnects **14 seconds later without any user action** and receives `customerPortrait` again. The server session is still alive. This zombie cycle keeps running until the new QR scan's auth replaces it.

## State machine inconsistency (iOS side)

After a Mode B integrity check abort (currentStep = `customer-portrait`), the subsequent `user initiated closing` log reports `currentStep: voiceLivenessCheck`. The iOS state machine didn't update when the server jumped straight to customerPortrait and aborted — it still thinks it's at the first step.

## What's different from approved sessions

In approved sessions the server sends a `nextStep` (to `idFront` or similar) within seconds of `customerPortrait`. In this session the server **never** sends a `nextStep` after customerPortrait across any of 5 attempts. The server consistently fails the portrait validation and drops the connection every single time.

The user tried assisted mode (attempts 4 and 5) — same result. If a live agent was present, they couldn't help either.

## Root cause

Two independent bugs:

1. **Server portrait validation always fails for this user** — possibly face doesn't match ID photo (old photo, appearance change, or ID scan quality), or backend anti-spoofing flags the portrait, or a processing loop on the backend. The consistent ~37–50s timeout window suggests a server-side processing timeout rather than a network issue.

2. **Sessions not invalidated on reject** — server keeps the session alive after reject, leading to ghost reconnects and integrity check failures when a new QR is scanned within the same minute.

## Instinct — when does this happen

- Users whose **live face doesn't closely match their ID document photo** (old photo, glasses/hair change, low-quality ID scan)
- OR users where the server's portrait liveness check flags something (harsh lighting, reflections, extreme angles)
- The loop is invisible to the user — no progress bar, no "we're processing", nothing — so they keep retrying
- Assisted mode offers no rescue if the portrait check itself is the blocker

## Suggested fix

- Server should return a specific failure reason on reject (why did portrait fail?) so SDK can surface a meaningful message
- `retry` flag must be set correctly — `retry: Optional(true)` on retry cycles, not `false` every time
- Server must invalidate/close the session on `reject` so no ghost reconnects reach the SDK
- Cap auto-retries at 2–3 max with a clear failure screen: "We couldn't verify your face — please try in better lighting" / "Please ensure your face is fully visible"
- No UI feedback during customerPortrait is a UX cliff — add a progress state ("Verifying your face…")
