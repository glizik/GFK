# CustomerPortrait: integritás-ellenőrzés megszakadása

Az újraindítási hurok (lásd **Task-001**) közben a FaceKom integritás-ellenőrzése (`failed integrity check at step: customer…`) megszakíthatja a folyamatot, ami a `customerPortrait` újrapróbálását kényszeríti ki.

## 3.7.0 — eredeti
Az integritás-ellenőrzés megszakadása a customerPortrait-hurok része volt (lásd Task-001, 7. lépés). A 3.7.0-s munkamenetekhez **nincs FaceKom azonosító**, csak Firebase azonosító.

## 3.7.1 — frissített kép (2026-06-01-i újragyűjtés)
Az újragyűjtött 3.7.1-es mintában **mindössze 1 munkamenet** mutatott integritás-ellenőrzési hibát (`failed integrity check at step: customer…`): **`70ed4a7d-ddb0-403b-b453-443ede483f93`** — és ez a munkamenet **végül jóváhagyva** lett (4 Firebase-próbálkozás után).

**Következtetés:** az integritás-ellenőrzés okozta megszakadás a 3.7.1-ben gyakorlatilag eltűnt; ahol mégis előfordul, ott a felhasználó újrapróbálkozással átjut.

## Bizonyíték a produkciós ellenőrzéshez
A csatolt FaceKom munkamenet azonosítója + időbélyege az exportált fájl „Érintett FaceKom munkamenetek” szakaszában található.
