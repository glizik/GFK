# Crash: SWIFT TASK CONTINUATION MISUSE a FaceKom SDK socket-kapcsolatában

**Issue:** `738711ca2cdf94375b7a5cc6aeff47b2` · `$s10FaceKomSDK13FKSelfServiceC21uploadLivenessV2Photo…` · **EXC_BREAKPOINT**
**Hatókör:** 7 crash-esemény / 3 user (3.8.0, utolsó 90 nap). Az issue verzió-tartománya **3.5.2 – 3.8.0**, tehát régóta él.
**Készülék:** 100% iPhone, 100% iOS 26 · a vizsgált esemény: iPhone 15 Pro, iOS 26.5.2, 2026-07-31 09:09:44
**Kulcsok:** `PROD Release` (100%), indítás módja: `videoId` (100%)

Ez **valódi crash** (az app kilép), nem non-fatal hibajelentés — ezért nem is volt benne eddig
az adatbázisunkban (lásd lent).

## A hiba

```
_Concurrency/CheckedContinuation.swift:172: Fatal error: SWIFT TASK CONTINUATION MISUSE:
connectSocket(baseUrl:socketSettings:) tried to resume its continuation more than once returning ()!
```

Stack trace (fő szál):

```
0  libswiftCore.dylib        _assertionFailure(_:_:file:line:flags:) + 168
1  libswift_Concurrency      CheckedContinuation.resume(returning:) + 428
2  FaceKomSDK                FKSelfService.uploadLivenessV2Photo(image:) closure
3  FaceKomSDK                SocketIOManager.connectSocket(baseUrl:socketSettings:onCompleted:onError:) closure
4  FaceKomSDK                SocketIOManager.subscribeCommonEvents closure
5  SocketIO                  SocketIOClient.handleEvent(_:data:isInternalMessage:withAck:)
6  SocketIO                  SocketIOClient.handleClientEvent(_:data:)
7  SocketIO                  SocketIOClient.didConnect(toNamespace:payload:)
8  SocketIO                  SocketIOClient.handlePacket(_:)
9  SocketIO                  Manager._parseEngineMessage(_:)
12 libdispatch.dylib         _dispatch_call_block_and_release
```

A `connectSocket(...)` egy `withCheckedContinuation`-be csomagolja a socket-kapcsolódást, és a
continuation-t **kétszer folytatja**. A Swift runtime ezt mindig végzetes hibának tekinti — az
egész app azonnal kilép. Nincs benne user-hiba, és nem is elkerülhető kliens-oldalról:
**ez FaceKom SDK-hiba.**

## Mi történt a crash előtt (breadcrumbs, ugyanaz a Firebase session)

Firebase session `487e265556314210b5b275c3ef6ec97c` · FaceKom session `47bb5003-bfb4-47b1-bc78-10e305982f25`

```
09:09:17  FaceKom SelfService started
09:09:27  FaceKom getSettings success
09:09:27  FaceKom status changed: connecting
09:09:30  FaceKom status changed: disconnected
09:09:30  FaceKom connect socket error: timeOut          ← az első kapcsolódás timeoutol (3 mp)
09:09:31  UIAlertController                              ← hibaüzenet a usernek
09:09:44  FaceKom error: timeOut happened, stop and show abort
09:09:44  FaceKom status changed: connecting             ← a socket MÉGIS csatlakozik, későn
09:09:44  FaceKom failed to stop with error: networkError … currentStep: voiceLivenessCheck. Aborted.
09:09:44  Facekom finished with state: aborted(message: nil)
09:09:44  💥 CRASH
```

**A kiváltó ok tehát: a socket-kapcsolódás timeoutol, a continuation lefut a hibaággal — majd a
későn megérkező `didConnect` esemény ugyanazt a continuation-t másodszor is folytatja.**
Reprodukálás FaceKom oldalán: lassú/szakadozó hálózaton timeoutoltatni a `connectSocket`-et úgy,
hogy a kapcsolat utána mégis felépüljön.

A felhasználó szempontjából ez a legrosszabb végkifejlet: nem abortált session, hanem **kilépő app**.

## Miért nem volt benne az adatainkban

Két szűrő is kizárta:

1. `tests/discover-issues.spec.ts` alapból `types=error` (non-fatal) módban fut — a `types=crash`
   listát soha nem néztük.
2. A sorok szűrése a `mark.fire-highlight` elemre épült, ami csak a keresőkifejezés kiemelése —
   így csak olyan issue-k látszottak, amiknek a **címében** szerepel a "FaceKom". Egy valódi crash
   címe a crashelő stack-frame, nem tartalmazza a szót.

A 2. pontot javítottam: `ISSUE_BASE=""` esetén minden sort felvesz. Crash-lista lekérése:

```
HEADLESS=true ISSUE_BASE="" ISSUE_QUERY="" ISSUE_QUERY_TYPES=crash \
  ISSUE_VERSIONS="3.8.0 (2811)" ISSUES_CSV=./data/issues_crash_3.8.0.csv npm run discover
```

## Hatókör

A crash-lista a saját appunk hibáit is visszaadja (3.8.0-ban pl. egy `UITableView`-s
`NSInternalInconsistencyException`). Ezek **nem tartoznak ide**: se a `data/crashes.json`-be,
se a begyűjtésbe nem kerülnek — csak a FaceKom SDK-hoz köthető crashek.
