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

## Involved Sessions:

- 06acfcb2dd14490aa6278ca3498925d6  2026-05-15 17:02
- f805da77bb7a4eff90df03c5561abb24  2026-05-14 11:29
- e7d1282d65924bd38e7d2123b475bb81  2026-05-20 09:06
- e4a8c6156a994e50a99c89cf0ab6dbe4  2026-05-26 10:24
- 154e956da14e4e72b4446e91bb1e21ea  2026-05-11 16:18
- af7adfbbc65f4fc6afa9d2dcd59d7ff1  2026-05-14 11:28
- 62ff675ee30a4649b10222ccda2ec186  2026-05-20 11:40
- 2a1dfd2da0f04c9bb3b18e09b5cc90e2  2026-05-13 09:45
- 27b32b0973554fccac7370927165a4cd  2026-05-12 10:54
- d855ffeb23df42229ac62154598cb684  2026-05-07 15:19
- fbde568287364955a65ab50852e675ae  2026-05-21 11:04
- 3f5e5a5e52d9451fb93bcc332120c133  2026-05-14 18:52
- 3ad863ca05a846b9bf9bae40d831db6d  2026-05-12 20:18
- bec4135e944c4561b428b3917f569783  2026-05-06 10:37
- 3a9de29b82a54e7cb2c3d65c234467ee  2026-05-19 12:04
