# twoFactor background: 44% abandonment

**Priority:** Medium | **Category:** iOS | **Resolution:** Open

**Affected:** 478 sessions backgrounded at 2FA step; **209 (44%) never returned**

## What happens

1. User reaches the final `twoFactor` step (SMS/OTP entry)
2. Switches apps to find the code — app goes to background
3. SDK reconnects: `connecting → connected`
4. Server resends `twoFactor` as `retry Step`
5. **269 users (56%) come back and finish** ✅
6. **209 users (44%) don't return** — session expires

## Why users abandon

The reconnect animation almost certainly looks like a crash or error to most users. They see activity in the status bar, the screen changes state, and assume the process broke. Nothing tells them the session is being held for them.

## Suggested fix

- Show a persistent banner during reconnect: *"Don't close the app — retrieving your session…"*
- After reconnect and twoFactor step is restored, briefly animate the input field to draw attention
- Consider a local push notification if user is backgrounded for >30 seconds at twoFactor: "Your session is waiting — tap to continue"
- Extend the session hold timeout if the server allows it

## Involved Sessions (click to open in Firebase)

Open on production Firebase (admin access required):

- [06acfcb2dd14490a…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=06acfcb2dd14490aa6278ca3498925d6_2218579699198365922)
- [f805da77bb7a4eff…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=f805da77bb7a4eff90df03c5561abb24_2218122663659140089)
- [e7d1282d65924bd3…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=e7d1282d65924bd38e7d2123b475bb81_2220312293504014532)
- [e4a8c6156a994e50…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=e4a8c6156a994e50a99c89cf0ab6dbe4_2222558651925645975)
- [154e956da14e4e72…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=154e956da14e4e72b4446e91bb1e21ea_2217085018609029385)
- [af7adfbbc65f4fc6…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=af7adfbbc65f4fc6afa9d2dcd59d7ff1_2218122466237710140)
- [62ff675ee30a4649…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=62ff675ee30a4649b10222ccda2ec186_2220352161069438828)
- [2a1dfd2da0f04c9b…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=2a1dfd2da0f04c9bb3b18e09b5cc90e2_2217724710508659590)
- [27b32b0973554fcc…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=27b32b0973554fccac7370927165a4cd_2217371531809500731)
- [d855ffeb23df4222…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=d855ffeb23df42229ac62154598cb684_2215582165154989089)
- [fbde568287364955…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=fbde568287364955a65ab50852e675ae_2220714957627822096)
- [3f5e5a5e52d9451f…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=3f5e5a5e52d9451fb93bcc332120c133_2218236811500912531)
- [3ad863ca05a846b9…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=3ad863ca05a846b9bf9bae40d831db6d_2217517007833489951)
- [bec4135e944c4561…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=bec4135e944c4561b428b3917f569783_2215142071704559894)
- [3a9de29b82a54e7c…](https://console.firebase.google.com/project/webszigno-dev-1532086359290/crashlytics/app/ios:hu.microsec.eszigno.mobile/issues/1782c2128a0148281dace39bf8664159?time=90d&versions=3.7.0+%282753%29&types=error&sessionEventKey=3a9de29b82a54e7cb2c3d65c234467ee_2219987161400338589)
