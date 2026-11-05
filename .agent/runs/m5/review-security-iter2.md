# Security review M5 — iterasi 2 (security-reviewer)

> Ditulis oleh Orchestrator dari laporan security-reviewer, tanpa perubahan isi. Reviewer tidak punya tool Write.

- **Lokasi:** worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `9328f65`. Diff `d19b44c..9328f65`: `redact.ts`, `db/repos/job-events.ts`, `provisioning.ts` (`handleLogPost`), `sse.ts`.
- **Acuan:** `review-security-iter1.md`, `gate-iter1.md`, DEC-016 (SR-5-4 diterima, ditunda ke M6).
- **Yang dijalankan (read-only):**
  - git diff/grep/show.
  - vitest `m5-iter2-redact-timeout`, `m5-te-unit`, `m5-log-routes`: 151 test lulus.
  - Skrip probe di scratchpad yang mengimpor `redact.ts` asli dan mereplikasi pipeline `handleLogPost`.
  - Tanpa ssh/curl; tidak ada file repo yang diubah.
- Laporan ini bukan approval.

## Temuan baru
| ID | Severity | File:baris | Skenario | Saran |
|---|---|---|---|---|
| SR-5-11 | minor | `redact.ts:29` (`PKEY_BODY_LINE_RE = /^[ \t]*[A-Za-z0-9+/=]*[ \t]*\r?$/`), dipakai `redactOrphanKeyTail` (`:65-79`) | **Backtracking kuadratik.** `[ \t]*` di awal dan akhir saling tumpang-tindih. Satu baris berisi 16 KB spasi + `!` lalu footer END: 4 KB → 10 ms, 8 KB → 38 ms, 16 KB → 150 ms. Fungsi ini sinkron di dalam transaksi BEGIN IMMEDIATE. Pemegang token valid dengan 60 request/menit bisa memblokir sekitar 9 detik per menit per job. Bukan ReDoS eksponensial. | Pola linear, mis. `/^[A-Za-z0-9+/= \t]*\r?$/`, atau `trim()` lalu uji. Tambah test performa (16 KB < 20 ms). Pola baru lain sudah diukur linear (≤ 5 ms pada 16 KB). |
| SR-5-12 | minor | `provisioning.ts:313` (`stripControl(input.text, true)` mempertahankan `\r`), `job-events.ts:52-58` (`CONTROL_RE` tanpa karakter format Unicode) | **Separator dibuang setelah redaksi seluruh body.** Terverifikasi tiga kasus. (a) `-----BEGIN OPENSSH PRIV\rATE KEY-----\n<base64…>` tanpa footer: baris isi key tersimpan utuh. (b) `/boot/<mac>/<20>\r<23>/status`: 23 karakter token bocor. (c) Analisis: U+200B di posisi < 8 membuat token 43 karakter tersimpan utuh. Hanya terlihat oleh admin; pemicunya log yang sengaja dirangkai. | Normalisasi `\r` sebelum redaksi body (seperti `splitLogLines`). Tambahkan kategori Cf (U+00AD, U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+FEFF) ke `CONTROL_RE` dan `CONTROL_KEEP_NL_RE`. Tambah test untuk ketiga kasus. |
| SR-5-13 | info | `redact.ts:13-24` | Varian encoding yang lolos: JSON `\/`, percent-encoding ganda `%252F`, campuran `/boot%2F`, `token%3D`, `token=` terpotong, `\$6\$`, `$$6$$`, `%246%24`. Generator mengeluarkan bentuk polos, jadi kemungkinannya rendah. | M6: normalisasi salinan (decode sekali, `\/`→`/`, `\$`→`$`) sebelum pencocokan. |
| SR-5-14 | info | `redact.ts:65-79`, `TOKEN_PATH_PARTIAL_RE` | (a) Ekor key berprefiks log (`cloud-init[1]: b3Bl…`) tanpa BEGIN: baris isinya lolos. (b) Token yang ter-wrap ke baris berikutnya: bagian setelah newline lolos. Generator memakai `cut`, bukan wrap. | Opsional M6: izinkan prefiks log umum (tetap linear); token wrap diterima sebagai risiko sisa. |
| SR-5-15 | info | `redact.ts:23, 25, 17` | Redaksi berlebih yang aman: `awk '{print $6$7}'`, BEGIN tanpa footer menelan sisa body, footer yatim menelan baris `Done`/`OK`, path machine-id BLS. | Dapat diterima; dokumentasikan perilakunya. Opsional: BEGIN tanpa footer hanya menelan baris berbentuk base64. |

## Status temuan iterasi 1
| ID | Status | Dasar |
|---|---|---|
| SR-5-1 | **Closed** (skenario ESC/\x01) | `cleanEventMessage` (`job-events.ts:79-81`) dipakai `appendEvent:154`; test `:82-124`. Varian `\r`/Cf → SR-5-12 |
| SR-5-2 | **Closed** (sisa SR-5-12/14) | Redaksi body sebelum split, lalu per baris lagi; `PKEY_BLOCK_RE` `$`; `redactOrphanKeyTail`; batas 413 dari body mentah; test `:126-188` |
| CR-5-1 / SR-5-5(a) | **Closed** | Pola parsial `{8,43}`, percent-encoded, hash parsial, deteksi di base64; test `:190-278`. SR-5-5(b) ditutup untuk satu lapis encoding (varian lain di SR-5-13). SR-5-5(c) tetap open (info, M6) |
| SR-5-9 | **Closed** | Lihat bagian SR-5-9 di bawah |
| SR-5-3, 5-6, 5-7, 5-8, 5-10 | Open (minor/info) | Di luar lingkup iterasi ini; M6 |
| SR-5-4 | Diterima (DEC-016) | M6 |

## SR-5-9: secret-scan di HEAD final
- Scan dijalankan di `a668a88`. Rentang `a668a88..9328f65` hanya menambah analisis teks di `secret-scan.txt`, jadi hasil scan berlaku untuk HEAD.
- Tiga hit sudah diklasifikasi dengan benar:
  - `b64-scan.py:12,16` (`Fixture-Pass-7319`): sama dengan `DUMMY_PASSWORD` di `fixtures.ts:46`.
  - Kutipan header 31 byte di `secret-scan.txt` versi lama: hanya header, tanpa isi key.
- Pemeriksaan independen di `9328f65`:
  - `BEGIN .*PRIVATE KEY` hanya muncul di laporan, pola, dan fixture palsu.
  - `$6$` di luar test/golden hanya ada di komentar dan konstanta.
  - Tidak ada `/boot/<mac>/<43>` di `.agent/runs/m5`.
  - `.env` yang ter-track sama dengan iterasi 1.

## SSE dan jalur lain
- `sse.ts:40-43` membaca event yang sudah diredaksi dari DB, lalu menyerialisasinya dengan `JSON.stringify`, jadi tidak ada injeksi frame.
- Semua event melewati `logJobEvent` → `appendEvent` → `cleanEventMessage`.
- `source` hanya berisi konstanta.

## Risiko sisa yang diakui dev
- **Key terpecah ke ≥ 3 request:** dapat diterima (info). Hook mengirim satu request per file, dan pecahan seperti itu hanya mungkin bila dirangkai oleh node sendiri. Catatan: varian `\r` (SR-5-12) bukan bagian dari risiko ini dan perlu diperbaiki.
- **Token < 8 karakter:** dapat diterima (≤ 42 bit terungkap dari 256; TTL dan pencabutan). Catatan: SR-5-12(b) bisa membocorkan sampai 35 karakter.

## Ringkasan per severity
| Severity | Jumlah | ID |
|---|---|---|
| Critical | 0 | — |
| Major | 0 | — |
| Minor | 2 baru | SR-5-11, SR-5-12 (open dari iterasi 1: SR-5-3; SR-5-4 diterima lewat DEC-016) |
| Info | 3 baru | SR-5-13, SR-5-14, SR-5-15 (open dari iterasi 1: SR-5-5(c), 5-6, 5-7, 5-8, 5-10) |

Rekomendasi reviewer: SR-5-11 dan SR-5-12 murah diperbaiki dan menyangkut redaksi secret, jadi sebaiknya selesai sebelum M5 di-approve. SR-5-13 s.d. SR-5-15 masuk M6.
