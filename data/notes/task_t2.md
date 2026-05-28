# CustomerPortrait: integrity check abort

**Priority:** High | **Category:** Backend | **Resolution:** Open

**Affected:** 65 sessions

## What happens

1. User passes voice-liveness-check ✅ and deepfake-detection ✅
2. Gets to `customerPortrait` — server returns immediate integrity check failure:
   `FaceKom failed integrity check at step: customer-portrait, aborted`
3. No retry, SDK aborts with *"Ismeretlen hiba történt!"*
4. App internally reports the stuck step as `voiceLivenessCheck` (confusing mismatch)
5. Can happen on **attempt #2** even after passing all prior steps on attempt #1

## Root cause (hypothesis)

Server-side biometric consistency check: the face portrait captured at `customerPortrait` is flagged as inconsistent with the deepfake-detection selfie from earlier. Possible triggers:

- User moved or changed lighting between the two capture steps
- Camera angle shifted (notable: 69 sessions from iPhone SE with smaller screen)
- Different face distance between deepfake and portrait frames

## Suggested fix

- Surface a specific, actionable message: *"We couldn't verify your face. Please ensure good lighting and look directly at the camera."*
- Allow one retry with fresh deepfake + portrait capture instead of forcing full QR restart
- Log the specific reason for the integrity check failure on the backend for easier debugging

## Involved Sessions (click to open in Firebase)

Open on production Firebase (admin access required):

- [19013e43639d4a13…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/fc90ac57101d1258a32120e65642f194?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=19013e43639d4a138a1524ddc0af2eb8_2218497141129102812)
- [56c09dc0326f4db6…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=56c09dc0326f4db697c83d586197dc14_2218497704365824654)
- [05dd8149937448f3…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=05dd8149937448f3b80e5259d65e6f0e_2215549885537023505)
- [fd4995ce0e504200…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=fd4995ce0e504200965f156a215fa892_2215223185763958779)
- [3090f20443824088…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=3090f20443824088bb542437fdb400b7_2219591809860858807)
- [9c0a89f6ae4f4139…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=9c0a89f6ae4f4139b1692ac3dfd2ce08_2219932859362255392)
- [01e1702142aa48a0…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=01e1702142aa48a0a42b781e14e8f64c_2220765656821314584)
- [8b3096e80cc74af3…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=8b3096e80cc74af3a6f2996d3cce76b3_2222581577515023185)
- [fd1eb6af3f9340fa…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=1h&versions=3.7.0+%282753%29&types=error&sessionEventKey=fd1eb6af3f9340faaa6b5d16c08f6bce_2222616671663597815)
- [9ac283a89a204eee…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=9ac283a89a204eeebcded1eda49b1dbd_2221941787023255790)
- [98468590192443a5…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=98468590192443a5ba434259fb6a6a2e_2217405475188107713)
- [b1bd0be7be9b4a35…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=b1bd0be7be9b4a35b3378fb91808c2e1_2215542768115354224)
