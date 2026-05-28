# Hard fail: face-detection-error and photo limit exhausted

**Priority:** Medium | **Category:** Backend | **Resolution:** Open

**Affected:** 50 face-detection-error + 22 photo-limit = **72 sessions total**

## face-detection-error (50 sessions)

Server returns `end(status: "failed", reason: "face-detection-error")` after deepfake-detection.

User sees: *"Hibakód: 0006 — A QR-kód leolvasásával indítsa újra a folyamatot!"*

No in-app recovery — user must go back to the portal and scan QR code again.

## no-more-photo-candidate-allowed (22 sessions)

User exhausted all allowed photo retries (idFront or idBack).

User sees: *"A képkészítésre rendelkezésre álló próbálkozások száma elérte a maximumot"*

Same hard QR-restart required.

## Root cause

**face-detection-error:** The selfie captured during deepfake step didn't meet the server-side face quality threshold. No in-app recovery path exists.

**Photo limit:** User couldn't capture an acceptable ID photo within the allowed attempts — likely due to glare, blurry capture, or not all corners visible.

## Suggested fix

- Before forcing QR restart, offer one in-app session retry (reuse existing auth token if still valid)
- For photo limit: before the last attempt, show a help screen with tips (flat surface, no glare, all 4 corners visible, remove case if reflective)
- Provide a contact/support path when hard failures occur — currently users just get stuck

## Involved Sessions (click to open in Firebase)

Open on production Firebase (admin access required):

- [a6199c3bc3394564…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=a6199c3bc3394564ad8dd4800eb5dbd2_2218195327879372873)
- [b925430ec0b54c98…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=b925430ec0b54c98ba8dbcca26bd63b3_2218459298021756716)
- [6b32fadd48d24f6f…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=6b32fadd48d24f6f8cca0321523cdc6f_2218107828933727124)
- [b016119a97264307…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=b016119a97264307ba5e8eca9cfcb316_2222567271062038766)
- [46bfd18f6b5744b8…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=46bfd18f6b5744b8a26c3a88fdc5aa79_2219624648769475204)
- [92b0956268554149…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/66ab9689c1addf4cdac8881ddf52eff2?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=92b09562685541498d6b4875a0d88f69_2220727338176158406)
- [cee4a5d0ef954359…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=cee4a5d0ef954359a7f407964d2bf4e9_2222628437659107887)
- [902291c91eba4491…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=902291c91eba449195e4ec5a97fd3066_2221110280843776977)
