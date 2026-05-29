# Non-Approved Sessions — Cause Analysis & Logging Recommendations

_Generated 2026-05-29 from `events_3.7.0.csv` + `events_3.7.1.csv` (571 unique Firebase sessions, 1,664 event logs)._

## 1. Where sessions stand

| Outcome | Sessions | % |
|---|---|---|
| **Approved** | 462 | 80% |
| Aborted (user closed / backgrounded mid-video) | 74 | 12% |
| **No-finish** (no outcome recorded at all) | 25 | 4% |
| Failed (server rejected) | 10 | 1% |
| **Non-approved total** | **109** | **19%** |

The 80% approval rate is healthy. The interesting bucket is **no-finish (25 sessions)** — these are sessions where we have breadcrumbs but **no `Facekom finished with state:` line was ever recorded**. That is the symptom you hit with the 7m54s session: the user finished on the server, but the iOS app never recorded the outcome.

## 2. Two confirmed iOS bugs that lose data

### Bug A — `.end` event silently dropped on a dead presenter (the real leak)

In `setup()` the SDK listener captures `[weak self]`:

```swift
selfService.setListener(identifier: mainFaceKomStep) { [weak self] event in
    guard let self else { return }   // ← if presenter is gone, EVERYTHING is dropped
    switch event {
    case .nextStep(let step): handleNextStep(step) ...
```

`reportAndShowFinish()` — the **only** place `SelfServiceRuntimeError.sessionFinished` is recorded to Crashlytics — lives behind that `guard`. Sequence that loses the event:

1. User backgrounds → `didEnterBackground()` → `close()` → `stopAndClear()` → `clearSelfService()` → `flowHandler.completion(.close)` → **view controller dismissed, presenter deallocated**
2. The server's `.end(status: "finished")` arrives a few hundred ms later
3. `guard let self else { return }` fires → `handleNextStep` → `reportAndShowFinish` **never runs**
4. No Crashlytics event. The approved session vanishes from our data entirely.

**13 sessions** in the current data show "backgrounded, no finish recorded" — the in-data tip of this iceberg. The fully-lost ones (like your 7m54s case) can't even be counted because no event exists.

**Fix:** record the finish synchronously inside the listener, before `guard let self`, for the terminal case:

```swift
selfService.setListener(identifier: mainFaceKomStep) { [weak self] event in
    if case .nextStep(let step) = event, case .end(let status, let extra) = step {
        // Record terminal state independent of presenter lifecycle
        let state = Self.videoAuthState(forStatus: status, additionalData: extra) // make this static/pure
        let err = SelfServiceRuntimeError.sessionFinished(state: state)
        Crashlytics.crashlytics().log(err.localizedDescription)
        Crashlytics.crashlytics().record(error: err)
    }
    guard let self else { return }
    ...
}
```

### Bug B — double `stopAndClear` race (`isAlreadyClosed` set asynchronously)

```swift
func close() {
    Crashlytics...log("FaceKom user initiated closing, isAlreadyClosed: \(isAlreadyClosed) ...")
    if isAlreadyClosed { return }
    Task { await stopAndClear() }   // isAlreadyClosed=true only happens *inside* this async task
}
```

`isAlreadyClosed = true` is set in `clearSelfService()`, which runs **inside the async `Task`**. If `close()` is called twice before that task runs (e.g. `didEnterBackground` + an SDK close in the same run-loop tick), both calls read `false`, both pass the guard, both launch `stopAndClear()`.

**23 events** show two `isAlreadyClosed: false` close calls within the same second — confirmed races. Each fires an extra `FaceKom stopAndClear (0)` Crashlytics event, inflating that issue's counts.

**Fix:** set the flag synchronously at the top of `close()`:

```swift
func close() {
    Crashlytics...log(...)
    if isAlreadyClosed { return }
    isAlreadyClosed = true          // ← set before the Task
    if !isVideoStep { disconnectSelfService(reason: "close while not in video step"); return }
    Task { await stopAndClear() }
}
```
(Then drop the now-redundant `isAlreadyClosed = true` reassignment in `clearSelfService()`, or keep it as a harmless belt-and-braces.)

## 3. What's actually *not your fault*

- **Consent timer expired — 20 sessions (14 of them non-approved):** the backend went silent for 60s waiting for `voiceDetection`/`faceDetection`, then your `resetConsentTimeoutTimer` fired `disconnectSelfService`. The user did nothing wrong; the backend never sent the detection message. These are **backend stalls**, not user drop-offs.
- **`selfService.stop()` threw — 22 sessions:** the SDK's `stop()` rejects ("The operation couldn't be completed"), so `stopAndClear()` always lands in its catch branch. Not fatal, but it means the clean stop path essentially never succeeds and the recorded error is generic.
- **invalidToken — 3 sessions:** expired/re-used QR. Genuine user error, safe to ignore.

## 4. The #1 logging gap: no backend-correlatable ID

**There is no shared identifier between our breadcrumbs and the backend's session record.** The only IDs we capture are the Firebase session hash and the QR URL (`setUserID`). `availableStreamIDs` is always `nil`. That's why pairing your server's 14:26 session to our data is manual guesswork.

The single highest-value change you can make: **log the FaceKom room/session/socket ID** the SDK gets back from `connectSocket`/`auth`/`getSettings`. One line:

```swift
Crashlytics.crashlytics().log("FaceKom room/session id: \(settings.<roomOrSessionId>)")
Crashlytics.crashlytics().setCustomValue(<roomId>, forKey: "facekom_room_id")
```

If that ID also exists server-side, server↔client pairing becomes a lookup instead of a timestamp hunt.

## 5. Recommended log additions, ranked

1. **Backend room/session ID** as a Crashlytics custom key (`facekom_room_id`) — enables direct server pairing. *Highest value.*
2. **Log the actual `stop()` error**, not the generic string: `record(error:)` already does, but add `setCustomValue(error.localizedDescription, forKey: "stop_error")` so it's filterable.
3. **Emit a breadcrumb the instant `.end` arrives**, before any UI/dealloc work (see Bug A fix) — guarantees the outcome is always captured.
4. **Tag the disconnect cause** as a custom key: `setCustomValue(reason, forKey: "disconnect_reason")` for `consent timer expired` / `close` / `network` — turns §3 buckets into a one-click Crashlytics filter instead of breadcrumb grep.
5. **Log a monotonically increasing `close_call_seq`** in `close()` — makes the double-close race unambiguous in the timeline (you'll see seq 1 and seq 2 at the same timestamp).

## 6. Suggested next step

Fix **Bug A** first — it's the one that makes approved sessions disappear, which is exactly the case you couldn't find. After it ships, the no-finish bucket should shrink and the missing-approval sessions should start appearing in Crashlytics. Bug B is lower-stakes (it only adds duplicate abort noise, never loses an approval).
