# M6 — matriks AC → file test → nama test (T10–T13, test-engineer)

Sumber AC: `docs/design/M6-plan.md` §4 (AC-6.1–6.54). AC KVM (6.43–6.52) milik T14 (KVM resmi) dan
AC-6.54 (teardown, setelah APR) tidak dinilai di sini kecuali bagian non-KVM-nya. Status = hasil run
lokal terakhir (lihat `unit.log`, `e2e.log`, `process.log`, `infra-test.log`); MERAH = test ada dan
gagal karena bug produk (dicatat di `bugs-local.md`), tidak di-skip/dilonggarkan.

Hasil lokal @ f2f848d + test T10–T13 (20459e1): typecheck 0 error, lint 0; unit 1845/1846 (merah:
BUG-M6-L1), coverage kode baru M6 lines 98,97 % / branches 95,25 % / baris berubah 99,58 %; proses 13/13;
infra 68/68; E2E 2 run penuh identik: 143 lulus, 9 gagal (BUG-M6-L1 ×1, BUG-M6-L2 ×1, BUG-M6-L3 ×7),
6 tidak berjalan (sisa `m5-library` serial setelah DR-5-8), 0 flaky; secret scan bersih di luar fixture.

Singkatan file: `AR` = `dashboard/src/app/api/auth/auth-routes.test.ts`; `AM` = `src/app/api/m6-auth-matrix.test.ts`;
`CO` = `src/app/api/m6-carryover-api.test.ts`; `BE` = `src/lib/server/m6-backend.test.ts`;
`RD` = `src/lib/server/m6-redact.test.ts`; `GEN` = `src/lib/server/installers/m6-generator.test.ts`;
`PW` = `src/lib/server/auth/password.test.ts`; `SE` = `src/lib/server/auth/session.test.ts`;
`RL` = `src/lib/server/auth/rate-limit.test.ts`; `NX` = `src/lib/auth-next.test.ts`;
`CMP` = `src/components/m6-components.test.tsx`; `HK` = `src/hooks/m6-hooks.test.ts`;
`TB` = `src/app/boot/m6-te-boot.test.ts`; `TS` = `src/lib/server/m6-te-static.test.ts`;
`TL` = `src/lib/server/m6-te-limits.test.ts`; `TSE` = `src/lib/server/auth/m6-te-session.test.ts`;
`PR` = `dashboard/test/process/start-guard.test.ts`; `EA` = `dashboard/e2e/m6-auth.spec.ts`;
`ES` = `e2e/m6-session.spec.ts`; `EU` = `e2e/m6-ui.spec.ts`; `I6` = `infra/test/m6.sh`; `I` = `infra/test/run.sh`.

| AC | Jenis | Test (file › nama) |
|---|---|---|
| 6.1 | unit + integration + e2e | BE › "settings auth (AC-6.1)" (default + batas; username/hash tidak valid; hash berspasi; GET /api/settings blok auth tanpa hash rekursif); `m4-api-routes.test.ts` › settings `toEqual` + tanpa hash; CMP › "SettingsView blok Akses"; EU › "AC-6.1 Settings: blok Akses read-only, username admin mono, tanpa hash"; `e2e/m4-settings.spec.ts` › AC-4.6 (blok auth) |
| 6.2 | unit + proses | BE › "production logN=21 → start ditolak", "non-production tanpa admin → … satu peringatan"; AR › "admin belum dikonfigurasi (non-production) → login apa pun 401 dan API 401"; PR › "AC-6.2 …" (tanpa username, tanpa hash, format salah, logN=21, username tidak valid) |
| 6.3 | unit + proses | BE › "SR-5-4: production + insecure tanpa/beda konfirmasi → ditolak …", "SR-5-4 non-production tidak terpengaruh"; PR › "AC-6.3 SR-5-4 …" (tanpa konfirmasi, yes, huruf kecil, berspasi, frasa beda, frasa tepat → start + peringatan), "SR-5-10 PXE_TRUST_PROXY=1 tanpa PXE_DNSMASQ_LEASES" |
| 6.4 | unit | PW › semua (round-trip, rusak/di luar batas, timingSafeEqual spy, verifyDummy scrypt, maxmem, paritas dua arah `admin-hash.mjs`, tolak < 12 / > 256 tanpa mencetak) |
| 6.5 | integration | AR › "POST /api/auth/login (AC-6.5)" (5 test: cookie flags/DB sha256, https Secure, 401 body identik, 403/415/400/413, dua login → id baru & lama dihapus) |
| 6.6 | integration | AR › "logout & session (AC-6.6)" (3 test); SE › idle/absolut/kredensial/prune/watchdog; TSE › "PXE_SESSION_IDLE_MIN=1/2/120 …" (**idle=1 MERAH: BUG-M6-L1**) |
| 6.7 | static + integration | AM › "statis: setiap handler API memanggil guard di awal" (enumerasi + per file), "integration: tanpa sesi valid → 401 …" (tanpa cookie, palsu, rusak, kedaluwarsa, setelah logout; snapshot DB tetap) + kontrol positif; TB › "AC-6.7 /boot/** tanpa sesi" (tanpa cookie, cookie sampah); regresi M2–M5 seluruh suite unit dengan sesi |
| 6.8 | integration + e2e | NX › safeNextPath + Proxy (isPublicPath, proxyRedirect, matcher); EA › "AC-6.8 …" (7 halaman → /login?next= tanpa data, cookie palsu → layout lapis kedua, aset/font/favicon 200, 6× next berbahaya → /hosts, next sah) |
| 6.9 | integration | CO › "SSE dengan sesi (AC-6.9, SR-5-7)" (401, ke-6 → 429, sesi lain OK, logout → end session, idle → end session); TL › "SSE: tepat 5 stream … ke-6 ditolak" + konstanta 5/50; `m5-te-api.test.ts` › "koneksi ke-51 → 503" (regresi AC-5.17) |
| 6.10 | integration | AR › "rate limit login (AC-6.10)" (5 test termasuk race paralel); RL › login |
| 6.11 | integration | AR › "rate limit API per sesi (AC-6.11)"; RL › API per sesi; TL › default 600 |
| 6.12 | unit + integration | BE › "SR-5-3 throttle log penolakan /boot (AC-6.12)" (4 test); TB › "100 POST log ditolak dalam 60 dtk → 20 detail + 1 ringkasan; file kuota sendiri; …" (lewat route) |
| 6.13 | static-shell | I6 › `test_m6_nginx_limit_req_static` ("M6 nginx limit_req login + /boot/, allowlist tetap"); `infra/test/m5.sh` › nginx -t di install-dashboard.sh |
| 6.14 | unit + integration | RD › "AC-6.14 CR-5-30 / SR-5-19 …" (cleanEventMessage + handleLogPost → DB per kasus, (d) BEGIN tanpa footer, hasil persis, ANSI_RE, token= parsial, AC-5.13 tetap) |
| 6.15 | unit + integration | RD › "AC-6.15 SR-5-18 / SR-5-20 / SR-5-13 / CR-5-21 …" (karakter tak terlihat, encoding, benign identik, idempoten, 16 KB ≤ 50 ms); `m5-iter2-redact-timeout` / `m5-te-unit` batas performa 20 ms |
| 6.16 | unit + static | RD › "AC-6.16 CR-5-20 a/b/c + SR-5-14 + SR-5-15" (prefiks, rangkaian 64/70, 70 footer, perilaku terdokumentasi, docstring redact.ts & job-events.ts) |
| 6.17 | unit (fixture) | RD › "AC-6.17 SR-5-5(c) fixture log installer (template + secret sintetis)" — **sebagian**: template SINTETIS lima format; fixture dari log KVM M6 nyata menunggu T14 (lihat test-migration T4) |
| 6.18 | integration | CO › "CR-5-3 sweep tanpa write lock bila tidak ada kandidat (AC-6.18)" |
| 6.19 | integration + e2e | CO › "CR-5-4 cursor opak (AC-6.19)"; `src/lib/m6-jobs-head.test.ts` (6 test); HK › "useJobs (CR-5-4 klien)"; EU › "AC-6.19 … > 50 job, ≥ 3 siklus polling, job baru di antara fetch …" |
| 6.20 | e2e (+unit) | EU › "job tidak ada → 'Job tidak ditemukan'; tanpa request … 15 dtk", "job terhapus saat log terbuka → status final …; tanpa polling log 15 dtk"; HK › CR-5-5 (404/4xx final); CMP › LogViewer 404 |
| 6.21 | integration | CO › "CR-5-6: resume after=k …"; `m5-jobs-api.test.ts` & `m5-te-api.test.ts` resume (migrasi backend) |
| 6.22 | integration | TB › "event identik tiap 30 dtk selama 5 mnt → 1 event repeat=11 …; jeda > 60 dtk → event baru"; BE › "migrasi 3 … last_at = at; migrasi dua kali"; `m5-jobs-repo.test.ts` (migrasi backend) |
| 6.23 | integration | CO › "CR-5-8 install setelah timeout tanpa GET (AC-6.23)" |
| 6.24 | static/tipe | BE › "CR-5-9 tipe kontrak satu sumber (AC-6.24)" (`expectTypeOf`); mutasi MT1/MT2 → `tsc` merah (`mutation-test.txt`) |
| 6.25 | unit-shell | I6 › `test_m6_results_json_escaping`, `test_m6_assert_server_logs_json_and_files` |
| 6.26 | integration | CO › "CR-5-11: tick yang melempar …", "SQLITE_BUSY sekali → retry …", "SQLITE_BUSY dua kali …"; BE › errorClass |
| 6.27 | integration | CO › "SR-5-8 nama tampilan tanpa karakter kontrol/bidi/PUA (AC-6.27)" |
| 6.28 | unit | GEN › "AC-6.28 SR-4-6 preseed ` ---`" (3 extraArgs + Ubuntu/Rocky); `boot-script.test.ts`, `boot-routes.test.ts` (migrasi) |
| 6.29 | unit | GEN › "AC-6.29 …" (konteks × dekode berlapis, kontrol positif sintetis, urutan FirstLogonCommands, AutoLogon, tidak dilayani) + "regresi: install host dengan OS Windows gagal"; `installers.test.ts` (migrasi) |
| 6.30 | e2e | EA › "AC-6.30 desain halaman login" (375 & 1440); CMP › LoginForm label/autocomplete/mono |
| 6.31 | e2e | EA › "AC-6.31 alur login" (password salah → Alert fokus, Enter, kembali ke /jobs?host=, username mono; login → /hosts, Keluar, Back tanpa data); CMP › SidebarAccount, useReloadOnBfcacheRestore |
| 6.32 | e2e | ES › "AC-6.32 (a) sesi di-logout dari konteks lain …", "AC-6.32 (b) baris sesi dihapus di DB …" (DEC-019 §1: pencabutan sisi server); ES › "DEC-019 §1: polling memperpanjang idle …" (**MERAH: BUG-M6-L1**); CMP › useApiSessionHandling |
| 6.33 | e2e | EA › "AC-6.33 lockout UI …" (admin dengan password benar + username tak dikenal identik, tombol aktif, N dari Retry-After); CMP › 429 |
| 6.34 | e2e | EU › "AC-6.34 DR-5-10 SSH Keys" (375 kartu, 1440 tabel); CMP › SshKeysView kartu |
| 6.35 | e2e | EU › "AC-6.35 DR-5-11 + DR-5-14 …" (tabel 1280 data stres, kartu OS di Sheet); CMP › ReasonText/PathText, TabOs |
| 6.36 | e2e | EU › "AC-6.36 I-5-9 …" (/hosts, /jobs, /os-images, /ssh-keys, /settings × 768/800/818/1024/1279/1280/1440 + /login); CMP › TopBar |
| 6.37 | e2e | EU › "AC-6.37 OS Images 768–1279 kartu, ≥ 1280 tabel; DR-5-1" (768, 1024, 1279, 1280, DR-5-1 375 ≤ 200); mutasi breakpoint `xl`→`md` (`mutation-test.txt` ME1) |
| 6.38 | e2e | EU › "AC-6.38 aksesibilitas …" (filter self-test, /login, /hosts, /os-images, /ssh-keys, /settings, Sheet, /jobs detail, keyboard) (**MERAH: BUG-M6-L3**) |
| 6.39 | e2e regresi | seluruh `e2e/*.spec.ts` M1–M5 dengan storageState (`e2e.log`); `test-migration.md` + `assertion-counts.txt`; grep skip/only/fixme = 0 (**m5-library DR-5-8 MERAH: BUG-M6-L2**) |
| 6.40 | unit-shell | I6 › `test_m6_cleanup_entry_every_stage`, `test_m6_cleanup_entry_protected_changed_fails` |
| 6.41 | unit-shell | I6 › `test_m6_waves`, `test_m6_scenarios_and_specs`, `test_m6_virsh_guard_protected` |
| 6.42 | unit-shell | I6 › `test_m6_deploy_admin_no_leak`, `test_m6_deploy_admin_dry_run_creates_pass`, `test_m6_kvm_run_pass_removed_and_scanned`, `test_m6_verify_node_token_scan`; I › `test_deploy_dry_run_no_secrets` |
| 6.43–6.52 | kvm | **T14** (run `core`/`distro`/`bulk`); di luar cakupan T10–T13 |
| 6.53 | static | TS › "infra/README.md §Asumsi keamanan", ".env.example" (2 test), "git grep: tanpa hash scrypt nyata" (HEAD, working tree, kontrol); I › `test_deploy_dry_run_no_secrets`; I6 › `test_m6_redact_scrypt` |
| 6.54 | infra | setelah APR M6 (T16) — tidak dinilai gate |

AC tanpa test: tidak ada (di luar 6.43–6.52 = T14 dan 6.54 = T16). AC-6.17 lengkap setelah fixture nyata T14.
