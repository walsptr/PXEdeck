# M5 — trace AC → test → status

Branch `milestone/5-callback-jobs`. Status = hasil run di `.agent/runs/m5/` (unit.log, e2e.log,
infra-test.log, kvm/results.json). **Iterasi 3 (final):** typecheck, lint, unit+coverage, E2E
(`PXE_E2E_MILESTONE=5`, suite penuh 2×), dan infra dijalankan ulang di commit **`909e2e7`** (HEAD kode + test
final). Hash tercantum di baris pertama setiap log. Commit sesudahnya hanya menambah bukti di `.agent/runs/m5/`.
(Iterasi 2: `fb8077e`.) Singkatan file:
- `TE-LIFE` = `dashboard/src/app/boot/m5-te-lifecycle-routes.test.ts` (integration route /boot + /api)
- `TE-API` = `dashboard/src/app/api/m5-te-api.test.ts` (integration route /api)
- `TE-UNIT` = `dashboard/src/lib/server/m5-te-unit.test.ts`
- `TE-HOOK` = `dashboard/src/lib/server/installers/m5-te-hooks.test.ts`
- `TE-MIG` = `dashboard/src/lib/server/db/m5-te-migration.test.ts`
- `I2` = `dashboard/src/lib/server/m5-iter2-redact-timeout.test.ts` (iter2 backend-dev: SR-5-1, SR-5-2, CR-5-1/SR-5-5a, CR-5-2)
- `I3` = `dashboard/src/lib/server/m5-iter3-redact.test.ts` (iter3 backend-dev: CR-5-18, SR-5-12, SR-5-11, CR-5-19, SR-5-16/CR-5-24, SR-5-17/CR-5-23, CR-5-25; 144 test)
- `E2E-JOBS` / `E2E-TO` / `E2E-LIB` / `E2E-UI` = `dashboard/e2e/m5-{jobs,timeout,library,ui-fixes}.spec.ts`
- `INFRA` = `infra/test/m5.sh` (via `infra/test/run.sh`)
- `KVM` = `dashboard/e2e-kvm/m5-jobs.spec.ts` (via `infra/kvm-run.sh m5 --nodes "11:uefi:destroy 12:bios"`)
- Test dasar dev (juga lulus): `m5-settings.test.ts`, `m5-lifecycle.test.ts`, `m5-log-routes.test.ts`,
  `m5-jobs-api.test.ts`, `m5-jobs-repo.test.ts`, `m5-hooks.test.ts`, `jobs.test.ts`,
  `jobs-components.test.tsx`, `m5-jobs-hooks.test.ts`, `m5-library-hooks.test.ts`.

| AC | Jenis | Test (file › nama) | Status |
|---|---|---|---|
| AC-5.1 | unit+int+e2e | TE-UNIT › "AC-5.1 env job baru (unit)" (default/min/max/di luar batas per variabel, TTL, dashboard.env KVM); TE-API › "AC-5.1 GET /api/settings…"; E2E-JOBS › "AC-5.1 Settings menampilkan pengaturan job read-only (mono)"; e2e/m4-settings.spec.ts (AC-4.6, #16) | PASS |
| AC-5.2 | unit+int+static | TE-UNIT › "AC-5.2 SR-4-2 kombinasi trust proxy × lease × flag" + "statis: .env.example…"; TE-LIFE › "AC-5.2 SR-4-2 (route)…" (3 test) | PASS |
| AC-5.3 | unit | TE-UNIT › "AC-5.3 CR-4-10 …" (IPv6 ditolak ×5, properti 600 URL acak); m5-settings.test.ts › CR-4-10 | PASS |
| AC-5.4 | unit+int | TE-API › "AC-5.4 … 403/200 untuk 11 GET" + "PXE_TRUST_PROXY=0: X-Forwarded-Host…"; TE-UNIT › "AC-5.4 CR-4-15 requestHost (unit)" | PASS |
| AC-5.5 | int | TE-LIFE › "AC-5.5 CR-4-9…" (`%25zz`, `%E0%A4%A`, `zz:zz`, `.ipxe`, `%2525zz` → 400, tanpa host baru) | PASS |
| AC-5.6 | unit+int | TE-LIFE › "AC-5.6 CR-4-8/SR-4-4…" (status/file/log route, console.warn ditangkap: 1 baris, `mac=-`, tanpa CR/LF/token); TE-UNIT › "AC-5.6 CR-4-8 baris log penolakan (unit)" | PASS |
| AC-5.7 | int | TE-LIFE › "AC-5.7 CR-4-1 …" (1..3 installer + hash berganti + event, ke-4 lokal failed; MAX=1; installing lokal tanpa rotasi + repeat + callback done sah; configuring lokal) | PASS |
| AC-5.8 | int | TE-LIFE › "AC-5.8 watchdog per tahap" (booting/installing/configuring: −1 dtk tetap, +1 dtk failed + stage watchdog + finished_at + token 404 + 1 event, sapuan kedua no-op; done/failed tak tersentuh). **Iter2 (DEC-016):** fixture dengan selisih waktu (install T0, installer +10/+25 mnt, user-data +35, configuring +45); timeout Booting dari entri `booting` **pertama** (T0), dan merah bila `stageEnteredAt` di-revert. I2 › "CR-5-2 / DEC-016 §1 timeout Booting absolut" (4 test: 2 dan 3 penyajian, Installing tidak berubah, fallback createdAt) | PASS |
| AC-5.9 | int+unit | TE-LIFE › "AC-5.9 pemicu sapuan" (GET /api/hosts, /api/hosts/:id, /api/jobs, /api/jobs/:id, /logs, /boot/{mac}.ipxe; startWatchdog fake timers 1 timer + stop) | PASS |
| AC-5.10 | int | TE-LIFE › "AC-5.10 install ulang setelah failed" (timeout, installer-boot-limit, installer-error → 200, job baru 0 boot, 2 job, token lama 404, installer job baru; host aktif → 422) | PASS |
| AC-5.11 | int | TE-LIFE › "AC-5.11 token job failed (watchdog) → 404 seragam, tanpa event baru" | PASS |
| AC-5.12 | int | TE-LIFE › "AC-5.12 siklus simulasi lengkap…" (seq 1..n ketat, kind/source, IP, tanpa token/hash/$6$ di DB) | PASS |
| AC-5.13 | int | TE-LIFE › "AC-5.13 POST /boot/{mac}/{token}/log" (8 test: 3 baris/sanitasi/ERROR, >2048, otorisasi 404 identik + expired, job final, >16 KB 413 juga token salah, >200 baris, 429, cap); I2 › "SR-5-1 sanitasi sebelum redaksi" (appendEvent, redaksi sebelum potong 2048) + "SR-5-2 …" handleLogPost (blok key dengan/tanpa footer, terpecah 2 request, 200 baris dari body mentah); iter3: I3 › "CR-5-18 …" › "AC-5.13 tetap: tanpa secret, sisa sekuens (`[31m`) dipertahankan…" (unit + handleLogPost; ekspektasi AC-5.13 tidak berubah), I3 › "SR-5-11 … 16 KB lewat handleLogPost < 50 ms" | PASS |
| AC-5.14 | unit+int | TE-UNIT › "AC-5.14 redactSecrets (tabel)" (path ×4 bentuk MAC, kv ×3, hash ×2, key ×2, base64 UTF-8/UTF-16LE/offset/2 lapis/key, teks bersih identik, idempoten); TE-API › "AC-5.14 (integration)…"; I2 › SR-5-1 (token/hash/header key bersisip ESC/\x01), SR-5-2 (multi-baris, footer yatim), "CR-5-1 + SR-5-5(a) …" (token terpotong 8..43, percent-encoded, `$6$` terpotong, negatif, base64, handleLogPost); iter3: I3 › "CR-5-18 sekuens ANSI di tengah secret" (7 sekuens × token=/path/`$6$`, cleanEventMessage + handleLogPost → DB), "SR-5-12 `\r` dan karakter format Unicode (Cf)" ((a)/(b)/(c), 17 karakter Cf), "SR-5-11 baris isi key linear" (16 KB < 20 ms), "CR-5-19 footer END yatim…", "SR-5-16 / CR-5-24 secret terpotong `stripAnsi` + secret kedua…", "SR-5-17 / CR-5-23 baris akhir key pendek berbentuk kata" (42 kombinasi + handleLogPost). Setiap perbaikan merah bila di-revert (`mutation-iter3.txt`). Sisa risiko CR-5-30/SR-5-19/SR-5-18/SR-5-20 → M6 (`test-migration.md`) | PASS |
| AC-5.15 | int | TE-MIG › "AC-5.15 migrasi 2 pada DB v1…" (2 test); TE-API › "AC-5.15 retensi riwayat per host + cascade" (2 test) | PASS |
| AC-5.16 | int | TE-API › "AC-5.16 GET /api/jobs + /:id + lastJob" (urutan, filter, bentuk persis, tanpa kunci token rekursif, cursor tanpa duplikat, 10× 400, /:id 200/400/404, lastJob) | PASS |
| AC-5.17 | int | TE-API › "AC-5.17 SSE GET /api/jobs/:id/logs" (header, backlog, live ≤ 2 dtk, ping 15 dtk, stage, end, Last-Event-ID/?after, gabungan id sama + repeat, abort, umur 30 mnt, 51 → 503, 404/400, JSON konsisten) | PASS |
| AC-5.18 | int | TE-API › "AC-5.18 PATCH /api/ssh-keys/:id + usedBy + 409" (200 tersimpan, 64 ok, 6 body 400 tanpa perubahan, 404/415/403/400, usedBy 0/1/2, 409 key & image) | PASS |
| AC-5.19 | unit | TE-HOOK › "AC-5.19 hook log dijalankan sh…" (Ubuntu early/late/error, Debian, Rocky %pre/%post/%onerror, first-boot; MAC lain/token 42/44/tanpa param → tanpa request, exit 0; fallback wget) + "AC-5.19 output generator…" (token/`/log` ber-token tidak ada teks+base64, pesan = konstanta, sh -n); installers.test.ts golden | PASS |
| AC-5.20 | unit | TE-HOOK › "AC-5.20 CR-4-4…" (KCMD dari baris `kernel` installerScript() untuk autoinstall/preseed/kickstart; mutasi `inst.ks=`→`ks=`, `url=`→`preseed/url=`, `ds=nocloud-net`→`ds=nocloud` → evaluasi gagal) | PASS |
| AC-5.21 | unit | TE-UNIT › "AC-5.21 CR-4-5 script iPXE" (waitScript semua iterasi `chain --replace --autofree … || exit 1`, setiap exit = exit 1, setiap chain --replace) | PASS |
| AC-5.22 | e2e | E2E-JOBS › "AC-5.22/5.32 Jobs: empty state…" + "AC-5.22/5.23 daftar + status live tanpa reload, filter…" | PASS |
| AC-5.23 | e2e | E2E-JOBS › "AC-5.22/5.23 …" (4 pill warna persis, Done putih, waktu mono, Failed #cf2d56 + alasan, audit pastel/box-shadow/oranye) | PASS |
| AC-5.24 | e2e | E2E-JOBS › "AC-5.24 log streaming SSE…" (≤ 3 dtk, JetBrains Mono 13 px, redaksi, autoscroll, putus via page.route → Terputus → resume `after`, tanpa ganda, Selesai) | PASS |
| AC-5.25 | e2e | E2E-JOBS › "AC-5.25 Hosts: Lihat log → riwayat host…" (+ iter2 DR-5-7/I-5-8: warna baris terpilih, indikator kiri, kontras ≥ 4,5:1, `title` OS) | PASS |
| AC-5.26 | e2e (webserver kedua) | E2E-TO › "AC-5.26 timeout Booting (1 mnt) → Failed ≤ 90 dtk…" (server `m5-timeout`, port 3111) | PASS |
| AC-5.27 | e2e+unit | E2E-LIB › "AC-5.27/5.32 OS Images…" + "AC-5.27 Daftarkan image…" (angka 409 = usedBy, BUG-M5-1 fixed); iter2: E2E-LIB › "DR-5-1 OS Images 375×812…" (kartu ≤ 200 px, halaman ≤ 300 + 200·n, tanpa scroll horizontal; merah 751 px pada kode iter1), "DR-5-1 OS Images 1440×900…" (path ≤ 2 baris; merah 3 baris pada kode iter1), "DR-5-5/DR-5-6 Daftarkan image…"; m5-library-hooks.test.ts › "DR-5-5 osImageFieldErrors…"; iter3: E2E-LIB › "DR-5-8 OS Images 375/414: ID 48 karakter + path panjang…", "DR-5-9 OS Images 1280/1440: ID/nama/path panjang…", "DR-5-12 OS Images 1280/1440: ID 48 tanpa '-'…", "DR-5-13 OS Images 375/414: nama tanpa spasi + segmen path…" (semua geometri menunggu `document.fonts.ready`, CR-5-31); merah bila komponen di-revert (`mutation-iter3.txt`) | PASS |
| AC-5.28 | e2e | E2E-LIB › "AC-5.28/5.32 SSH Keys…" (paste, unggah .pub, fingerprint = `ssh-keygen -lf`, invalid, 409, rename+reload, hapus 409/204, library Sheet); iter2: E2E-LIB › "DR-5-2 SSH Keys 1280/1440…" | PASS |
| AC-5.29 | e2e | E2E-UI › "AC-5.29 DR-4-1/4-2…" (hostname & MAC) | PASS |
| AC-5.30 | e2e+unit | E2E-UI › "AC-5.30 DR-4-3…" + "AC-5.30 DR-4-4…" (+ iter2 DR-5-3: label host tepat sekali per item); `src/lib/install-errors.test.ts` › "stripHostPrefix (DR-5-3)" (4 test) | PASS |
| AC-5.31 | e2e | E2E-UI › "AC-5.31 DR-4-5 … DR-4-6 …" (warna #807d72; kontras efektif dihitung ≥ 4,5:1) | PASS |
| AC-5.32 | static+e2e | TE-UNIT › "AC-5.32 DR-4-7 (statis)…"; E2E-JOBS/E2E-LIB judul 26 px; e2e/m1-layout.spec.ts (#14/#15) | PASS |
| AC-5.33 | unit-shell | INFRA › "M5 node.sh poweroff=destroy saja…", "…dry-run", "…menolak nama terlindungi" | PASS |
| AC-5.34 | unit-shell | INFRA › "M5 cleanup.sh run id server*/nat* ditolak…", "M5 cleanup.sh m5 tidak menyentuh disk server" | PASS |
| AC-5.35 | unit-shell | INFRA › "M5 redact: PNG bersih utuh…", "M5 redact: biner bersecret tidak diubah, exit 1" | PASS |
| AC-5.36 | unit-shell | INFRA › "M5 assert-server-logs PASS…", "…FAIL…", "M5 kvm-run dry-run: poweroff/start hanya node destroy", "M5 kvm-run finish…"; dry-run nyata `.agent/runs/m5/kvm-run-dryrun.txt` | PASS |
| AC-5.37 | static-shell | INFRA › "M5 nginx-pxe.conf allowlist admin + SSE", "M5 deploy PXE_ADMIN_ALLOW divalidasi", "M5 bash -n semua script…" | PASS |
| AC-5.38 | kvm | KVM › "AC-5.38 server-check + allowlist nginx" | PASS — host /api/settings 200; dari node12: /api/hosts 403, /api/settings 403, /boot/<mac12>.ipxe 200 lokal; server-check RESULT PASS, Next 127.0.0.1:3000, `nginx -t` OK (kvm/allowlist-check.txt); **Konfirmasi @ 079d39c (run 20261105T194821Z, node12 BIOS): PASS** — host /api/settings 200; dari node12 /api/hosts 403, /api/settings 403, /hosts 403, /boot/<mac12>.ipxe 200 lokal (kvm-confirm/allowlist-check.txt) |
| AC-5.39 | kvm (gate) | KVM › "AC-5.39 pxe-test-m5-node11 (uefi): virsh destroy…" | PASS — 951 s; Installing→Failed `timeout-installing` server +900 s, UI tanpa reload +902 s; installerBoots 1; kernel installer serial 4→4; nginx .ipxe 2→3 setelah start; timeline Failed + alasan (kvm/pxe-test-m5-node11-destroy.txt) |
| AC-5.40 | kvm (gate) | KVM › "AC-5.40 pxe-test-m5-node11: install ulang…" + kvm-run verify-node | PASS — 794 s; install ulang Booting→…→Done 577 s; verify-node 0 FAIL, password ditolak; job = [done, failed/timeout-installing]; reboot (serial: `reboot: Restarting system` → iPXE boot lokal → disk) kernel 8→8, tetap Done, 2 job (kvm/pxe-test-m5-node11-verify-ssh.txt) |
| AC-5.41 | kvm | KVM › "AC-5.41 + AC-5.42 pxe-test-m5-node12 (bios)…" + CR-4-12 asersi `assert-server-logs.sh` | PASS — 422 s; install 394 s; penanda seq 7<8<11 tampil live tanpa reload (koneksi live → ended); timeline 4 pill + waktu; reboot → 1 job; CR-4-12 dnsmasq snponly.efi node11 + nginx user-data ×2 node11 / ×1 node12 PASS (kvm/pxe-test-m5-node12-sse.txt, server-log-asserts.txt); **Konfirmasi @ 079d39c (run 20261105T194821Z, kode final iterasi 3 termasuk ingest log CR-5-29): PASS** — booting → installing → configuring → done 394 s; 12 event seq 1..12 naik, penanda seq 7<8<11 tampil live, 0 `[REDACTED]` di event; SSH key/hostname/IP/gw/DNS/sudo/authorized_keys OK, login password ditolak; reboot → dari disk, kernel installer 4→4, job tetap 1; CR-4-12 nginx user-data ×1 PASS (kvm-confirm/pxe-test-m5-node12-sse.txt, -verify-ssh.txt, -verify.txt, jobs-pxe-test-m5-node12.json, server-log-asserts.txt) |
| AC-5.42 | kvm | KVM › "AC-5.41 + AC-5.42 …" | PASS — log 404, status 404, eventCount 1→1, /boot/<mac12>.ipxe dari host lokal tanpa token (kvm/pxe-test-m5-node12-negative.txt); **Konfirmasi @ 079d39c (run 20261105T194821Z): PASS** — token acak: log 404, status 404, eventCount 1→1; /boot/<mac12>.ipxe dari host lokal tanpa token (kvm-confirm/pxe-test-m5-node12-negative.txt) |
| AC-5.43 | kvm | KVM afterAll `scanEvidence` + `kvm/post-run-checks.txt` (cleanup, libvirt sebelum/sesudah, key, scan) | PASS — cleanup (VM/disk run + overlay server hilang, base disk tetap, key dihapus, socat tidak tersisa), ubuntu24.04/default/int/pxe-test/pxe-test-nat identik, scan bukti teks+base64 0 hit, scanEvidence bersih (kvm/post-run-checks.txt) |

Ringkasan iterasi 2 @ `fb8077e`: **43/43 AC PASS**.
- typecheck exit 0, lint exit 0.
- unit+integration **1122/1122** (47 file).
- E2E **86/86** (`PXE_E2E_MILESTONE=5`): iter1 82, ditambah 4 test DR-5-x.
- infra **47/47**.
- coverage kode baru M5 (`23e508e..HEAD`): lines **98.34%** (1485/1510), branches 95.72%.
- KVM 6/6 AC + CR-4-12 dari run resmi `20261105T164801Z` @ commit produk `543cf5a` (+ test `fcc6a4e`),
  exit 0, 16:48:01Z → 17:24:58Z (37 mnt).

KVM tidak dijalankan ulang di iterasi 2: `kvm-path-diff.txt` (`git diff 543cf5a..HEAD`) menunjukkan
`app/boot/**`, `boot-script.ts`, dan `infra/` non-test tidak berubah. Di `installers/` hanya teks
pesan error partisi `custom` di `context.ts` yang berubah, dan golden installer tidak berubah. Ini
sesuai DEC-016 §Konsekuensi.

Ringkasan iterasi 3 (final) @ `909e2e7`: **43/43 AC PASS**.
- typecheck exit 0, lint exit 0.
- unit+integration **1266/1266** (48 file; +144 dibanding iterasi 2 = file baru I3 dengan 144 test; tidak ada file test lama yang berubah), 0 skip/todo.
- E2E **90/90** (`PXE_E2E_MILESTONE=5`) pada **dua run penuh berturut-turut** (run1 dan run2 sama-sama 90 passed,
  0 failed, 0 skipped, daftar test identik; tidak ada flaky): iterasi 2 86, ditambah DR-5-8, DR-5-9, DR-5-12, DR-5-13.
  Run 3 (m5-library saja, 11/11) setelah mutasi untuk menimpa screenshot.
- infra **47/47**.
- coverage kode baru M5 (`23e508e..HEAD`): lines **98.43%** (1564/1589), branches 95.95% (1162/1211); tidak ada file < 80%.
- `mutation-iter3.txt`: semua perbaikan iterasi 3 (CR-5-18, SR-5-12, SR-5-11, CR-5-19, SR-5-16/CR-5-24,
  SR-5-17/CR-5-23, DR-5-8, DR-5-9/DR-5-12, DR-5-13) merah bila di-revert dan dipulihkan identik.
- KVM tidak dijalankan ulang: `kvm-path-diff.txt` @ `909e2e7` — jalur boot/installer/infra tidak berubah di iterasi 3;
  jalur ingest log (`provisioning.ts`, `redact.ts`, `job-events.ts`) berubah tetapi kontrak HTTP ke node dan byte yang
  dilayani ke node tidak berubah (dilaporkan ke Orchestrator, CR-5-29).
