# Hard fail: face-detection-error and photo limit exhausted


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
