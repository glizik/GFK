# Deepfake-detection: lemorzsolódás (elakadás a face/card detectionnél)

## A mintázat
A nem-jóváhagyott (és breadcrumbbal rendelkező) 3.7.1 munkamenetek **#1 lemorzsolódási pontja** a
**deepfake-detection** lépés. A felhasználók eljutnak ide (a voice-liveness-check után), de **nem
jutnak túl rajta**: a face/card detection nem fejeződik be, és a user végül háttérbe teszi vagy
bezárja az appot, vagy a munkamenet egyszerűen elakad (nincs explicit lezárás).

**8 azonosítás (10 Firebase munkamenet)** esik ebbe a kategóriába. (A `consent timer expired` ettől
külön eset → Task-003.)

## Kiemelt eset
`853eeba9-3449-44b5-ab25-b413c58987ec` — **5 próbálkozás**, mindegyik a deepfake face-detectionnél
akadt el: megjelenik a `detection:status:face`, de nem lép tovább a card/next lépésre; a user 60–90
mp várakozás után bezárja. Tehát **nem feladta** — a detection nem ment át neki. (Működő
munkameneteknél ez a lépés ~8 mp alatt megy: face → card → következő.)

## Szűrő — mely munkamenetek tartoznak ide
3.7.1, nem jóváhagyott, van breadcrumb, NEM consent-timeout, és a **legtávolabb elért lépés a
deepfake-detection** (a customerPortrait lépést már nem érte el).

## Miért nem látjuk az OKOT (és mit kellene logolni)
A prod breadcrumb-ek a detection eredményét (`detection:status:face/card` → `message: success/fail`)
**levágva** tárolják, így nem derül ki, hogy a detection **bukott-e** (rossz fény / kamera /
algoritmus), vagy a user nem csinálta meg. → Érdemes a detection `success/fail` üzenetet teljes
értékkel logolni (lásd a happy-path / NOK log elemzést).
