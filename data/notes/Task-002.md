# CustomerPortrait: integrity check abort


**Affected:** 65 sessions

## What happens

1. User passes voice-liveness-check ✅ and deepfake-detection ✅
2. Gets to `customerPortrait` — server returns immediate integrity check failure:
   `FaceKom failed integrity check at step: customer-portrait, aborted`
3. No retry, SDK aborts with *"Ismeretlen hiba történt!"*
4. App internally reports the stuck step as `voiceLivenessCheck` (confusing mismatch)
5. Can happen on **attempt #2** even after passing all prior steps on attempt #1

## Root cause (hypothesis)

Server-side biometric consistency check: the face portrait captured at `customerPortrait` is flagged as inconsistent with the deepfake-detection selfie from earlier. Possible triggers:

- User moved or changed lighting between the two capture steps
- Camera angle shifted (notable: 69 sessions from iPhone SE with smaller screen)
- Different face distance between deepfake and portrait frames

## Suggested fix

- Surface a specific, actionable message: *"We couldn't verify your face. Please ensure good lighting and look directly at the camera."*
- Allow one retry with fresh deepfake + portrait capture instead of forcing full QR restart
- Log the specific reason for the integrity check failure on the backend for easier debugging
