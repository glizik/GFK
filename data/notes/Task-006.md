# invalidToken on FaceKom session start

**Affected:** 2 unique users

## What happens

1. User scans QR code to start the eSzigno session
2. FaceKom getSettings success
3., selfService.auth(token — auth call fails:
   `Facekom auth error: invalidToken`

4., probably token is expired (expiration time is 30 days)

Maybe there could be a better error message. Maybe the expiration date could be shown on the portal page.
