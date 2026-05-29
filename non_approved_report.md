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

**Fix (flag-free):** record the finish synchronously inside the listener, before `guard let self`, and make every terminal event have exactly one recorder — decided by *which path produced it*, not by runtime state.

Server `.end` and client-side aborts are mutually exclusive, so no `didReportFinish` flag is needed:

- **Server `.end`** → recorded in the listener (the lifecycle-safe point), nowhere else.
- **Client-side aborts** (integrity fail, invalid step, portraitError…) never arrive as `.end` → they keep recording in `reportAndShowFinish`.

**Step 1 — pure initializer (the single status→state mapping, no side effects):**

```swift
extension VideoAuthState {
    /// Pure: no logging / Crashlytics — safe to call from the SDK listener where `self` may be gone.
    init(serverStatus status: String, additionalData: Any?) {
        switch status {
        case "finished": self = .finished
        case "expired":  self = .expired
        case "failed":
            if let dict = additionalData as? [String: Any], let reason = PhotoRecognitionError.from(dict) {
                self = .failed(title: L10n.Video.Step.Aborted.Error.title,
                               subtitle: L10n.Video.Finish.Error.subtitle.uppercased(),
                               message: reason.getMessage())
            } else if let reason = RoomClosedError.from(String(describing: additionalData)) {
                self = .failed(title: reason.title, subtitle: reason.subtitle)
            } else { self = .failed() }
        default: // "aborted" + unknown (absorbs the old `Status(rawValue:) ?? aborted`)
            var message: String?
            if let s = additionalData as? String, s != "nil" { message = RoomClosedError.from(s).debugDescription }
            self = .aborted(message: message)
        }
    }
}
```

**Step 2 — record once in the listener, before `guard let self`:**

```swift
selfService.setListener(identifier: mainFaceKomStep) { [weak self] event in
    Logger.dev.info("FaceKom \(mainFaceKomStep) -> event \(String(describing: event))")
    if case .nextStep(let step) = event, case .end(let status, let extra) = step {
        Crashlytics.crashlytics().setCustomValue(status, forKey: "STATUS")
        let state = VideoAuthState(serverStatus: status, additionalData: extra)
        let finished = SelfServiceRuntimeError.sessionFinished(state: state)
        Crashlytics.crashlytics().log(finished.localizedDescription)
        Crashlytics.crashlytics().record(error: finished)
    }
    guard let self else { return }
    switch event { case .nextStep(let step): handleNextStep(step); ... }
}
```

**Step 3 — `handleNormalStep`'s `.end` shows UI only (listener already recorded):**

```swift
case .end(let status, let additionalData):
    selfService.disconnect()
    selfService.clearToken()
    delegate?.showFinish(VideoAuthState(serverStatus: status, additionalData: additionalData))
```

`reportAndShowFinish` is unchanged and keeps recording — it's now only reached by client-side abort paths, which the listener's `.end` branch never touches. Each terminal event is recorded exactly once, with no shared flag to keep in sync.

| Terminal event | Recorded by | UI shown by |
|---|---|---|
| Server `.end`, presenter alive | listener | `handleNormalStep.end` → `showFinish` |
| Server `.end`, presenter dead (the leak) | listener ✓ | — (app backgrounded) |
| Client abort (integrity / invalid step) | `reportAndShowFinish` | `reportAndShowFinish` |

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

---

# Addendum — code review of `SelfServicePresenter` / `SelfServiceViewController` (2026-05-29)

## A. Double-close source confirmed (Bug B root cause)

`SelfServiceViewController` calls `presenter?.close()` from **two** lifecycle hooks:

```swift
override func viewWillDisappear(_ animated: Bool) { super...; presenter?.close() }
@objc private func didEnterBackground() { presenter?.didEnterBackground() }  // → close()
```

When the user backgrounds the app, iOS frequently fires **both** `didEnterBackgroundNotification` *and* `viewWillDisappear` in the same run-loop tick. Both call `close()`. Because `isAlreadyClosed = true` is only set asynchronously inside `stopAndClear()→clearSelfService()`, both calls pass the `if isAlreadyClosed { return }` guard → two `stopAndClear()` tasks. This is the 23 same-second double-close races.
**Fix:** set `isAlreadyClosed = true` synchronously at the top of `close()` (see Bug B above).

## B. Consent timer — the real edge case (task_t3)

Confirmed in the data: of 20 consent-timeout sessions, **4 were spurious** — detection messages and step transitions kept arriving *after* the 60 s timer fired, and **2 of those went on to be approved anyway**. Example `3cc573bc`:

```
10:57:11  handleNewMessageStep: detection:status:face   ← fresh task, timer just reset
10:57:12  session disconnected: consent timer expired    ← fires 1s later (impossible for a fresh 60s timer)
10:57:40  detection:status:card → nextStep: customerPortrait → idFront  ← user sailed past consent
```

A freshly-reset 60 s timer cannot fire one second later. The firing timer is a **stale/already-queued `Timer`**:

- `resetConsentTimeoutTimer()` does `consentTimer?.invalidate()` + reschedule, but **`Timer.invalidate()` cannot cancel a fire that has already been enqueued on the run loop.** If the old timer fired microseconds before the reset, its callback still runs.
- `Timer.scheduledTimer` attaches to the **current** run loop/thread. If the SDK delivers `.stepMessage` events on a background queue (likely — the listener closure isn't hopped to main), the timer is scheduled on a non-main runloop and invalidation from a different thread is unreliable. This is the classic source of "timer fires right after I reset it."

**Robust fix (thread-agnostic): make the fire a guarded check, not an unconditional disconnect.**

```swift
private var lastDetectionAt = Date()

private func noteDetectionActivity() { lastDetectionAt = Date() }   // call in handleNewMessageStep

private func resetConsentTimeoutTimer() {
    consentTimer?.invalidate()
    consentTimer = Timer.scheduledTimer(withTimeInterval: consentTimeoutInSec, repeats: false) { [weak self] _ in
        guard let self else { return }
        // Guard against a stale/queued fire: only disconnect if truly idle.
        let idle = Date().timeIntervalSince(lastDetectionAt)
        Crashlytics.crashlytics().log("consent timer fired, idle=\(Int(idle))s, step=\(currentStep.rawValue)")
        guard idle >= consentTimeoutInSec - 2 else {
            resetConsentTimeoutTimer()   // false alarm — re-arm
            return
        }
        disconnectSelfService(reason: "consent timer expired (idle \(Int(idle))s)")
    }
}
```

Also schedule/invalidate the timer **on the main thread** (`DispatchQueue.main.async`) so it lives on the main run loop, and **invalidate the consent timer in `handleNextStep`** (step transitions) so a step-N timer can never fire during step N+1.

The remaining **16/20** consent timeouts were genuinely idle — 60 s with zero detection messages (backend stall or user walked away). For those, consider a soft "Are you still there?" prompt before the hard disconnect rather than silently killing the session.

> Note on your "let them continue on head-up" idea: only **1/20** timeouts had head-movement `guide` messages flowing in the final 60 s, so resetting the timer on `guide` would help very few. The bigger win is the stale-timer guard above (4/20) + the soft prompt for the idle 16/20.

## C. Why `stop()` throws (task_t8)

`selfService.stop()` is a **network** operation. It's called from `stopAndClear()`, which runs inside `close()` — i.e. exactly when the user just backgrounded or dismissed. iOS suspends networking on background, so the call can't reach the backend. Error codes from the 22 sessions:

| FaceKomError code | meaning | count |
|---|---|---|
| 46 | `timeOut` | 92 |
| 3 | `networkError` | 19 |
| 43 | `notAuthorized` | 9 |

`timeOut`+`networkError` (111/120) = the backend was unreachable because the app was backgrounding. `notAuthorized` = token already cleared. **This is mostly not fixable** — you can't do a clean network teardown while suspended. Two mitigations:
1. Wrap the teardown in a `UIApplication.beginBackgroundTask` so `stop()` gets ~5–25 s of network time after backgrounding before iOS suspends.
2. Log the code explicitly: `setCustomValue("\(error)", forKey: "stop_error")` so timeOut-on-background can be filtered out from genuine stop failures.

The double-close (§A) inflates this count too — each duplicate `stopAndClear()` fires its own (failing) `stop()`. Fixing Bug B will roughly halve the `FaceKom stopAndClear (0)` event volume.
