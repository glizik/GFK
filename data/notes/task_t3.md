# Consent timer expired at voice-liveness-check

**Priority:** High | **Category:** iOS | **Resolution:** Open

**Affected:** 81 sessions

## What happens

1. FaceKom starts, user gets `voice-liveness-check` as first step
2. Camera opens, WebRTC starts
3. Server waits for BOTH face + voice detection consent within 60 seconds
4. One or both detections never fire:
   - `voice: nil, face: detected` — camera works but microphone doesn't
   - Multiple guide messages loop — server keeps sending "head-on" guidance but detection never triggers
5. After 60 seconds: `"user waited for more than 60 seconds for detection"`
6. Session disconnects silently — user sees a frozen-looking screen

## Notable cases

- 2 sessions lasted **62 minutes** total — users kept returning and hitting the same wall
- 2 sessions lasted **17 minutes** across multiple restarts with the same consent timeout

## Root cause

Either microphone permissions not granted (iOS audio permission prompt may not appear during FaceKom WebRTC session) or environmental factors: dark room, strong background noise, or user holding phone too far from face.

## Suggested fix

- Show a visible countdown during consent phase so user knows something is expected of them
- Check microphone permission state *before* starting WebRTC; prompt user proactively if denied
- After 20 seconds without detection, show in-screen guidance: "Speak clearly" / "Move to better light"
- Distinguish clearly between "waiting for voice" and "waiting for face" so user knows what to do

## Involved Sessions (click to open in Firebase)

Open on production Firebase (admin access required):

- [3cc573bc657647d9…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=3cc573bc657647d988dfc203730e24fb_2219599537921377444)
- [af7adfbbc65f4fc6…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=af7adfbbc65f4fc6afa9d2dcd59d7ff1_2218122466237710140)
- [a5bb2495cdfc4234…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=a5bb2495cdfc4234a80fd6ff844aa07d_2219902632425024363)
- [cf9ed4271cbd450d…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=cf9ed4271cbd450d8e8e4398efa598b3_2219693131564745651)
- [398b5de1c5f54daa…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=398b5de1c5f54daa83bbeec0ae5d0ad0_2216976053577443180)
- [0b15a688bc234caa…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/fc90ac57101d1258a32120e65642f194?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=0b15a688bc234caa8334eef90c6370de_2218575335106602923)
- [4c1b5aabca884971…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=4c1b5aabca884971a8eccf24c4467261_2217468474029934523)
- [09e010a133e84d38…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/fc90ac57101d1258a32120e65642f194?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=09e010a133e84d389004c1e00d8bd4a2_2219941703454500658)
- [f80eea1e0f1542d5…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=f80eea1e0f1542d5b59a5f6d78fa8a95_2217740732332469811)
- [60207f55a2d54af4…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=60207f55a2d54af4b9be02d0d764ecf2_2220859731438390901)
- [799b7fc864d24ba2…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=799b7fc864d24ba284d472d958f6d4aa_2218405541838160324)
- [86f635e26f0a4255…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=86f635e26f0a42558400197d246e59e1_2218457364434290058)
- [ece0959c521f4d13…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=ece0959c521f4d1388971c0f120c271d_2218272798190151631)
- [e1a25d8a90364236…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1554cddf903511ee1651c3806c818d82?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=e1a25d8a903642369caed88985cccdf7_2220372217909121436)
- [7b20ea8a605e4849…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=7b20ea8a605e484987e888f7b0865299_2218463341037722625)
- [6ed5716717844221…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=6ed57167178442218855fd791450a3e8_2219604776589299801)
- [53a1fd6e6c8f48fc…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=53a1fd6e6c8f48fcbde048c4d25d6c23_2218152440561403114)
- [637ffe088dcd47e4…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=637ffe088dcd47e4a4bff9b4225fefb1_2220778560830587222)
- [ff748b4f5b3c4be9…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=ff748b4f5b3c4be9b97c7cc11ac23c85_2217122754393389616)
