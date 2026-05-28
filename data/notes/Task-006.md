# invalidToken on FaceKom session start


**Affected:** 2 unique users (6 invalidToken + 6 notAuthorized events — multiple errors per session)

> Note: the original estimate said "12 sessions" but these 12 crash events belong to only 2 distinct users.
> Each user hit the token error repeatedly across multiple attempts within the same session.

## What happens

1. User scans QR code to start the eSzigno session
2. FaceKom starts within seconds — auth call fails immediately:
   `Facekom auth error: invalidToken`
3. SDK stops and shows abort: *"Ismeretlen hiba történt!"*
4. User has no recovery path — session is dead

## Root cause

The FaceKom auth token embedded in the QR code was already invalid when the user scanned it. Log evidence: Session #1 went from QR scan to `invalidToken` in **27 seconds** — far too fast for a client-side expiry. iOS calls `auth(token: configuration.token, ...)` immediately in `loadConfig()` with no delay and no refresh mechanism. Both retry attempts in the same session failed with the same token, confirming it was dead on arrival.

The token is issued by the backend when generating the QR code. If the QR was generated with a short-lived or already-expired token, no amount of client-side changes can fix it.

## Suggested fix

- Investigate token TTL at QR generation time — ensure the token is valid for at least the expected session duration
- Add server-side token validation before embedding in QR: reject or re-issue if token is already near expiry
- Consider allowing the client to request a fresh token if `invalidToken` is received, rather than hard-failing
