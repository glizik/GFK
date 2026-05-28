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

- Worst case: 1 user made **22 portrait attempts** across 5 full voice→deepfake→portrait restart cycles, never succeeded
- Recovery rate: **4/17 (23%)** eventually passed customerPortrait within the same session after repeated retries
Approved (05dd8149937448f3b80e5259d65e6f0e, 75763682d7df4aaea31df399156eef8f, 9c0a89f6ae4f4139b1692ac3dfd2ce08, 4510de9401294e07a062d3af25956407)
- No observable behavioral difference between recovered and stuck sessions — recovery appears server-dependent (same number of restarts can lead to either outcome)
