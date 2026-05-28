# CustomerPortrait: silent rejection loop

**Affected:** 17 users

## What happens

1. FaceKom session started ✅
2. User passes voice-liveness-check ✅
3. and deepfake-detection ✅ 
4. Server sends `customerPortrait` ✅ 
5. step SDK triggers reconnect (`connecting → connected`) 
6. FaceKomSDK.FaceKomError hiba 46 — timeOut
7. User starts over, integrity check aborting ✅
8. User pass voice-liveness-check, deepfake-detection and then customerPortrait again and timeOut again... and just give suggestions here in console.

## Attempt statistics (17 sessions)

- Portrait attempts per session: **min 1 — avg 5.6 — median 5 — max 22**
- Worst case: 1 user made **22 portrait attempts** across 5 full voice→deepfake→portrait restart cycles, never succeeded
- Recovery rate: **6/17 (35%)** eventually passed customerPortrait within the same session after repeated retries
- No observable behavioral difference between recovered and stuck sessions — recovery appears server-dependent (same number of restarts can lead to either outcome)
