# Security review M5 — iterasi 3

> Ditulis oleh Orchestrator dari laporan security-reviewer tanpa mengubah isinya. Reviewer tidak punya tool Write.

- Security-reviewer, 2026-11-06. Worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `0c61ed8`.
- Lingkup: `git diff 7af8d05..0c61ed8`, terutama `4d77111` (`redact.ts`; `job-events.ts` dengan `stripAnsi`, `cleanAndRedact`, `\p{Cf}`; `provisioning.ts:314`).
- Probe ada di scratchpad sesi (`it3/lib.mts`, `it3/probe3.mts`, `it3/old.mts`). Probe meniru alur pada `0c61ed8` dan mengimpor `redact.ts` asli; kode repo tidak diubah.
- Test unit `m5-iter3-redact.test.ts` dan `m5-iter2-redact-timeout.test.ts`: 121/121 lulus.

## Status temuan wajib
| ID | Status | Dasar |
|---|---|---|
| SR-5-11 | **Closed** | `PKEY_BODY_LINE_RE = /^[A-Za-z0-9+/]+={0,2}$/` diterapkan pada hasil `trim()`, tanpa kuantor bertumpuk. Waktu terbaik dari 5 run: 16 KB spasi + `!` + END 0,09 ms (iterasi 2: 150 ms); alur lengkap 0,29 ms; 16 K baris kosong + END 0,99 ms. Ada test performa < 20 ms. |
| SR-5-12 (a) | **Closed** | `\r` dibuang sebelum redaksi body; `PRIV\rATE KEY` tanpa footer menjadi `[REDACTED PRIVATE KEY]`. |
| SR-5-12 (b) | **Closed** | Token di path dan `token=` yang disisipi `\r` menjadi `[REDACTED]`. |
| SR-5-12 (c) | **Closed** untuk kategori Cf | `\p{Cf}` + flag `u` di kedua kelas. U+200B, U+00AD, U+FEFF, U+180E, U+E0001, U+1D173 teredaksi. Karakter di luar Cf dicatat di SR-5-18. |
| CR-5-18 | **Closed** | `token=` + `ESC[0m`, path + `ESC[31;1m`, `$6$salt ESC[0m salt$`, `BEGIN … ESC[0m PRIVATE KEY`, dan token yang dipecah OSC 8 semuanya teredaksi. AC-5.13 tidak berubah. Celah baru akibat pendekatan ini ada di SR-5-16. |

## Temuan baru
| ID | Severity | Lokasi | Temuan | Rekomendasi |
|---|---|---|---|---|
| SR-5-16 | minor (regresi dari iterasi 2) | `job-events.ts` `ANSI_RE` alternatif ke-4 `\x1b[ -/]*[0-~]` (juga CSI `\x1b\[…[@-~]` dan `\x9b…`), serta `cleanAndRedact` | **`stripAnsi` bisa ikut memakan karakter awal secret, lalu salinan bersih yang dipilih untuk disimpan.** Contoh: `\x1b-----B` → `EGIN…`, `\x1b$6` → `$saltsalt$…`, `\x1b/b` → `oot/<mac>/<token>`, `\x1b[t` → `oken=<43>`, `$\x1b6$` → `$$salt…`. `cleanAndRedact` hanya memakai salinan mentah kalau salinan bersih tidak memuat secret. Jadi cukup satu secret lain di body yang sama, dan secret yang terpotong tadi ikut tersimpan. Terbukti lewat alur `handleLogPost`: (1) `token=<43>\n\x1b-----BEGIN OPENSSH PRIVATE KEY-----\n<body>` tanpa footer → baris isi key tersimpan utuh; (2) `GET \x1b/boot/<mac>/<43> $6$…` → token 43 utuh tersimpan (sama untuk `\x9b`); (3) `\x1b[token=<43> $6$…` → token utuh; (4) `token=<43> pw=\x1b$6$salt$hash` → hash utuh. Pada iterasi 2 (`7af8d05`) keempatnya teredaksi. Pemicunya byte yang dirangkai atau terpotong di node itu sendiri, dan hasilnya hanya terlihat oleh admin. Tidak ada ReDoS. | Redaksi kedua salinan dan jangan buang hasil redaksi salinan mentah. Contoh: redaksi dulu teks mentah tanpa membuang ESC, lalu `stripAnsi` → `stripControl` → `redactSecrets`. Bila ekspektasi AC-5.13 berubah, catat migrasinya. Tambah test untuk keempat kasus, masing-masing dengan secret kedua di body yang sama. |
| SR-5-17 | minor (regresi dari iterasi 2) | `redact.ts:79-84, 103-115` (`isKeyBodyLine`, `WORD_RE`, `PKEY_BODY_MIN`) | **Baris pendek terakhir yang berbentuk kata menghentikan pemindaian (`break`), sehingga seluruh ekor key di atasnya lolos.** Probe `<b64 58 karakter>\nAQID\n-----END OPENSSH PRIVATE KEY-----`: hanya footer yang tersamarkan, baris isi key tetap tersimpan. Hal yang sama terjadi bila ada baris kosong di antara baris pendek dan footer. Iterasi 2 meredaksi seluruhnya. Baris akhir berbentuk `AQID`/`BAUG`/`AQIDBAUG` realistis pada RSA, yang ekornya `…AAAAAAQID`; pada ed25519 baris pendeknya selalu berakhir `=`, jadi aman. Hanya relevan untuk key yang terpecah antar-request; material RSA yang lolos bisa mencakup q/CRT. | Baris pendek berbentuk kata tetap ditelan bila baris non-kosong di atasnya adalah baris isi key ≥ 16 karakter; `break` hanya bila bukan. Baris kosong tepat di atas footer diperlakukan sebagai adjacent. Perilaku CR-5-19 (`Done`/`OK` di atas teks biasa) tetap dipertahankan. Tambah test untuk `AQID`, `BAUG`, `AQIDBAUG`, `Abcdef` di bawah baris key 64/70 karakter, plus varian dengan baris kosong. |
| SR-5-18 | info | `job-events.ts` `CONTROL_CLASS_BASE` | Karakter tak terlihat di luar Cf masih bisa memecah token sehingga lolos utuh: U+034F CGJ (Mn), U+FE0F/VS (Mn), U+3164 (Lo), dan lone surrogate `\ud800`. | M6, bersama SR-5-13: tambah `\p{Default_Ignorable_Code_Point}` dan `[\uD800-\uDFFF]`, atau pakai whitelist karakter untuk salinan pencocokan. |

## Pemeriksaan lain (tanpa temuan)
- **Bypass `stripAnsi`:**
  - OSC tanpa terminator tidak menelan baris.
  - CSI yang tidak lengkap hanya memakan satu karakter, dan sisa token masih tertangkap pola parsial `{8,43}`.
  - Secret yang seluruhnya berada di dalam OSC tidak bocor.
  - Satu-satunya bypass yang ditemukan adalah SR-5-16.
- **Salinan bersih vs teks asli:** bila salinan bersih memuat secret, salinan bersih yang disimpan; bila tidak, teks asli diredaksi penuh. Celahnya hanya kombinasi pada SR-5-16.
- **ReDoS (16 KB, waktu terbaik dari 5 run):** semua linear, ≤ 1,12 ms. Input yang diuji: `ESC[`+digit, `ESC`+`-`, OSC tanpa terminator, `\x9b`+`;`, `ESC`×16 K, U+200B×16 K, `ESC[0m`×4000, dan campuran.
- **Batas 413:** tetap dihitung dari body mentah. Pemisahan `\r` konsisten dengan `splitLogLines`.
- **Secret di diff:** fixture hanya dummy.
- **Jalur boot/installer/infra:** `git diff --stat 7af8d05..0c61ed8` untuk `installers/`, `app/boot/`, `boot-script.ts`, `infra/`, `configs/`, `scripts/` kosong. Bukti KVM tetap berlaku.

## Ringkasan per severity
| Severity | Jumlah | ID |
|---|---|---|
| Critical | 0 | — |
| Major | 0 | — |
| Minor | 2 baru | SR-5-16, SR-5-17 (regresi dari iterasi 2). Masih terbuka: SR-5-3 (syarat gate M6); SR-5-4 diterima lewat DEC-016 |
| Info | 1 baru | SR-5-18. Masih terbuka: SR-5-5(c), 5-6, 5-7, 5-8, 5-10, 5-13, 5-14, 5-15 |

---

## Tinjauan lanjutan atas `0ed047b` (perbaikan SR-5-16 / SR-5-17 / CR-5-24)

> Ditulis oleh Orchestrator dari laporan security-reviewer, isinya tidak diubah.

- **Cakupan:** `git diff 0c61ed8..0ed047b` pada `redact.ts`, `job-events.ts`, `m5-iter3-redact.test.ts`, dan `test-migration.md`.
- **Probe:** `scratchpad/it3/probe4-6.mts`. `lib2.mts` menyalin verbatim `job-events.ts` @`0ed047b`, dan `pipeline` meniru `handleLogPost`.
- **Test:** vitest `m5-iter3-redact.test.ts` 144/144 lulus.

### Status
| ID | Status | Bukti |
|---|---|---|
| SR-5-16 | **Closed** | Keempat kasus teredaksi lewat `pipeline`, masing-masing dengan secret kedua di body yang sama: (1) key tanpa footer menjadi `[REDACTED PRIVATE KEY]`; (2) `GET oot/…/[REDACTED] $6$[REDACTED]`, juga varian `\x9b`; (3) `oken=[REDACTED]`; (4) `pw=$[REDACTED]` dan `$$[REDACTED]`. Celah sisanya dicatat sebagai SR-5-19. |
| SR-5-17 | **Closed** | `AQID`, `BAUG`, `AQIDBAUG`, `Abcdef`, `AAAA` di bawah baris key 64 dan 70 karakter, dengan atau tanpa baris kosong, semuanya teredaksi. Perilaku CR-5-19 tetap (`Done`/`OK`/`Selesai` tidak menelan baris di atasnya). |
| CR-5-24 | **Closed** (sisi keamanan) | Tanda digabung per karakter mentah. |
| Regresi CR-5-18 / SR-5-12 / SR-5-11 | Tidak ada | AC-5.13 tidak berubah. Waktu ≤ 2,1 ms pada input 16 KB. |

Argumen dev yang menolak saran "redaksi mentah dulu" **diterima**. Pola parsial berhenti di ESC, sehingga dengan urutan itu potongan kedua lolos. Contohnya `$6$salt ESC[0m salt$hash` menjadi `$6$[REDACTED]salt$hash`, dan 23 karakter token lolos.

### Analisis peta indeks
- **Surrogate pair dan multi-code-unit: aman.** Pemetaan bekerja per code unit, sentinel menjaga panjang tetap, dan pasangan surrogate tidak pernah terbelah.
- **Sentinel PUA di input:** tidak bisa memalsukan atau menghapus tanda, karena tanda hanya berlaku bila `ms[i] !== text[i]`. Sentinel di dalam blok key hanya tampil sebagai karakter itu sendiri; tidak ada material key yang bocor.
- **Performa:** semua kasus 16 KB ≤ 3 ms dan linear.
- **Over-redaksi:** tidak berlebihan. Efek kosmetik yang tersisa: karakter yang dimakan alternatif ke-4 `ANSI_RE` hilang dari tampilan.

### Temuan baru
| ID | Severity | Lokasi | Masalah | Rekomendasi |
|---|---|---|---|---|
| SR-5-19 | minor (bukan regresi; iterasi 2 juga lolos) | `job-events.ts` `cleanAndRedact` | Secret yang dirusak di **kedua** salinan sekaligus lolos. Ini terjadi bila escape yang memakan karakter awal (`\x1b$6`, `\x1b[t`, `\x1b/b`, `\x1b-`) dipasangkan dengan SGR di tengah secret yang sama. Probe: (a) `pw=\x1b$6$salt\x1b[0msalt$<86>`: badan hash lolos; (b) `\x1b[token=<20>\x1b[0m<23>`: token utuh; (c) `GET \x1b/boot/<mac>/<5>\x1b[0m<38>`: token utuh; (d) `\x1b-----BEGIN OPENSSH \x1b[0mPRIVATE KEY-----\n<body>` tanpa footer: isi key tersimpan. Butuh dua konstruksi escape yang disengaja pada satu secret. Pemicunya pemegang token yang memang sudah memegang secret itu, dan hasilnya hanya terlihat admin. | M6 bersama SR-5-18. Tambahkan salinan ketiga `sgr` yang hanya membuang SGR dan OSC 8 utuh, sedangkan escape lain hanya dibuang byte ESC-nya. Tambahkan test (a)–(d). |
| SR-5-20 | info | `job-events.ts` `CONTROL_CLASS_BASE` | Karakter Private Use (`\p{Co}`), termasuk sentinel itu sendiri, tidak dibuang. Bila disisipkan di tengah token, token tidak dikenali. | M6: tambahkan `\p{Co}` ke kelas kontrol. |

### Batas perubahan
`installers/`, `app/boot/`, `boot-script.ts`, dan `infra/` tidak berubah. Diff tidak memuat material secret.

### Ringkasan (tinjauan lanjutan)
critical 0 · major 0 · minor 1 baru (SR-5-19, M6) · info 1 baru (SR-5-20). SR-5-16 dan SR-5-17 closed. Laporan ini bukan approval.
