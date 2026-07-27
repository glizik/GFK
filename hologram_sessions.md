# Hologram-probléma szobák (SLAMSEC-19 / CAT 3)

**Forrás:** FaceKom iOS Crashlytics, 3.7.0 + 3.7.1, gyűjtve 2026-07-27.
**Mit tartalmaz:** minden olyan szoba, ahol a hologram lépésnél gond volt — vagy a felhasználó **kilépett a hologramnál** (`abort @ hologram`), vagy a **hologram-videó hiányosan** jött vissza (`incomplete-hologram-video`, a 70563-as eset mása).

**Kimenet oszlop:** a FaceKom-attempt (videoID) végső állapota. Az `approve` sorok azt jelentik, hogy a hibás hologram-kör után a user (jellemzően újraindítással) mégis végigért — vagyis a probléma **súrlódás/retry-kényszer**, nem mindig kemény bukás. Az `aborted`/`failed` sorok a tényleges elakadások.

**Jelzések a jegyzetekben:** ha a hologram-videó `WebRTC started` nélkül nem is indul el → app/SDK-oldali indítási hiba; ha elindul de ~40–48 mp után abort → szerver-oldali detektálás nem zárul; sok reconnect → socket-instabilitás.

---

## 3.7.1 — 31 szoba (abort@hologram: 21, incomplete: 11, ebből végül approve: 21)

| # | FaceKom session | Indulás | Kimenet | Típus | Jegyzetek |
|---|---|---|---|---|---|
| 1 | `7dabe098-364a-455d-8c82-9e21ae7634c7` | 2026-06-17 14:28:28 | other | abort @ hologram | hologram-videó elindul, majd 46 mp után kilép; az ellenőrzés nem fejeződik be → ? |
| 2 | `698188e9-0952-4d5b-8ce1-64a734124f0c--1783923870` | 2026-07-24 13:43:12 | other | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → ? |
| 3 | `b7f300b6-69a4-40de-982e-282bbc3c9362` | 2026-07-20 11:18:43 | approve | incomplete + abort@hologram | hologram-videó elindul, majd 46 mp után kilép; az ellenőrzés nem fejeződik be; `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → végül **approve** (újraindítással/újrapróbával végigért) |
| 4 | `3ca343b5-4566-4e01-b343-dcd57eac2345` | 2026-07-16 14:24:30 | approve | abort @ hologram | hologram lépés megjön, de a videó **el sem indul** (nincs WebRTC), 15 mp után kilép → végül **approve** (újraindítással/újrapróbával végigért) |
| 5 | `4787814a-7ae1-4d86-8993-3697ea3fef02` | 2026-07-14 13:02:42 | approve | abort @ hologram | hologram-videó elindul, majd 45 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 6 | `6a0ad615-2816-4c27-8040-cd64bea60e35` | 2026-07-10 15:06:27 | aborted | abort @ hologram | hologram lépés megjön, de a videó **el sem indul** (nincs WebRTC), 4 mp után kilép → **abort**, nem fejezte be |
| 7 | `331ef97f-74d7-4a1c-86b9-19cea65dcc56` | 2026-07-09 12:02:26 | aborted | abort @ hologram | hologram-videó elindul, majd 45 mp után kilép; az ellenőrzés nem fejeződik be → **abort**, nem fejezte be |
| 8 | `9ca4c01a-eff5-4011-a640-47604d7af694` | 2026-07-08 09:38:40 | aborted | abort @ hologram | hologram-videó elindul, majd 43 mp után kilép; az ellenőrzés nem fejeződik be → **abort**, nem fejezte be |
| 9 | `c9e73c64-d8d7-487c-ab60-3bea1707b13e` | 2026-06-30 09:04:29 | approve | abort @ hologram | hologram-videó elindul, majd 45 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 10 | `7b31e36a-d5bb-41a5-85de-47b1fb00debf--1782720420` | 2026-06-30 07:23:39 | approve | abort @ hologram | hologram-videó elindul, majd 46 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 11 | `c8b12248-0a77-4eef-8cb1-5096ccee2faa` | 2026-06-24 15:52:13 | aborted | abort @ hologram | hologram-videó elindul, majd 45 mp után kilép; az ellenőrzés nem fejeződik be → **abort**, nem fejezte be |
| 12 | `0d6257c8-3adc-4da3-a49d-507e02c365e4` | 2026-06-24 14:37:29 | aborted | abort @ hologram | hologram lépés megjön, de a videó **el sem indul** (nincs WebRTC), 7 mp után kilép → **abort**, nem fejezte be |
| 13 | `fca1449e-18db-49ac-ad80-6e7dfb8a579a--1782218893` | 2026-06-23 14:32:27 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → végül **approve** (újraindítással/újrapróbával végigért) |
| 14 | `ee7d73ae-541b-4996-a945-ec72c54ccb1a` | 2026-06-23 12:33:04 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre; socket instabil (4 reconnect) → végül **approve** (újraindítással/újrapróbával végigért) |
| 15 | `0c41c68b-c949-4552-b251-8ac7afe29bbb--1781593859` | 2026-06-16 15:07:02 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → végül **approve** (újraindítással/újrapróbával végigért) |
| 16 | `06e44dd7-3504-4711-8202-9c8640652637--1781598387` | 2026-06-16 13:09:13 | approve | abort @ hologram | hologram-videó elindul, majd 35 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 17 | `cc639bcb-b0d9-4415-b75c-8732001c7908` | 2026-06-16 11:50:44 | approve | abort @ hologram | hologram-videó elindul, majd 45/43 mp (több próba) után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 18 | `e6254402-8e17-4108-a88c-7dbb3f84c3a5--1781174865` | 2026-06-13 20:32:51 | aborted | abort @ hologram | hologram-videó elindul, majd 48 mp után kilép; az ellenőrzés nem fejeződik be → **abort**, nem fejezte be |
| 19 | `69b60375-6e89-4218-8feb-7df15d645ebd--1781250391` | 2026-06-12 09:55:47 | approve | abort @ hologram | hologram-videó elindul, majd 44/44 mp (több próba) után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 20 | `fb02947d-b599-4970-9121-56d10a6d8350--1780923700` | 2026-06-09 15:18:56 | failed | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → **failed** |
| 21 | `b3ff9226-48da-41ca-bea7-f823da735b67--1781010116` | 2026-06-09 15:10:18 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → végül **approve** (újraindítással/újrapróbával végigért) |
| 22 | `67f58098-75f4-4205-a4af-5436dffbf231--1778757723` | 2026-06-09 10:57:38 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → végül **approve** (újraindítással/újrapróbával végigért) |
| 23 | `0b18b743-c2e9-4a0d-ae87-b08da32f914b` | 2026-06-08 14:58:26 | approve | abort @ hologram | hologram-videó elindul, majd 51 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 24 | `fb:39b61d7f85a749d2b2353ef5532865f4` | 2026-06-08 14:50:04 | aborted | abort @ hologram | hologram-videó elindul, majd 22 mp után kilép; az ellenőrzés nem fejeződik be → **abort**, nem fejezte be |
| 25 | `d0a2cc84-f0d8-4d8f-b405-6ae2a3a025f1` | 2026-06-08 14:39:19 | approve | abort @ hologram | hologram-videó elindul, majd 22 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 26 | `700fc944-4598-46f7-881c-83eeeaace6db--1779266763` | 2026-06-04 13:37:43 | approve | abort @ hologram | hologram-videó elindul, majd 33 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 27 | `1b02dd18-02e0-428e-9309-a0dfa1835586` | 2026-06-02 12:39:12 | approve | abort @ hologram | hologram-videó elindul, majd 132 mp után kilép; az ellenőrzés nem fejeződik be; socket instabil (3 reconnect) → végül **approve** (újraindítással/újrapróbával végigért) |
| 28 | `37f48b69-448e-4d97-8b47-3aca8567ba47` | 2026-06-02 08:52:00 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre; socket instabil (5 reconnect) → végül **approve** (újraindítással/újrapróbával végigért) |
| 29 | `7ca246b5-86c9-4288-a16f-3a701560846e` | 2026-05-29 13:54:37 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre; socket instabil (3 reconnect) → végül **approve** (újraindítással/újrapróbával végigért) |
| 30 | `5d4f8e7e-0a4f-47b9-9cf7-373351395b29` | 2026-05-29 09:43:41 | approve | abort @ hologram | hologram-videó elindul, majd 44 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 31 | `d281f99d-1bb0-420c-8bd5-6d7e09c0a7ff--1779891359` | 2026-05-27 15:54:51 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → végül **approve** (újraindítással/újrapróbával végigért) |


---

## 3.7.0 — 16 szoba (abort@hologram: 12, incomplete: 4)

| # | FaceKom session | Indulás | Kimenet | Típus | Jegyzetek |
|---|---|---|---|---|---|
| 1 | `04f96bf1-9785-414d-93cb-b3eb5ba15708` | 2026-05-27 09:28:40 | aborted | abort @ hologram | hologram-videó elindul, majd 36 mp után kilép; az ellenőrzés nem fejeződik be → **abort**, nem fejezte be |
| 2 | `384296e5-3dfc-4dcd-a32c-1aeb7245c88b` | 2026-05-21 18:17:59 | approve | abort @ hologram | hologram-videó elindul, majd 46 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 3 | `bae3b4ac-f68f-43c6-b224-7be9fc426cdf--1778136873` | 2026-05-20 19:20:45 | approve | abort @ hologram | hologram-videó elindul, majd 48 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 4 | `43e05e55-ae61-484f-87db-d491e00a6c4b` | 2026-05-20 11:33:35 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → végül **approve** (újraindítással/újrapróbával végigért) |
| 5 | `12fe4a7b-d64d-414a-8a47-f295aeb868bc` | 2026-05-20 10:59:19 | approve | abort @ hologram | hologram-videó elindul, majd 43 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 6 | `4d50f3cb-e16b-4a34-abcb-5afc98a55c7b` | 2026-05-19 15:48:43 | approve | abort @ hologram | hologram-videó elindul, majd 54 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 7 | `91c4b425-0243-441d-a63d-6168c0167c4e--1778843014` | 2026-05-16 07:41:52 | aborted | abort @ hologram | hologram-videó elindul, majd 45 mp után kilép; az ellenőrzés nem fejeződik be → **abort**, nem fejezte be |
| 8 | `c94e3cf4-ed72-4991-811e-19a697167738` | 2026-05-15 13:42:10 | failed | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → **failed** |
| 9 | `91c4b425-0243-441d-a63d-6168c0167c4e` | 2026-05-15 08:44:15 | aborted | abort @ hologram | hologram-videó elindul, majd 50/44 mp (több próba) után kilép; az ellenőrzés nem fejeződik be → **abort**, nem fejezte be |
| 10 | `613a503f-e978-448d-8ffa-c1bab78f2ebc--1778507270` | 2026-05-14 07:35:59 | approve | abort @ hologram | hologram-videó elindul, majd 47 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 11 | `e0e0e1d8-3131-4d50-9ac5-78be0bda53fd--1778651623` | 2026-05-13 16:41:38 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → végül **approve** (újraindítással/újrapróbával végigért) |
| 12 | `f6d24e04-a21b-489a-aaf7-73ece83995b3` | 2026-05-13 15:53:45 | approve | abort @ hologram | hologram-videó elindul, majd 45 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 13 | `e0e0e1d8-3131-4d50-9ac5-78be0bda53fd--1778573527` | 2026-05-12 17:02:38 | aborted | abort @ hologram | hologram-videó elindul, majd 47/46 mp (több próba) után kilép; az ellenőrzés nem fejeződik be → **abort**, nem fejezte be |
| 14 | `432f0059-da3a-46ea-ade0-2cd47f19ab77` | 2026-05-08 08:49:45 | approve | abort @ hologram | hologram-videó elindul, majd 45 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 15 | `9d86cbd8-986f-4571-8815-0b373d030f75--1778155262` | 2026-05-08 08:49:00 | approve | abort @ hologram | hologram-videó elindul, majd 43 mp után kilép; az ellenőrzés nem fejeződik be → végül **approve** (újraindítással/újrapróbával végigért) |
| 16 | `46caa187-e39c-4ba2-9a47-079f93dfe82d` | 2026-05-07 13:12:31 | approve | incomplete-hologram-video | `incomplete-hologram-video`: a hologram-videó rögzül, de **hiányosan** jön vissza a szerverre → végül **approve** (újraindítással/újrapróbával végigért) |


---

*A Jegyzetek oszlop előre kitöltve az automatikus elemzésből — szabadon szerkeszthető.*
