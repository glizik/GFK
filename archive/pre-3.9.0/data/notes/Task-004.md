# twoFactor background: 44% abandonment


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
