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

## Involved Sessions:

- #1  a6199c3bc3394564ad8dd4800eb5dbd2  2026-05-14 16:14
- #2  b925430ec0b54c98ba8dbcca26bd63b3  2026-05-15 09:19
- #3  6b32fadd48d24f6f8cca0321523cdc6f  2026-05-14 10:29
- #4  b016119a97264307ba5e8eca9cfcb316  2026-05-26 10:56
- #5  46bfd18f6b5744b8a26c3a88fdc5aa79  2026-05-18 12:38
- #6  92b09562685541498d6b4875a0d88f69  2026-05-21 11:46
- #7  cee4a5d0ef954359a7f407964d2bf4e9  2026-05-26 14:53
- #8  902291c91eba449195e4ec5a97fd3066  2026-05-22 12:42
