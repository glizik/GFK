# CustomerPortrait: néma elutasítási hurok

## Szűrő — mely munkamenetek tartoznak ide
3.7.1-es FaceKom munkamenetek, ahol a `customerPortrait` lépést a szerver **legalább 2×
kiküldte** (= a portrét újra kellett próbálni → hurok), **VAGY** a portrénál `timeOut (46)`
történt. A breadcrumb-ok **időbélyeg + üzenet szerint deduplikálva** vannak, így a duplikált
crash-riportok **nem** számítanak külön próbálkozásnak. Új gyűjtés után ugyanezzel a szűrővel
frissíthető a lista.

## 3.7.0 — az eredeti probléma (17 felhasználó)

1. FaceKom munkamenet elindult ✅
2. voice-liveness-check ✅ → 3. deepfake-detection ✅
4. a szerver elküldi a `customerPortrait` lépést ✅
5. az SDK újracsatlakozik (`connecting → connected`)
6. **FaceKomSDK.FaceKomError 46 — timeOut**
7. a felhasználó újrakezd, az integritás-ellenőrzés megszakad
8. ismét voice → deepfake → portré, és **ismét timeOut**…

**Statisztika (3.7.0):** legrosszabb eset **22 portré-próbálkozás**, sosem sikerült; sikeresség
**csak 4/17 (23%)**. (A 3.7.0-s munkamenetekhez nincs FaceKom azonosító, csak Firebase azonosító.)

## 3.7.1 — frissített kép (2026-06-01-i újragyűjtés, pontosított szűrővel)

A fenti szűrőnek **9 FaceKom munkamenet** felel meg (nem 31 — a korábbi laza szűrő tévesen
behúzott 26 olyan munkamenetet is, amely a portrét **egyszer** érte el és simán átment, pl. a
duplikált riportok miatt).

- **A 9 hurkos munkamenetből 9 (100%) végül jóváhagyva lett** (3.7.0-ban ez 23% volt).
- A legtöbb portré-újraküldés deduplikálás után **5** (`70ed4a7d…`, `9071cd7a…`) — tehát kb. 5
  próbálkozás, **nem** a korábban tévesen jelentett 34.
- Explicit `timeOut (46)` 2 munkamenetnél (`70ed4a7d…`, `59f66bf9…`), mindkettő jóváhagyással zárult.

**Következtetés:** a 3.7.0-s néma elutasítási hurok a 3.7.1-ben **gyakorlatilag megszűnt** — minden
hurkos munkamenet átment a portrén; ami maradt, az a néhányszori újrapróbálkozás okozta UX-súrlódás.

## Bizonyíték a produkciós ellenőrzéshez
A csatolt 9 FaceKom munkamenet azonosítója + időbélyege az exportált fájl „Érintett FaceKom
munkamenetek” szakaszában van, produkciós visszakereséshez.
