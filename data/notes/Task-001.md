# CustomerPortrait: néma elutasítási hurok

## 3.7.0 — az eredeti probléma (17 felhasználó)

1. FaceKom munkamenet elindult ✅
2. voice-liveness-check (élő hang/arc) ✅
3. deepfake-detection ✅
4. a szerver elküldi a `customerPortrait` lépést ✅
5. ennél a lépésnél az SDK újracsatlakozik (`connecting → connected`)
6. **FaceKomSDK.FaceKomError 46 — timeOut (időtúllépés)**
7. a felhasználó újrakezdi, az integritás-ellenőrzés megszakad
8. ismét voice → deepfake → portré, és **ismét timeOut**…

**Statisztika (3.7.0):**
- Legrosszabb eset: 1 felhasználó **22 portré-próbálkozás** 5 teljes cikluson át, sosem sikerült.
- Sikeresség: **csak 4/17 (23%)** ment át végül.
- Nincs megfigyelhető különbség a sikeres és az elakadt munkamenetek közt — szerverfüggőnek tűnik.
- (A 3.7.0-s munkamenetekhez **nincs FaceKom azonosító**, csak Firebase azonosító.)

## 3.7.1 — frissített kép (2026-06-01-i újragyűjtés)

**A hurok továbbra is létezik, de már szinte mindig sikerrel zárul.** 31 FaceKom munkamenet futott bele a customerPortrait-hurokba, és **30/31 (≈97%) végül jóváhagyva lett** (3.7.0-ban ez 23% volt).

- A próbálkozásszám viszont magas maradt: a legrosszabb esetben **34 portré-próbálkozás** egyetlen munkameneten belül (`9071cd7a…`), egy másiknál **19 + timeOut** (`70ed4a7d…`) — vagyis az élmény még mindig rossz, de a végén átmegy.
- Explicit `timeOut (46)` már csak 2 munkamenetnél fordult elő, és ott is jóváhagyással zárult.
- **Egyetlen 3.7.1-es munkamenet sem akadt el magán a customerPortrait lépésen.** A jóvá nem hagyott `17001e11…` valójában **átment a portrén**, és utána a **2-factor** lépésnél morzsolódott le (háromszor háttérbe tette az appot, majd bezárta) — ez tehát nem portré-hiba (lásd Task-004).

**Következtetés:** a 3.7.0-s néma elutasítási hurok a 3.7.1-ben **gyakorlatilag megszűnt** (a portré ~100%-ban átmegy); ami maradt, az a túl sok újrapróbálkozás okozta rossz UX.

## Bizonyíték a produkciós ellenőrzéshez
A csatolt munkamenetek FaceKom azonosítói + időbélyegei a 3.7.1-es mintából származnak — az exportált fájl „Érintett FaceKom munkamenetek” szakasza tartalmazza őket, produkciós visszakereséshez.
