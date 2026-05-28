# Consent timer expired at voice-liveness-check

**Priority:** High | **Category:** iOS | **Resolution:** Open

**Affected:** 81 sessions

## What happens

1. FaceKom starts, user gets `voice-liveness-check` as first step
2. Camera opens, WebRTC starts
3. Server waits for BOTH face + voice detection consent within 60 seconds
4. One or both detections never fire:
   - `voice: nil, face: detected` — camera works but microphone doesn't
   - Multiple guide messages loop — server keeps sending "head-on" guidance but detection never triggers
5. After 60 seconds: `"user waited for more than 60 seconds for detection"`
6. Session disconnects silently — user sees a frozen-looking screen

## Notable cases

- 2 sessions lasted **62 minutes** total — users kept returning and hitting the same wall
- 2 sessions lasted **17 minutes** across multiple restarts with the same consent timeout

## Root cause

Either microphone permissions not granted (iOS audio permission prompt may not appear during FaceKom WebRTC session) or environmental factors: dark room, strong background noise, or user holding phone too far from face.

## Suggested fix

- Show a visible countdown during consent phase so user knows something is expected of them
- Check microphone permission state *before* starting WebRTC; prompt user proactively if denied
- After 20 seconds without detection, show in-screen guidance: "Speak clearly" / "Move to better light"
- Distinguish clearly between "waiting for voice" and "waiting for face" so user knows what to do

## Involved Sessions:

- 3cc573bc657647d988dfc203730e24fb  2026-05-18 10:56
- af7adfbbc65f4fc6afa9d2dcd59d7ff1  2026-05-14 11:28
- a5bb2495cdfc4234a80fd6ff844aa07d  2026-05-19 06:38
- cf9ed4271cbd450d8e8e4398efa598b3  2026-05-18 17:06
- 398b5de1c5f54daa83bbeec0ae5d0ad0  2026-05-11 09:14
- 0b15a688bc234caa8334eef90c6370de  2026-05-15 16:45
- 4c1b5aabca884971a8eccf24c4467261  2026-05-12 17:08
- 09e010a133e84d389004c1e00d8bd4a2  2026-05-19 09:07
- f80eea1e0f1542d5b59a5f6d78fa8a95  2026-05-13 11:04
- 60207f55a2d54af4b9be02d0d764ecf2  2026-05-21 20:21
- 799b7fc864d24ba284d472d958f6d4aa  2026-05-15 05:48
- 86f635e26f0a42558400197d246e59e1  2026-05-15 09:07
- ece0959c521f4d1388971c0f120c271d  2026-05-14 21:11
- e1a25d8a903642369caed88985cccdf7  2026-05-20 12:58
- 7b20ea8a605e484987e888f7b0865299  2026-05-15 09:30
- 6ed57167178442218855fd791450a3e8  2026-05-18 11:20
- 53a1fd6e6c8f48fcbde048c4d25d6c23  2026-05-14 13:21
- 637ffe088dcd47e4a4bff9b4225fefb1  2026-05-21 15:15
- ff748b4f5b3c4be9b97c7cc11ac23c85  2026-05-11 18:48
