# Hologram-problémás szobák (FaceKom session ID-k)

**Forrás:** FaceKom iOS Crashlytics, 3.7.0 + 3.7.1 + 3.8.0 + 3.8.1 — generálva: 2026-08-04 15:27:15

Hologram lépésig eljutott szoba: **1499** · problémás: **54** (A: 3 · B: 35 · C: 16)

- **A)** `nextStep: hologram` megjön, de a felvételi képernyő (HologramViewController) sosem jön fel → **nincs WebRTC**, a user az info-képernyőn lép ki.
- **B)** Felvételi képernyő + WebRTC elindul, de az `id-back-video` lépés **sosem érkezik meg** → a user ~40-50 mp várakozás után kilép.
- **C)** `incomplete-hologram-video` — a szerver hiányosnak ítéli a felvett hologram-videót.

| Verzió | Hologramig eljutott szoba | A | B | C |
|---|---|---|---|---|
| 3.7.0 | 489 | 0 | 15 | 4 |
| 3.7.1 | 889 | 3 | 19 | 11 |
| 3.8.0 | 120 | 0 | 1 | 1 |
| 3.8.1 | 1 | 0 | 0 | 0 |

## A) Nincs WebRTC — a hologram el sem indul — 3 szoba

| # | FaceKom session ID | Hologram lépés ideje | Verzió | Kimenet | Kilépésig eltelt idő |
|---|---|---|---|---|---|
| 1 | `3ca343b5-4566-4e01-b343-dcd57eac2345` | 2026-07-16 14:27:35 | 3.7.1 | approve | 15 mp |
| 2 | `6a0ad615-2816-4c27-8040-cd64bea60e35` | 2026-07-10 15:08:09 | 3.7.1 | aborted | 4 mp |
| 3 | `0d6257c8-3adc-4da3-a49d-507e02c365e4` | 2026-06-24 14:40:28 | 3.7.1 | approve | 7 mp |

## B) WebRTC megy, de nem jön az id-back-video — 35 szoba

| # | FaceKom session ID | Hologram lépés ideje | Verzió | Kimenet | Várakozás a felvételi képernyőn |
|---|---|---|---|---|---|
| 1 | `fb:fa4b2a5b9bdb4b45a05ae3e00c4272cb` | 2026-07-28 11:17:41 | 3.7.1 | aborted | 34 mp _(ebből felvételi képernyőn 17 mp)_ |
| 2 | `a2029890-8c14-4664-8cdd-c17c96d376c6` | 2026-07-28 08:52:51 | 3.7.1 | aborted | 47 mp _(ebből felvételi képernyőn 26 mp)_ |
| 3 | `3c4e373c-3930-4e49-9ab9-de66132b7917` | 2026-07-24 12:08:49 | 3.8.0 | approve | 23 mp _(ebből felvételi képernyőn 6 mp)_ |
| 4 | `b7f300b6-69a4-40de-982e-282bbc3c9362` | 2026-07-20 11:21:03 | 3.7.1 | approve | 45 mp _(ebből felvételi képernyőn 27 mp)_ |
| 5 | `4787814a-7ae1-4d86-8993-3697ea3fef02` | 2026-07-14 13:05:49 | 3.7.1 | approve | 44 mp _(ebből felvételi képernyőn 27 mp)_ |
| 6 | `331ef97f-74d7-4a1c-86b9-19cea65dcc56` | 2026-07-09 12:04:58 | 3.7.1 | approve | 44 mp _(ebből felvételi képernyőn 27 mp)_ |
| 7 | `9ca4c01a-eff5-4011-a640-47604d7af694` | 2026-07-08 09:44:08 | 3.7.1 | aborted | 41 mp _(ebből felvételi képernyőn 23 mp)_ |
| 8 | `c9e73c64-d8d7-487c-ab60-3bea1707b13e` | 2026-06-30 09:06:18 | 3.7.1 | approve | 44 mp _(ebből felvételi képernyőn 27 mp)_ |
| 9 | `7b31e36a-d5bb-41a5-85de-47b1fb00debf--1782720420` | 2026-06-30 07:38:27 | 3.7.1 | approve | 45 mp _(ebből felvételi képernyőn 27 mp)_ |
| 10 | `c8b12248-0a77-4eef-8cb1-5096ccee2faa` | 2026-06-24 16:08:42 | 3.7.1 | aborted | 44 mp _(ebből felvételi képernyőn 26 mp)_ |
| 11 | `7dabe098-364a-455d-8c82-9e21ae7634c7` | 2026-06-17 14:30:44 | 3.7.1 | aborted | 45 mp _(ebből felvételi képernyőn 27 mp)_ |
| 12 | `06e44dd7-3504-4711-8202-9c8640652637--1781598387` | 2026-06-16 13:12:01 | 3.7.1 | approve | 35 mp _(ebből felvételi képernyőn 10 mp)_ |
| 13 | `cc639bcb-b0d9-4415-b75c-8732001c7908` _(2×)_ | 2026-06-16 11:58:13 | 3.7.1 | approve | 42 mp _(ebből felvételi képernyőn 26 mp)_ |
| 14 | `e6254402-8e17-4108-a88c-7dbb3f84c3a5--1781174865` | 2026-06-13 20:37:16 | 3.7.1 | failed | 48 mp _(ebből felvételi képernyőn 28 mp)_ |
| 15 | `69b60375-6e89-4218-8feb-7df15d645ebd--1781250391` _(2×)_ | 2026-06-12 10:04:08 | 3.7.1 | approve | 43 mp _(ebből felvételi képernyőn 26 mp)_ |
| 16 | `6e6b97a5-d290-44db-b06f-b0adc84055fe` | 2026-06-11 10:49:15 | 3.7.1 | approve | 20 mp _(ebből felvételi képernyőn 2 mp)_ |
| 17 | `0b18b743-c2e9-4a0d-ae87-b08da32f914b` | 2026-06-08 15:00:12 | 3.7.1 | approve | 50 mp _(ebből felvételi képernyőn 26 mp)_ |
| 18 | `d0a2cc84-f0d8-4d8f-b405-6ae2a3a025f1` | 2026-06-08 14:52:00 | 3.7.1 | aborted | 22 mp _(ebből felvételi képernyőn 3 mp)_ |
| 19 | `700fc944-4598-46f7-881c-83eeeaace6db--1779266763` | 2026-06-04 13:39:55 | 3.7.1 | approve | 32 mp _(ebből felvételi képernyőn 12 mp)_ |
| 20 | `1b02dd18-02e0-428e-9309-a0dfa1835586` | 2026-06-02 12:41:24 | 3.7.1 | approve | 26 mp _(ebből felvételi képernyőn 7 mp)_ |
| 21 | `bae3b4ac-f68f-43c6-b224-7be9fc426cdf--1778136873` | 2026-05-28 13:19:03 | 3.7.0 | approve | 47 mp _(ebből felvételi képernyőn 27 mp)_ |
| 22 | `04f96bf1-9785-414d-93cb-b3eb5ba15708` | 2026-05-27 09:30:20 | 3.7.0 | aborted | 35 mp _(ebből felvételi képernyőn 20 mp)_ |
| 23 | `384296e5-3dfc-4dcd-a32c-1aeb7245c88b` | 2026-05-21 18:19:48 | 3.7.0 | approve | 45 mp _(ebből felvételi képernyőn 27 mp)_ |
| 24 | `12fe4a7b-d64d-414a-8a47-f295aeb868bc` | 2026-05-20 11:00:56 | 3.7.0 | approve | 43 mp _(ebből felvételi képernyőn 27 mp)_ |
| 25 | `4d50f3cb-e16b-4a34-abcb-5afc98a55c7b` | 2026-05-19 15:51:01 | 3.7.0 | approve | 54 mp _(ebből felvételi képernyőn 27 mp)_ |
| 26 | `8554a5ef-a415-4109-8e25-3d7ea9e31dfa` | 2026-05-19 10:01:02 | 3.7.0 | approve | 38 mp _(ebből felvételi képernyőn 22 mp)_ |
| 27 | `91c4b425-0243-441d-a63d-6168c0167c4e--1778843014` | 2026-05-16 07:44:37 | 3.7.0 | aborted | 44 mp _(ebből felvételi képernyőn 27 mp)_ |
| 28 | `91c4b425-0243-441d-a63d-6168c0167c4e` _(2×)_ | 2026-05-15 08:49:17 | 3.7.0 | aborted | 43 mp _(ebből felvételi képernyőn 27 mp)_ |
| 29 | `613a503f-e978-448d-8ffa-c1bab78f2ebc--1778507270` | 2026-05-14 07:37:13 | 3.7.0 | approve | 46 mp _(ebből felvételi képernyőn 28 mp)_ |
| 30 | `402818d8-9fc3-4fb4-a0db-8f472b8bddc4` | 2026-05-13 23:27:28 | 3.7.0 | approve | 46 mp _(ebből felvételi képernyőn 27 mp)_ |
| 31 | `f6d24e04-a21b-489a-aaf7-73ece83995b3` | 2026-05-13 15:55:16 | 3.7.0 | approve | 44 mp _(ebből felvételi képernyőn 27 mp)_ |
| 32 | `e0e0e1d8-3131-4d50-9ac5-78be0bda53fd--1778573527` _(2×)_ | 2026-05-12 17:07:34 | 3.7.0 | aborted | 45 mp _(ebből felvételi képernyőn 27 mp)_ |
| 33 | `432f0059-da3a-46ea-ade0-2cd47f19ab77` | 2026-05-08 08:52:11 | 3.7.0 | approve | 45 mp _(ebből felvételi képernyőn 27 mp)_ |
| 34 | `9d86cbd8-986f-4571-8815-0b373d030f75--1778155262` | 2026-05-08 08:50:38 | 3.7.0 | approve | 43 mp _(ebből felvételi képernyőn 27 mp)_ |
| 35 | `2ba40917-9d2c-4f7c-900e-ec531993d86e--1777898580` | 2026-05-08 08:41:36 | 3.7.0 | approve | 45 mp _(ebből felvételi képernyőn 29 mp)_ |

## C) incomplete-hologram-video — 16 szoba

| # | FaceKom session ID | Hologram lépés ideje | Verzió | Kimenet | Késleltetés |
|---|---|---|---|---|---|
| 1 | `7e3e3ae5-7db9-4bea-bd14-9aabe970cffd--1784625143` | 2026-08-03 08:47:30 | 3.8.0 | approve | 13 mp |
| 2 | `698188e9-0952-4d5b-8ce1-64a734124f0c--1783923870` | 2026-07-24 13:45:38 | 3.7.1 | failed | 14 mp |
| 3 | `b7f300b6-69a4-40de-982e-282bbc3c9362` | 2026-07-20 11:31:45 | 3.7.1 | approve | 13 mp |
| 4 | `fca1449e-18db-49ac-ad80-6e7dfb8a579a--1782218893` | 2026-06-23 14:59:08 | 3.7.1 | approve | 14 mp |
| 5 | `ee7d73ae-541b-4996-a945-ec72c54ccb1a` | 2026-06-23 12:37:29 | 3.7.1 | approve | 58 mp |
| 6 | `0c41c68b-c949-4552-b251-8ac7afe29bbb--1781593859` | 2026-06-16 15:08:32 | 3.7.1 | approve | 14 mp |
| 7 | `fb02947d-b599-4970-9121-56d10a6d8350--1780923700` | 2026-06-09 15:24:36 | 3.7.1 | failed | — |
| 8 | `b3ff9226-48da-41ca-bea7-f823da735b67--1781010116` | 2026-06-09 15:12:41 | 3.7.1 | approve | 13 mp |
| 9 | `67f58098-75f4-4205-a4af-5436dffbf231--1778757723` | 2026-06-09 11:05:15 | 3.7.1 | approve | 13 mp |
| 10 | `37f48b69-448e-4d97-8b47-3aca8567ba47` | 2026-06-02 08:53:39 | 3.7.1 | approve | 14 mp |
| 11 | `7ca246b5-86c9-4288-a16f-3a701560846e` | 2026-05-29 13:58:21 | 3.7.1 | approve | 60 mp |
| 12 | `d281f99d-1bb0-420c-8bd5-6d7e09c0a7ff--1779891359` | 2026-05-27 15:56:40 | 3.7.1 | approve | 14 mp |
| 13 | `43e05e55-ae61-484f-87db-d491e00a6c4b` | 2026-05-20 11:36:44 | 3.7.0 | approve | 14 mp |
| 14 | `c94e3cf4-ed72-4991-811e-19a697167738` | 2026-05-15 13:45:55 | 3.7.0 | failed | 15 mp |
| 15 | `e0e0e1d8-3131-4d50-9ac5-78be0bda53fd--1778651623` | 2026-05-13 16:44:02 | 3.7.0 | approve | 14 mp |
| 16 | `46caa187-e39c-4ba2-9a47-079f93dfe82d` | 2026-05-07 13:14:09 | 3.7.0 | approve | 13 mp |

