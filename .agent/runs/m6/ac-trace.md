# M6 — matriks AC → file test → nama test (test-engineer; diperbarui pada rerun gate lokal final @ 105727e)

Sumber AC: `docs/design/M6-plan.md` §4 (AC-6.1–6.54). Semua status di bawah berlaku pada commit final
**105727e** (kode produk identik dengan 019502a, tempat run KVM resmi; `git diff 019502a 105727e` hanya
menyentuh `.agent/runs/m6/kvm/`). Bukti mentah final: `.agent/runs/m6/final/` (typecheck.log, lint.log,
unit.log, coverage-m6-new-code.txt, process.log, infra-test.log, e2e-run1.log, e2e-run2.log,
axe-results-run{1,2}.json, perf-redact-16kb.log, mutation-final.txt, secret-scan.txt, axe-summary-run{1,2}.txt).
Bukti KVM hanya dari run resmi `kvm/core`, `kvm/bulk`, `kvm/distro` (+ `kvm/results.json`, semua PASS);
`kvm/prelim-97d6d44/` dan `smoke/` TIDAK dipakai sebagai bukti AC.

Hasil final @ 105727e: typecheck 0 error, lint 0; unit+integration 1878/1878 (69 file); coverage kode
baru M6 (base `main`) lines 99,03 % / branches 95,56 % / baris berubah 99,59 %; proses 13/13; infra 76/76;
E2E 2 run penuh: 158/158 lulus di kedua run, 0 gagal, 0 tidak berjalan, 0 flaky, 0 skip/fixme; secret
scan bersih di luar fixture. BUG-M6-L1 (6cca9e5), L2 & L3 (0dafffd), L4 (4d23f55) FIXED; BUG-M6-1..10 terverifikasi tertutup (`bugs.md` §Verifikasi final)
— test yang dulu MERAH kini hijau tanpa perubahan asersi (`git diff 3c4ceda..HEAD -- dashboard/e2e m6-te-session.test.ts` hanya
`e2e/helpers.ts` path screenshot L4).

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
| 6.6 | integration | AR › "logout & session (AC-6.6)" (3 test); SE › idle/absolut/kredensial/prune/watchdog; TSE › "PXE_SESSION_IDLE_MIN=1/2/120 …" (idle=1 lulus final setelah fix BUG-M6-L1 6cca9e5); SE › "BUG-M6-L1: idle 1 mnt + request tiap 5 dtk → sesi tetap hidup 5 mnt; tulis ≤ 1 per 30 dtk" |
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
| 6.17 | unit (fixture) | RD › "AC-6.17 SR-5-5(c) fixture log installer (template + secret sintetis)"; `src/lib/server/m6-kvm-installer-logs.test.ts` › "AC-6.17 fixture log installer nyata dari KVM M6" (fixture NYATA `dashboard/test/fixtures/installer-logs/` lima format: subiquity, curtin, anaconda, program, d-i syslog) |
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
| 6.32 | e2e | ES › "AC-6.32 (a) sesi di-logout dari konteks lain …", "AC-6.32 (b) baris sesi dihapus di DB …" (DEC-019 §1: pencabutan sisi server); ES › "DEC-019 §1: polling memperpanjang idle …" (lulus final, BUG-M6-L1 FIXED); CMP › useApiSessionHandling |
| 6.33 | e2e | EA › "AC-6.33 lockout UI …" (admin dengan password benar + username tak dikenal identik, tombol aktif, N dari Retry-After); CMP › 429 |
| 6.34 | e2e | EU › "AC-6.34 DR-5-10 SSH Keys" (375 kartu, 1440 tabel); CMP › SshKeysView kartu |
| 6.35 | e2e | EU › "AC-6.35 DR-5-11 + DR-5-14 …" (tabel 1280 data stres, kartu OS di Sheet); CMP › ReasonText/PathText, TabOs |
| 6.36 | e2e | EU › "AC-6.36 I-5-9 …" (/hosts, /jobs, /os-images, /ssh-keys, /settings × 768/800/818/1024/1279/1280/1440 + /login); CMP › TopBar |
| 6.37 | e2e | EU › "AC-6.37 OS Images 768–1279 kartu, ≥ 1280 tabel; DR-5-1" (768, 1024, 1279, 1280, DR-5-1 375 ≤ 200); mutasi breakpoint `xl`→`md` (`mutation-test.txt` ME1) |
| 6.38 | e2e | EU › "AC-6.38 aksesibilitas …" (filter self-test, /login, /hosts, /os-images, /ssh-keys, /settings, Sheet, /jobs detail, keyboard) (lulus final kedua run; jumlah filter per kategori: `final/axe-summary-run{1,2}.txt`; filter Sheet DEC-019 §3 `verified-pass` = 0 node, temuan di dalam Sheet yang difilter = 4, semuanya pasangan pengecualian terdaftar); CMP › "BUG-M6-L3 kontras (AC-6.38)" (3 test) |
| 6.39 | e2e regresi | seluruh `e2e/*.spec.ts` M1–M5 dengan storageState (`e2e.log`); `test-migration.md` + `assertion-counts.txt`; grep skip/only/fixme = 0 (m5-library DR-5-8 + 6 test sisanya lulus final, BUG-M6-L2 FIXED; CMP › "BUG-M6-L2 ReasonText di kartu (< xl)") |
| 6.40 | unit-shell | I6 › `test_m6_cleanup_entry_every_stage`, `test_m6_cleanup_entry_protected_changed_fails` |
| 6.41 | unit-shell | I6 › `test_m6_waves`, `test_m6_scenarios_and_specs`, `test_m6_virsh_guard_protected` |
| 6.42 | unit-shell | I6 › `test_m6_deploy_admin_no_leak`, `test_m6_deploy_admin_dry_run_creates_pass`, `test_m6_kvm_run_pass_removed_and_scanned`, `test_m6_verify_node_token_scan`; I › `test_deploy_dry_run_no_secrets` |
| 6.43 | kvm | `kvm/core` results.json `AC-6.43-host` (perimeter-host.txt, server-check.txt: 401 / 307 → /login) + `AC-6.43-node` (perimeter-node.txt: /api/* 403, varian SR-5-6 tanpa 200 ber-MAC) — PASS |
| 6.44 | kvm (wajib gate) | `kvm/core` `AC-6.44` node21 UEFI Ubuntu: booting→installing→configuring→done 573 s, verify-ssh 0 gagal, login password ditolak, reboot tanpa reinstall (pxe-test-m6core-node21-verify-ssh.txt, -timeline.txt, `verify-node` PASS); e2e-kvm `m6-core.spec.ts` — PASS |
| 6.45 | kvm | `kvm/core` `AC-6.45-start` + `AC-6.45` (Failed installer-error +264 s, error-commands 1, scan ekspor 0 temuan; node21-job1-failpath.txt) — PASS |
| 6.46 | kvm (wajib gate) | `kvm/core` `AC-6.46-destroy`, `AC-6.46-timeout` (timeout-installing, installerBoots 1), `AC-6.46` (install ulang → done, verify 0 gagal, job 2) node22 BIOS — PASS |
| 6.47 | kvm | `kvm/core` `AC-6.47a` (UI bentrok + API 422 + lease 422), `AC-6.47b` (CSV per baris, simpan nonaktif, API 422, konfigurasi identik), `AC-6.47c` (token/MAC salah → 404; negative-token.txt, server-nginx.txt) — PASS |
| 6.48 | kvm | `kvm/distro` `AC-6.48` node23 UEFI Debian 12 preseed: done 599 s, verify 0 gagal; `verify-node` PASS — PASS |
| 6.49 | kvm | `kvm/distro` `AC-6.49` node24 UEFI Rocky 9 kickstart: done 692 s, verify 0 gagal; `verify-node` PASS — PASS |
| 6.50 | kvm | `kvm/bulk` `AC-6.50` node25–27 gelombang 3: done 627/618/618 s, SSH true, 429 node 0 (bulk-ac-6.50.txt, bulk-timeline.txt); `verify-node` ×3 PASS — PASS |
| 6.51 | kvm | `kvm/core` `AC-6.51a` (bruteuser ke-6 429, admin sesudahnya 204; rate-limit-login.txt), `AC-6.51b` (flood 300 POST: 291×404 + 9×429, node21 tetap Done; flood-boot.txt, journal) — PASS |
| 6.52 | kvm + unit-shell | `kvm/{core,bulk,distro}` `AC-6.52-scan` (0 temuan) + `cleanup` PASS (libvirt-before/after/diff identik untuk resource terlindungi); I6 › `test_m6_cleanup_entry_*`; scan ulang final `final/secret-scan.txt` — PASS |
| 6.53 | static | TS › "infra/README.md §Asumsi keamanan", ".env.example" (2 test), "git grep: tanpa hash scrypt nyata" (HEAD, working tree, kontrol); I › `test_deploy_dry_run_no_secrets`; I6 › `test_m6_redact_scrypt` |
| 6.54 | infra | setelah APR M6 (T16) — tidak dinilai gate |

AC tanpa test/bukti: tidak ada. AC-6.1–6.53 masing-masing punya ≥ 1 test atau bukti KVM resmi yang valid di
105727e; AC-6.54 (teardown) dijadwalkan setelah APR M6 dan tidak dinilai gate M6 (plan §4).

## Iterasi 2 — temuan gate-iter1 (R1–R8) dan DEC-022 §3 → test (test-engineer, rerun gate lokal @ fdc0abf; kode produk = 18913b5)

Bukti mentah iterasi 2: `.agent/runs/m6/final-iter2/` (tabel hasil diserahkan ke Orchestrator di laporan test-engineer; harness subagent memblokir penulisan berkas ringkasan .md). Baris AC-6.1–6.54 di atas tetap
berlaku; seluruh test yang dirujuk lulus lagi di HEAD ini (unit, proses, infra, E2E 2×). Bukti KVM AC-6.43–6.52 kini dari
run resmi iterasi 2 di `18913b5` (`kvm/results.json`, core/bulk/distro PASS; DEC-022 §4).

Singkatan tambahan: `UI2` = `src/components/m6-iter2-ui.test.tsx`; `BE2` = `src/lib/server/m6-iter2-be.test.ts`;
`DEB2` = `src/lib/server/installers/m6-iter2-debian.test.ts`; `SMK` = `src/lib/server/installers/m6-smoke-fixes.test.ts`;
`HKS` = `src/lib/server/installers/m5-te-hooks.test.ts`; `APT` = `src/lib/server/m6-kvm-apt-trust.test.ts`;
`TPW` = `dashboard/test/process/trust-proxy-warning.test.ts`; `EI2` = `dashboard/e2e/m6-ui-iter2.spec.ts`.

| Temuan | Jenis | Test (file › nama) | Mutasi merah |
|---|---|---|---|
| R1 / DR-6-1 | jsdom + e2e | UI2 › "404 → pesan 'Job tidak ditemukan — …' text-body", "401 → 'Sesi berakhir…' text-body"; EI2 › "Jobs: job-row-failure = body di 375 dan 1440", "Hosts: host-failure-reason = body; Sheet: sheet-last-job-failure seluruh alasan tidak muted", "Log viewer: 'Job tidak ditemukan — …' …", "Log viewer: 'Sesi berakhir…' …"; EI2 › axe "/hosts", "/jobs", "/jobs detail", "/jobs 404" (filter tidak diubah) | `final-iter2/mutation.txt` A:R1, B:R1 ×3 situs; `mutation-dev-iter2-fe.txt` 4 situs |
| R2 / DR-6-2 | jsdom + e2e | UI2 › "Installing/Configuring/Done belum tercapai → bukan muted"; EI2 › "R2 / DR-6-2 timeline: label tahap belum tercapai = body" | A:R2, B:R2 |
| R3 / DR-6-3 (DEC-022 §1) | e2e | EI2 › "R3 / DR-6-3 … › /os-images @<lebar>", "Sheet tab OS: catatan kartu image tidak tersedia = body + ikon, tidak merah"; `e2e/m5-library.spec.ts` › "AC-5.27/5.32 …" dan `e2e/m5-ui-fixes.spec.ts` › "AC-5.31 …" (migrasi muted → body, `test-migration.md`) | `mutation-dev-iter2-fe.txt` R3 ×2 |
| R4 / SR-6-1 / CR-6-3 (DEC-021 fail-closed, DEC-022 §2) | unit + integration + kvm | DEB2 › "DEC-022 §2 isLocalMedia …", "media lokal: trusted=yes, allow_unauthenticated, hook 50mirror, dan pembersihan ada", "media eksternal <url> → InstallerInputError …" (4 URL), "serverIp berbeda dari host media yang sama → ditolak …"; SMK › "DEC-022 §2 media eksternal (host ≠ PXE_SERVER_IP): generator menolak …"; BE2 › "default (… server PXE) → Debian mulai install (200)", "PXE_MEDIA_URL=<url> → install Debian 422 dengan pesan jelas, tanpa job" (3 URL), "media eksternal tidak memblokir OS lain …"; APT (7 test, cek `/etc/apt` target fail-closed); KVM `kvm/distro` AC-6.48 (`/etc/apt` tanpa `trusted=yes`/`AllowUnauthenticated`) | A:R4a, A:R4b; `mutation-dev-iter2-be.txt` M1/M2; `mutation-te-T14.txt` |
| SR-6-6 (DEC-022 §2) | unit | DEB2 › "baris DEBIAN_UNTRUST_CMD mendahului semua perintah firstboot (pxe-callback) di late script"; SMK › "… media lokal (default) …" (urutan untrust < firstboot) | A:R4c; dev M3 |
| R5 / SR-6-2 | static | BE2 › "R5 SR-6-2 (AC-6.53) …" (a) DEC-021, (b) DEC-019 §1, (c) SR-6-3, "berkas checksum yang dirujuk ada" | dev M10–M12 |
| R6 / CR-6-4 | unit (sandbox shell) | HKS › "Debian early_command + late (log sebelum configuring, penanda di akhir)" (`toEqual` persis, `modprobe`/`insmod`/`udevadm`/`uname` di-stub, `/sys/module` dialihkan) | A:R6a, A:R6b; `mutation-te-iter2.txt` M1–M4 |
| R7 / DR-6-5 | jsdom + e2e | UI2 › "tiap state punya glyph SVG berbeda di indikator; nama layanan bukan sr-only"; EI2 › "R7 / DR-6-5 … › @<375/414/768/800/1024/1279/1280/1440>: glyph berbeda per state, nama DHCP/TFTP/HTTP terlihat, tanpa overflow" | A:R7, B:R7 (8 lebar) |
| R8 | dokumen | `bugs.md` §Verifikasi final merujuk berkas yang ada di `final/`; bukti iterasi 2 di `final-iter2/` (tanpa rujukan ke berkas yang tidak ada) | — |
| CR-6-1 (DEC-022 §3) | integration + unit + e2e | BE2 › "tepat 32 KiB (key baru) → 200, tersimpan", "32 KiB + 1 byte → 422 section ssh dengan pesan batas, tanpa efek", "key library terpilih ikut dihitung …", "bulk (applyConfig banyak host) juga ditolak …"; DEB2 › "CR-6-1 batas late_command Debian" (5 test); **EI2 › "CR-6-9 / CR-6-1 batas total authorized_keys 32 KiB tampil di tab SSH Sheet; config host tidak berubah"** (baru, test-engineer iter2: 32 KiB+1 key sintetis lewat Sheet → PATCH 422, alert "Ditolak server" di tab SSH memuat pesan batas, tab "(ada error)", GET host/config/ssh-keys identik) | dev M4/M5; B:CR-6-9 |
| SR-6-3 / CR-6-6 | unit + proses + static | BE2 › "trustProxyWarnings: …", "onServerStart di production tanpa PXE_TRUST_PROXY → logger.warn …", "… DENGAN PXE_TRUST_PROXY=1 (+ lease) → tanpa peringatan proxy"; TPW › "tanpa PXE_TRUST_PROXY → start … + tepat satu baris peringatan, tanpa hash", "PXE_TRUST_PROXY=1 + file lease → start tanpa peringatan proxy"; BE2 › R5 (c) README | dev M6 |
| SR-6-4 | unit | BE2 › "SR-6-4: base64 ter-wrap digabung sebelum didekode …" (tertangkap ter-wrap, baris lebar penuh, rahasia terpotong di batas baris, dua lapis, tanpa over-redaksi, baris tidak seragam), "16 KB … linear (≤ 20 ms …)", "16 KB base64 bersarang 2 lapis ter-wrap: ≤ 50 ms (terbaik dari 5)" | dev M7–M9 (M13 ekuivalen) |
| DR-6-4 | jsdom + e2e | UI2 › "focus-visible: border ring + ring/40 (bukan ring/15)"; EI2 › "DR-6-4 fokus input: border ring + ring ≥ 40% (login, keyboard)" | `mutation-dev-iter2-fe.txt` DR-6-4 ×2 |
| DR-6-6 | e2e | EI2 › "DR-6-6 hostname 63 karakter dipotong 24ch + title; kolom Status tidak terdorong …" | dev DR-6-6 |
| DR-6-7 | jsdom + e2e | UI2 › "DR-6-7 IpText: IP/CIDR mono, teks pesan tidak berubah"; EI2 › "DR-6-7 'Di luar subnet …': CIDR mono, teks pesan tetap" | dev DR-6-7 |
| DR-6-8 | jsdom + e2e | UI2 › "judul 'Job tidak ditemukan', deskripsi = penjelasan log viewer"; EI2 › "DR-6-8 /jobs?job=<tidak ada>: deskripsi tidak mengulang judul" | dev DR-6-8 |
| CR-6-10 | dokumen | `test-migration.md` §CR-6-10 (`m6-smoke-fixes.test.ts:470-488`, 113 → 110 asersi statik, alasan DEC-022 §2 / CR-6-3 / SR-6-6) | — |

Temuan iterasi 2 tanpa test: tidak ada. Ditunda sesuai DEC-022 §3: CR-6-2 (Windows tidak dilayani) dan temuan info.
