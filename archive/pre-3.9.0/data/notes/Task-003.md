# Consent timer expired at voice-liveness-check


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
