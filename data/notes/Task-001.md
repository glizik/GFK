# CustomerPortrait: silent rejection loop

**Affected:** 15 users

## What happens

1. FaceKom session started ✅
2. User passes voice-liveness-check ✅
3. and deepfake-detection ✅ 
4. Server sends `customerPortrait` ✅ 
5. step SDK triggers reconnect (`connecting → connected`) 
6. FaceKomSDK.FaceKomError hiba 46 — timeOut
7. User starts over, integrity check aborting ✅
8. User pass voice-liveness-check, deepfake-detection and then customerPortrait again and timeOut again... and just give suggestions here in console.
