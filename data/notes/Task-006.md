# invalidToken on FaceKom session start

**Priority:** Medium | **Category:** iOS | **Resolution:** Open

**Affected:** 6 invalidToken + 6 notAuthorized = **12 sessions**

## What happens

1. User navigates through pre-FaceKom screens (EULA, login, package upgrade — 4+ minutes possible)
2. FaceKom starts — auth call fails immediately:
   `Facekom auth error: invalidToken`
3. SDK stops and shows abort: *"Ismeretlen hiba történt!"*
4. User has no recovery path — session is dead

## Root cause

The auth token granted at the start of the eSzigno session expired before FaceKom consumed it. Users who spent extra time on pre-FaceKom screens hit this expiry window. The token is obtained at session creation but only consumed when `startSelfService()` is called — if the user lingers on intermediate screens, the token goes stale.

## Suggested fix

- Refresh / re-issue the FaceKom auth token immediately before calling `startSelfService()` instead of reusing the one from session creation
- Add a token expiry check with a 30-second buffer — silently refresh if it's about to expire
- If refresh fails, show a graceful *"Your session expired — please go back and try again"* instead of *"Unknown error"*

## Involved Sessions:

- 21177932b7d94921a3f2dcbeb3d080f0  2026-05-08 14:25
- d4770950c1b947b1a30818e9d36ba7d5  2026-05-26 13:47
