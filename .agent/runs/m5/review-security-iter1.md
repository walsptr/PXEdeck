# Security review M5 — iterasi 1 (security-reviewer)

> Ditulis oleh Orchestrator dari laporan security-reviewer, tanpa perubahan isi. Reviewer tidak punya tool Write.

- Worktree `/home/syawal/Project/PXE-BOOT/.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `96eb489`; diff `23e508e..96eb489`.
- Acuan: `docs/SPEC.md` §6, `docs/design/M5-plan.md`, DEC-013/014/015, carry-over `.agent/runs/m4/gate-iter1.md` (SR-4-1, SR-4-2, SR-4-4, SR-4-5, SR-4-9).
- Bukti yang dibaca: `.agent/runs/m5/secret-scan.txt`, `kvm/allowlist-check.txt`, `kvm/results.json`, `kvm/pxe-test-m5-node12-{negative,sse}.txt`, `kvm/server-log-asserts.txt`, `kvm/*-timeline.txt`.
- Semua langkah read-only (git diff/grep, membaca file); tanpa ssh/curl. Skrip uji redaksi lokal ditolak sandbox, sehingga SR-5-1 dan SR-5-2 dinilai dari analisis regex tanpa eksekusi.
- Laporan ini bukan approval.

## Temuan

| ID | Severity | File:baris | Skenario serangan | Saran |
|---|---|---|---|---|
| SR-5-1 | minor | `dashboard/src/lib/server/db/repos/job-events.ts:126` (`sanitizeMessage(redactSecrets(...))`) | Redaksi dijalankan **sebelum** karakter kontrol dibuang. Secret yang disisipi karakter kontrol (`token=AbC…\x1b…`, `$6$sa\x01lt$…`) tidak cocok dengan `TOKEN_KV_RE`/`HASH_RE`. Setelah `CONTROL_RE` membuang ESC/\x01, token atau hash itu utuh kembali, tersimpan di `job_events`, dan tampil di UI/SSE. Pemicunya log installer yang memuat kode kontrol (ANSI, progress bar), atau pemegang token. | Ubah urutan menjadi `redactSecrets(sanitizeMessage(raw))`, atau sanitize→redact→redact ulang. Tambah unit test dengan karakter kontrol di dalam token/hash. |
| SR-5-2 | minor | `dashboard/src/lib/server/provisioning.ts:306-317` + `dashboard/src/lib/server/redact.ts:87` (`PKEY_BLOCK_RE`) | Body log dipecah per baris dulu, lalu tiap baris diredaksi sendiri-sendiri. Pada blok PEM/OpenSSH multi-baris hanya baris `-----BEGIN … PRIVATE KEY-----` yang diganti `[REDACTED PRIVATE KEY]`; baris base64 isi key tersimpan apa adanya. Jalurnya `logTailCmd` (tail saat gagal), atau installer yang mencetak key. | Redaksi seluruh body sebelum `splitLogLines`, atau buang baris setelah BEGIN sampai END (state per request). Tambah test multi-baris. |
| SR-5-3 | minor | `dashboard/src/app/boot/[name]/[token]/log/route.ts:22`, `dashboard/src/lib/server/boot-http.ts:70-72` | `POST /boot/*/*/log` terbuka untuk semua klien PXE. Setiap request yang ditolak menulis `console.warn` ke journal tanpa batas laju, karena rate limit 60/menit baru berlaku setelah otorisasi. Siapa pun di LAN PXE bisa membanjiri journal. Masalah yang sama sudah ada di `/status` dan `/file`. | Batasi log penolakan (token bucket, atau ringkasan "N penolakan/menit"), atau pasang `limit_req` di nginx pada `/boot/`. Kerjakan bersama rate limit M6. |
| SR-5-4 | minor | `dashboard/src/lib/server/settings.ts:193-200` (bandingkan `:229-230` untuk `PXE_SEED=demo`) | `PXE_INSECURE_NO_LEASE_CHECK=1` tetap diterima saat `NODE_ENV=production`, hanya disertai peringatan. Kombinasi dengan `PXE_TRUST_PROXY=1` membuka kembali risiko SR-4-2: peminta mana pun untuk MAC berstatus `booting` mendapat token dan config (hash password, authorized_keys). | Tolak start bila flag ini aktif di production tanpa konfirmasi kedua yang eksplisit, atau catat sebagai risiko yang diterima di DEC. |
| SR-5-5 | info | `installers/shell.ts:104-106`, `installers/ubuntu.ts:24-27`, `redact.ts:81` | Jalur gagal mengirim tail log installer. (a) `cut -c1-240` bisa memotong token sehingga tidak terdeteksi. (b) Token percent-encoded tidak tertangkap. (c) Jalur ini belum pernah dijalankan di KVM dengan log asli. Dampak kecil karena token dicabut oleh callback `failed`. | Tambah test dengan fixture log nyata atau KVM dengan kegagalan disengaja; tambah pola token percent-encoded. |
| SR-5-6 | info | `infra/server/nginx-pxe.conf:28-32, 57-62` | Varian path (`/boot/%2e%2e/api/hosts`, `/boot/..%2Fapi/hosts`, `/boot/..\api/hosts`, `//api/hosts`) belum diuji. Berdasarkan analisis tidak ada bypass, tetapi belum terbukti. | Tambahkan varian tersebut ke cek allowlist KVM M6. |
| SR-5-7 | info | `dashboard/src/lib/server/sse.ts:183, 223-225` | Batas 50 SSE berlaku global, tanpa batas per klien. Di mode dev tanpa nginx, satu klien bisa menghabiskan semua slot (503 untuk admin). Tidak ada kebocoran data antar-job. | Opsional: batas per IP/sesi setelah login M6. |
| SR-5-8 | info | `dashboard/src/lib/server/library-service.ts:41, 84, 127-128` | Nama SSH key dan name/version OS image menerima karakter kontrol/bidi. Tidak ada XSS dan nilainya tidak masuk generator; risikonya hanya spoofing tampilan. `PATCH` memakai `.strict()`; `relPath` aman. | Opsional: tolak karakter kontrol/bidi. |
| SR-5-9 | info | `.agent/runs/m5/secret-scan.txt` | Scan dijalankan di `fcc6a4e`, dua commit di belakang HEAD. Scan independen reviewer atas `fcc6a4e..96eb489` bersih. | Jalankan ulang `secret-scan.sh` pada HEAD final sebelum gate. |
| SR-5-10 | info | `dashboard/src/lib/server/startup.ts:148-158`, `dashboard/src/instrumentation.ts` | Penolakan start hanya diuji di unit test dengan `exit` di-mock; belum ada bukti di level proses. | Tambah uji infra: server build dengan `PXE_TRUST_PROXY=1` tanpa leases → exit ≠ 0 dan baris `[pxe] start ditolak`. |

## Area yang diperiksa tanpa temuan baru
- **`POST /boot/{mac}/{token}/log`:** batas 16 KB diperiksa sebelum otorisasi; otorisasi sama dengan callback status (bentuk token, sha256, MAC, TTL, job aktif, binding IP). Penolakan selalu 404 seragam; >200 baris → 413; >60/menit → 429. Pesan disanitasi dan dipotong di 2048 karakter; cap 5000 event; token tidak di-log. Uji KVM dengan token acak → 404.
- **CR-4-1:** saat `installing`/`configuring` → boot lokal tanpa rotasi token; saat `booting` dibatasi N kali; lewat batas → `installer-boot-limit`.
- **Tanpa lease:** fail-closed (tanpa token, `current_ip` tidak diubah, boot lokal).
- **Allowlist Host / X-Forwarded-Host:** 23 handler GET memanggil `guardRead`; semua mutasi memanggil `guardMutation`; X-Forwarded-Host hanya dibaca bila trust proxy, dan nginx membuang header forwarding.
- **Allowlist nginx:** `/` dan lokasi SSE → admin saja; `/boot/` dan `/media/` terbuka. `PXE_ADMIN_ALLOW` divalidasi sebelum `sed`. Dibuktikan di KVM.
- **Hook log generator:** URL diturunkan dari `/proc/cmdline`; token tidak masuk config/perintah/base64; output curl/wget dibuang; pesan berupa konstanta yang di-`shQuote`; path tail divalidasi.
- **Injeksi template dan path traversal:** aman. CR-4-9 (decode ganda) sudah dihapus.

## Secret / plaintext
- `git grep` di `96eb489` hanya menemukan fixture palsu, teks laporan/skrip scan, `DUMMY_PASSWORD` e2e, dan placeholder `@PXE_PASSWORD_HASH@`.
- Diff `fcc6a4e..96eb489` dan `.agent/runs/m5/**`: 0 hit untuk token-path, `token=`, `$6$`, maupun PRIVATE KEY.
- Password KVM acak per run hanya hidup di env proses; trace/video/screenshot Playwright KVM dinonaktifkan.
- File `.env` yang ter-commit hanya `dashboard/.env.example` (dummy) dan `infra/server/dashboard.env` (nilai lab, tanpa rahasia). Path sensitif di-ignore.

## Penutupan carry-over
| Item | Status | Dasar |
|---|---|---|
| SR-4-2 | Closed | fail-fast di `settings.ts:196-200`, `startup.ts` + `instrumentation.ts` exit(1), discovery tanpa token tanpa lease; sisa minor/info: SR-5-4, SR-5-10 |
| SR-4-4 / CR-4-8 | Closed | `boot-http.ts:50-73` |
| SR-4-9 / CR-4-15 | Closed | `http.ts:406-411`, nginx membuang header forwarding |
| SR-4-5 / CR-4-9 | Closed | decode ganda dihapus |
| SR-4-1 (mitigasi M5) | Mitigasi terpenuhi | allowlist nginx + Host allowlist + bukti KVM; login + rate limit tetap blocker gate M6 |

## Ringkasan per severity
| Severity | Jumlah | ID |
|---|---|---|
| Critical | 0 | — |
| Major | 0 | — |
| Minor | 4 | SR-5-1, SR-5-2, SR-5-3, SR-5-4 |
| Info | 6 | SR-5-5 … SR-5-10 |

Rekomendasi reviewer: SR-5-1 dan SR-5-2 diperbaiki di M5 (murah dan menyangkut redaksi secret); SR-5-3 dan SR-5-6 masuk M6 bersama rate limit/login.
