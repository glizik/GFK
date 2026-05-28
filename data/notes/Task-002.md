# CustomerPortrait: integrity check abort

**Priority:** High | **Category:** Backend | **Resolution:** Open

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

## Involved Sessions:

- 19013e43639d4a138a1524ddc0af2eb8  2026-05-15 11:41
- 56c09dc0326f4db697c83d586197dc14  2026-05-15 11:44
- 05dd8149937448f3b80e5259d65e6f0e  2026-05-07 12:45
- fd4995ce0e504200965f156a215fa892  2026-05-06 15:56
- 3090f20443824088bb542437fdb400b7  2026-05-18 10:25
- 9c0a89f6ae4f4139b1692ac3dfd2ce08  2026-05-19 08:29
- 01e1702142aa48a0a42b781e14e8f64c  2026-05-21 14:28
- 8b3096e80cc74af3a6f2996d3cce76b3  2026-05-26 11:49
- fd1eb6af3f9340faaa6b5d16c08f6bce  2026-05-26 14:07
- 9ac283a89a204eeebcded1eda49b1dbd  2026-05-24 18:28
- 98468590192443a5ba434259fb6a6a2e  2026-05-12 13:05
- b1bd0be7be9b4a35b3378fb91808c2e1  2026-05-07 12:36
