# CustomerPortrait: silent rejection loop


**Affected:** 112 sessions with `finished with type: reject`, 71 with explicit retry loops

## What happens

1. User passes voice-liveness-check ✅ and deepfake-detection ✅
2. Server sends `customerPortrait` step
3. SDK triggers reconnect (`connecting → connected`) — auto-retry kicks in
4. Server sends `customerPortrait` again as `retry Step`
5. Repeats up to **13 times** in the worst case
6. SDK gives up: `finished with type: reject`
7. User sees *"Ismeretlen hiba történt!"* — generic unknown error
8. User must restart from QR code

## Root cause

Server silently fails the portrait quality/validation check on every retry without communicating the reason to the SDK. The retry mechanism (designed to recover from dropped frames) becomes a trap — user burns multiple reconnect cycles against the same failing check with no feedback.

## Suggested fix

- Server should return a specific failure reason on reject so SDK can surface a meaningful message
- Consider surfacing retry count to user: "Trying again… (2/3)"
- If all retries exhausted, show actionable guidance (better lighting, remove glasses, etc.)
- Cap auto-retries at 2–3 and surface a clear failure screen instead of silently looping
