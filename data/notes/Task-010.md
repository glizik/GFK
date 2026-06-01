# QR újraolvasás befejezés után újraindítja a folyamatot

## A hiba
Ha a felhasználó **sikeresen befejezte** az azonosítást (jóváhagyva), majd **újra beolvassa
ugyanazt a QR-kódot**, az alkalmazás **újraindítja a teljes folyamatot**, mintha új azonosítás
lenne — ahelyett, hogy „érvénytelen QR” / „az azonosítás már elkészült” üzenetet mutatna.
Az így indított felesleges menet jellemzően a `voice-liveness-check` lépésnél elakad (a szerver
60 mp után `consent timer expired`-del bontja), és hibás „megszakítva” bejegyzést hagy maga után.

## Bizonyíték (3.7.1)
- **`7ca246b5-86c9-4288-a16f-3a701560846e`**: az első menet (`da49e5c8…`) **13:54–14:04 között
  jóváhagyva**; majd **14:20-kor ugyanazt a QR-t újraolvasva** (`d25474e9…`) a folyamat
  újraindult → `consent timer expired`. Ugyanaz a személy, ugyanaz a QR.

## Szűrő — mely munkamenetek tartoznak ide
3.7.1-es FaceKom munkamenetek, ahol egy menet **jóváhagyással** zárult, és **ugyanaz a FaceKom
azonosító** a befejezés **után** újabb menetet indított. Jelenleg **4 ilyen felhasználó**:
`7ca246b5`, `70ed4a7d`, `4dbaa2df`, `788df0ca`.

## Javasolt javítás
A folyamat indítása előtt ellenőrizni kell az azonosítás állapotát: ha az adott QR/azonosítás már
`finished`, az app mutasson „érvénytelen / már elkészült” képernyőt, és **ne** induljon újra.

## Hatás
A felesleges újraindulások „megszakítva” eseményként jelennek meg, ami **mesterségesen rontja a
megszakítási statisztikát** — valójában már sikeres azonosításokról van szó.
