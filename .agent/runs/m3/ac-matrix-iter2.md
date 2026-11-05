# AC matrix M3 — iterasi 2 (test-engineer)

Sumber status (satu run untuk satu codebase M1–M3, branch `milestone/1-3-baseline` @ fe6a353 + test iter2; log identik di m1/m2/m3):
- `typecheck-iter2.log` exit 0 · `lint-iter2.log` exit 0
- `unit-iter2.log` = `npm run test` biasa (vitest run --coverage, **tanpa flag tambahan**): 21 file, **359/359 lulus, exit 0**. Daftar nama test: `unit-iter2-verbose.log`.
- `coverage-summary-iter2.txt`/`.json` (DEC-004, ambang/include/exclude tidak diubah): **lines 99.78%, branches 98.22%**, statements 99.72%, functions 99.04%.
- `e2e-iter2.log` = `npm run test:e2e`: **58/58 lulus, exit 0** (forbidOnly true, retries 0, workers 1, reuseExistingServer false).

Perubahan infrastruktur test iter2 (menguatkan, bukan melemahkan):
- CR-2-9: `playwright.config.ts` kini menjalankan server `next start` sendiri per file spec yang memutasi store (m2-hosts-table :3102, m3-sheet :3103, m3-bulk :3104, iter2-ui :3105, iter2-network-env :3106; M1+smoke :3100; polling :3101), semuanya dari satu build produksi. Store segar dari seed per file → hasil tidak bergantung urutan file/`--grep`. Diverifikasi: kombinasi project parsial (m2-polling + iter2-ui + m3-bulk + m3-sheet, tanpa m2-hosts-table) dijalankan 3× berturut-turut → 15/15 lulus tiap kali.
- Semua webServer memakai env `PXE_MGMT_*` eksplisit (subnet lab); server iter2-network-env memakai subnet KVM 10.99.0.0/24.
- Tidak ada `.skip/.only/.fixme/test.fail/waitForTimeout` di `dashboard/e2e` maupun `dashboard/src` (grep 0 hit).

| AC / temuan | File test | Nama test | Status |
|---|---|---|---|
| AC-3.1 | dashboard/src/lib/net.test.ts; net-config.test.ts | AC-3.1 isIpv4/validateStaticIp/planIps/validateIpAssignments; **CR-3-1** IP awal di luar subnet (di bawah network, di atas broadcast, subnet aktif non-default; range & increment) → semua host `IP awal di luar subnet <cidr>` · 1.1.1.1/0.0.0.1 ×40 panggilan < 50 ms · iterasi dibatasi ukuran subnet | PASS |
| AC-3.2 | dashboard/src/lib/hostname.test.ts | AC-3.2 validateHostname · renderHostnames | PASS |
| AC-3.3 | dashboard/src/lib/credentials.test.ts | AC-3.3 …; **SR-3-1** 10.000 password tanpa awalan `= + - @` (karakter pertama alfanumerik) · simbol tetap dipakai di posisi lain · panjang 1/0 · neutralizeCsvCell (`= + - @ TAB CR` → prefiks `'`, lainnya utuh) · toCsv menetralkan sebelum quoting | PASS |
| AC-3.4 | dashboard/src/lib/ssh-key.test.ts | AC-3.4 parseSshKey · sshFingerprint | PASS |
| AC-3.5 | config-routes.test.ts; http.test.ts; iter2-routes.test.ts | AC-3.5 400/422/404; **SR-3-2** semua POST/PATCH ber-body: Origin asing / port beda / `null` / rusak / Sec-Fetch-Site cross-site → 403 tanpa efek; tanpa Content-Type, text/plain, form, multipart, application/jsonp → 415 tanpa efek; `application/json; charset=utf-8` diterima; Origin sama/X-Forwarded-Host diterima; **SR-3-3** Content-Length > 1 MB → 413, stream > 1 MB tanpa Content-Length → 413 tanpa efek (bulk, PATCH, CSV import), < 1 MB tidak 413; readBodyLimited per byte UTF-8 | PASS |
| AC-3.6 | config-routes.test.ts; config-service.test.ts | AC-3.6 atomik; G3-2 paralel | PASS |
| AC-3.7 | config-routes.test.ts; iter2-routes.test.ts | AC-3.7 network …; **CR-3-9** IP host = gateway payload → 422 `…: Bentrok dengan gateway 10.10.10.5` tanpa efek (single & bulk, hanya host terkait) · gateway di range DHCP dinamis → 422 · gateway valid → 200; **CR-3-2** validasi server = subnet /api/network (10.99.0.11 diterima, 10.10.10.50 → `Di luar subnet 10.99.0.0/24`) | PASS |
| AC-3.8 | config-routes.test.ts | AC-3.8 same/random, GET config tanpa hash | PASS |
| AC-3.9 | config-routes.test.ts; iter2-routes.test.ts | AC-3.9 CSV import …; **SR-3-4** baris 1 kolom berisi password → `mac:""`, respons tanpa password · kolom tertukar (password di kolom MAC/username) tidak di-echo · username invalid → `""` · 422 bulk mode csv tanpa password | PASS |
| AC-3.10 | config-routes.test.ts | AC-3.10 hostname/key | PASS |
| AC-3.11 | config-routes.test.ts; iter2-routes.test.ts | AC-3.11 install; install single tanpa Content-Type diterima, non-JSON → 415, lintas-origin → 403 | PASS |
| AC-3.12 | dashboard/e2e/m3-sheet.spec.ts | AC-3.12 Sheet single host … simpan → PATCH; **DR-3-1** badge tipe key (ssh-ed25519 baru & ssh-rsa library) font JetBrains Mono; **CR-3-5** private key / teks acak → field-error + ringkasan "Key baru #1: …" + tab "(ada error)" + Simpan nonaktif; key valid → Simpan aktif; payload hanya key .pub | PASS |
| AC-3.13 | dashboard/e2e/m3-sheet.spec.ts; form-state.test.ts | AC-3.13 validasi UI + 422 server; unit: **CR-3-5** sectionErrors key gagal parse, buildPayload membuang "PRIVATE KEY"; **CR-3-9** gateway di range dinamis (klien) | PASS |
| AC-3.14 | dashboard/e2e/m3-bulk.spec.ts | AC-3.14 preview bulk + password sekali tampil — **CR-3-10** urutan baris preview IP, preview hostname, dan `hostIds` payload dibandingkan dengan urutan tabel **tanpa sort** | PASS |
| AC-3.15 | dashboard/e2e/m3-bulk.spec.ts | AC-3.15 single & bulk — **CR-3-11** "Batal tanpa request" kini `page.waitForRequest(save, 1,5 dtk)` harus timeout + daftar request kosong (bukan `waitForTimeout(300)`) | PASS |
| CR-3-2 (UI) | dashboard/e2e/iter2-network-env.spec.ts (server env PXE_MGMT_* = 10.99.0.0/24) | /api/network = env KVM · bulk Set IP: default 10.99.0.11–10.99.0.99, gateway/DNS 10.99.0.1, preview .11/.12/.13 → simpan 200, tabel & config API ber-IP 10.99.0.x · single host: IP lab ditolak UI ("Di luar subnet 10.99.0.0/24", Simpan nonaktif) dan API (422), 10.99.0.45 diterima keduanya | PASS |
| CR-3-2 (UI) | dashboard/e2e/iter2-ui.spec.ts | server lab: /api/network = env lab, sidebar & empty state · respons /api/network lain (page.route 192.168.50.0/24) → start/end/gateway/DNS/preview/validasi/placeholder/deskripsi/sidebar ikut | PASS |
| CR-3-2 (unit) | form-state.test.ts; hooks.test.ts; net.test.ts | defaultIpRange · initialForm(net) · mgmtOf · ipPlan/sectionErrors dengan ctx.net · useNetworkConfig/toActiveNetwork (no-store, error server) · toNetworkResponse/fromNetworkResponse | PASS |
| CR-3-3 | iter2-routes.test.ts | mode CSV 3 host terpilih, CSV 1 host → `{updated: 1}`, updatedAt hanya host itu · CSV + bagian lain → semua host batch | PASS |
| CR-3-6 | dashboard/e2e/iter2-ui.spec.ts | dialog password: tanpa tombol X/"Tutup tanpa mengunduh", Selesai nonaktif, Escape & klik overlay tidak menutup, centang "Saya sudah menyimpan password" (checkbox/label) → Selesai aktif, hapus centang → nonaktif · unduh CSV → Selesai aktif & checkbox hilang, Escape menutup, CSV tanpa sel formula · batch berikutnya terkunci lagi | PASS |
| CR-3-13 | dashboard/e2e/iter2-ui.spec.ts | GET config 500 → alert "Gagal memuat konfigurasi host" + pesan server, tanpa tab/input/Simpan; Coba lagi → GET 200, lima tab, IP tersimpan · GET /api/network 500 → "Gagal memuat parameter jaringan", tanpa form; Coba lagi → form default subnet | PASS |
| DR-3-2 / DR-3-3 | dashboard/e2e/iter2-ui.spec.ts | Sheet radius kiri 12px (kanan 0); tombol "Tambah" DNS ≥ 32px, area klik "Hapus DNS …" ≥ 32px | PASS |
| G-SEC-2 | dashboard/src/lib/server/mock-hosts.test.ts | hash seed demo (lihat M2) | PASS |

Risiko M3 (password di log/screenshot): `*-iter2.log` di-grep untuk nilai `DUMMY_PASSWORD` fixture, `PRIVATE KEY-----`, dan salt hash lab lama → 0 hit. Kolom password di `ac-3.14-passwords-dialog.png` dan `iter2-passwords-dialog-locked.png` di-mask (diperiksa visual).
Screenshot: `screenshots/` (ac-3.12 … ac-3.15, iter2-*).
