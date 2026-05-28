# CustomerPortrait: silent rejection loop

**Priority:** Critical | **Category:** Backend | **Resolution:** Open

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

## Involved Sessions (click to open in Firebase)

Open on production Firebase (admin access required):

- [19013e43639d4a13…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/fc90ac57101d1258a32120e65642f194?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=19013e43639d4a138a1524ddc0af2eb8_2218497141129102812)
- [05dd8149937448f3…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=05dd8149937448f3b80e5259d65e6f0e_2215549885537023505)
- [75763682d7df4aae…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=75763682d7df4aaea31df399156eef8f_2219562974078897125)
- [fd4995ce0e504200…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=fd4995ce0e504200965f156a215fa892_2215223185763958779)
- [3090f20443824088…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=3090f20443824088bb542437fdb400b7_2219591809860858807)
- [b1bd0be7be9b4a35…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=b1bd0be7be9b4a35b3378fb91808c2e1_2215542630676400749)
- [9c0a89f6ae4f4139…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=9c0a89f6ae4f4139b1692ac3dfd2ce08_2219932859362255392)
- [4510de9401294e07…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=4510de9401294e07a062d3af25956407_2217892720380528588)
- [01e1702142aa48a0…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=01e1702142aa48a0a42b781e14e8f64c_2220765656821314584)
- [8b3096e80cc74af3…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=8b3096e80cc74af3a6f2996d3cce76b3_2222581577515023185)
- [fd1eb6af3f9340fa…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=1h&versions=3.7.0+%282753%29&types=error&sessionEventKey=fd1eb6af3f9340faaa6b5d16c08f6bce_2222616671663597815)
- [9ac283a89a204eee…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=9ac283a89a204eeebcded1eda49b1dbd_2221941787023255790)
- [b973c2ede8154f10…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=b973c2ede8154f1095c5fa7d4f6eca82_2218494916373388242)
- [35419990ac154db6…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=35419990ac154db6a25cba14e4c0edf8_2219319904416908038)
- [073683edc1174bc0…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=073683edc1174bc098d0c2e87d779096_2215223970275727766)
