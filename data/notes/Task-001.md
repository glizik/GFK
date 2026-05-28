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

## Involved Sessions:

- #1  19013e43639d4a138a1524ddc0af2eb8  2026-05-15 11:41
- #2  05dd8149937448f3b80e5259d65e6f0e  2026-05-07 12:45
- #3  75763682d7df4aaea31df399156eef8f  2026-05-18 09:12
- #4  fd4995ce0e504200965f156a215fa892  2026-05-06 15:56
- #5  3090f20443824088bb542437fdb400b7  2026-05-18 10:25
- #6  b1bd0be7be9b4a35b3378fb91808c2e1  2026-05-07 12:36
- #7  9c0a89f6ae4f4139b1692ac3dfd2ce08  2026-05-19 08:29
- #8  4510de9401294e07a062d3af25956407  2026-05-13 20:36
- #9  01e1702142aa48a0a42b781e14e8f64c  2026-05-21 14:28
- #10  8b3096e80cc74af3a6f2996d3cce76b3  2026-05-26 11:49
- #11  fd1eb6af3f9340faaa6b5d16c08f6bce  2026-05-26 14:07
- #12  9ac283a89a204eeebcded1eda49b1dbd  2026-05-24 18:28
- #13  b973c2ede8154f1095c5fa7d4f6eca82  2026-05-15 11:33
- #14  35419990ac154db6a25cba14e4c0edf8  2026-05-17 16:54
- #15  073683edc1174bc098d0c2e87d779096  2026-05-06 16:00
