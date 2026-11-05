# M5 — trace AC → test → status

Branch `milestone/5-callback-jobs`. Status = hasil run di `.agent/runs/m5/` (unit.log, e2e.log,
infra-test.log, kvm/results.json). Singkatan file:
- `TE-LIFE` = `dashboard/src/app/boot/m5-te-lifecycle-routes.test.ts` (integration route /boot + /api)
- `TE-API` = `dashboard/src/app/api/m5-te-api.test.ts` (integration route /api)
- `TE-UNIT` = `dashboard/src/lib/server/m5-te-unit.test.ts`
- `TE-HOOK` = `dashboard/src/lib/server/installers/m5-te-hooks.test.ts`
- `TE-MIG` = `dashboard/src/lib/server/db/m5-te-migration.test.ts`
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
| AC-5.8 | int | TE-LIFE › "AC-5.8 watchdog per tahap" (booting/installing/configuring: −1 dtk tetap, +1 dtk failed + stage watchdog + finished_at + token 404 + 1 event, sapuan kedua no-op; done/failed tak tersentuh) | PASS |
| AC-5.9 | int+unit | TE-LIFE › "AC-5.9 pemicu sapuan" (GET /api/hosts, /api/hosts/:id, /api/jobs, /api/jobs/:id, /logs, /boot/{mac}.ipxe; startWatchdog fake timers 1 timer + stop) | PASS |
| AC-5.10 | int | TE-LIFE › "AC-5.10 install ulang setelah failed" (timeout, installer-boot-limit, installer-error → 200, job baru 0 boot, 2 job, token lama 404, installer job baru; host aktif → 422) | PASS |
| AC-5.11 | int | TE-LIFE › "AC-5.11 token job failed (watchdog) → 404 seragam, tanpa event baru" | PASS |
| AC-5.12 | int | TE-LIFE › "AC-5.12 siklus simulasi lengkap…" (seq 1..n ketat, kind/source, IP, tanpa token/hash/$6$ di DB) | PASS |
| AC-5.13 | int | TE-LIFE › "AC-5.13 POST /boot/{mac}/{token}/log" (8 test: 3 baris/sanitasi/ERROR, >2048, otorisasi 404 identik + expired, job final, >16 KB 413 juga token salah, >200 baris, 429, cap) | PASS |
| AC-5.14 | unit+int | TE-UNIT › "AC-5.14 redactSecrets (tabel)" (path ×4 bentuk MAC, kv ×3, hash ×2, key ×2, base64 UTF-8/UTF-16LE/offset/2 lapis/key, teks bersih identik, idempoten); TE-API › "AC-5.14 (integration)…" | PASS |
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
| AC-5.25 | e2e | E2E-JOBS › "AC-5.25 Hosts: Lihat log → riwayat host…" | PASS |
| AC-5.26 | e2e (webserver kedua) | E2E-TO › "AC-5.26 timeout Booting (1 mnt) → Failed ≤ 90 dtk…" (server `m5-timeout`, port 3111) | PASS |
| AC-5.27 | e2e | E2E-LIB › "AC-5.27/5.32 OS Images…" + "AC-5.27 Daftarkan image…" (lihat BUG-M5-1 untuk angka di pesan 409) | PASS |
| AC-5.28 | e2e | E2E-LIB › "AC-5.28/5.32 SSH Keys…" (paste, unggah .pub, fingerprint = `ssh-keygen -lf`, invalid, 409, rename+reload, hapus 409/204, library Sheet) | PASS |
| AC-5.29 | e2e | E2E-UI › "AC-5.29 DR-4-1/4-2…" (hostname & MAC) | PASS |
| AC-5.30 | e2e | E2E-UI › "AC-5.30 DR-4-3…" + "AC-5.30 DR-4-4…" | PASS |
| AC-5.31 | e2e | E2E-UI › "AC-5.31 DR-4-5 … DR-4-6 …" (warna #807d72; kontras efektif dihitung ≥ 4,5:1) | PASS |
| AC-5.32 | static+e2e | TE-UNIT › "AC-5.32 DR-4-7 (statis)…"; E2E-JOBS/E2E-LIB judul 26 px; e2e/m1-layout.spec.ts (#14/#15) | PASS |
| AC-5.33 | unit-shell | INFRA › "M5 node.sh poweroff=destroy saja…", "…dry-run", "…menolak nama terlindungi" | PASS |
| AC-5.34 | unit-shell | INFRA › "M5 cleanup.sh run id server*/nat* ditolak…", "M5 cleanup.sh m5 tidak menyentuh disk server" | PASS |
| AC-5.35 | unit-shell | INFRA › "M5 redact: PNG bersih utuh…", "M5 redact: biner bersecret tidak diubah, exit 1" | PASS |
| AC-5.36 | unit-shell | INFRA › "M5 assert-server-logs PASS…", "…FAIL…", "M5 kvm-run dry-run: poweroff/start hanya node destroy", "M5 kvm-run finish…"; dry-run nyata `.agent/runs/m5/kvm-run-dryrun.txt` | PASS |
| AC-5.37 | static-shell | INFRA › "M5 nginx-pxe.conf allowlist admin + SSE", "M5 deploy PXE_ADMIN_ALLOW divalidasi", "M5 bash -n semua script…" | PASS |
| AC-5.38 | kvm | KVM › "AC-5.38 server-check + allowlist nginx" | PASS — host /api/settings 200; dari node12: /api/hosts 403, /api/settings 403, /boot/<mac12>.ipxe 200 lokal; server-check RESULT PASS, Next 127.0.0.1:3000, `nginx -t` OK (kvm/allowlist-check.txt) |
| AC-5.39 | kvm (gate) | KVM › "AC-5.39 pxe-test-m5-node11 (uefi): virsh destroy…" | PASS — 951 s; Installing→Failed `timeout-installing` server +900 s, UI tanpa reload +902 s; installerBoots 1; kernel installer serial 4→4; nginx .ipxe 2→3 setelah start; timeline Failed + alasan (kvm/pxe-test-m5-node11-destroy.txt) |
| AC-5.40 | kvm (gate) | KVM › "AC-5.40 pxe-test-m5-node11: install ulang…" + kvm-run verify-node | PASS — 794 s; install ulang Booting→…→Done 577 s; verify-node 0 FAIL, password ditolak; job = [done, failed/timeout-installing]; reboot (serial: `reboot: Restarting system` → iPXE boot lokal → disk) kernel 8→8, tetap Done, 2 job (kvm/pxe-test-m5-node11-verify-ssh.txt) |
| AC-5.41 | kvm | KVM › "AC-5.41 + AC-5.42 pxe-test-m5-node12 (bios)…" + CR-4-12 asersi `assert-server-logs.sh` | PASS — 422 s; install 394 s; penanda seq 7<8<11 tampil live tanpa reload (koneksi live → ended); timeline 4 pill + waktu; reboot → 1 job; CR-4-12 dnsmasq snponly.efi node11 + nginx user-data ×2 node11 / ×1 node12 PASS (kvm/pxe-test-m5-node12-sse.txt, server-log-asserts.txt) |
| AC-5.42 | kvm | KVM › "AC-5.41 + AC-5.42 …" | PASS — log 404, status 404, eventCount 1→1, /boot/<mac12>.ipxe dari host lokal tanpa token (kvm/pxe-test-m5-node12-negative.txt) |
| AC-5.43 | kvm | KVM afterAll `scanEvidence` + `kvm/post-run-checks.txt` (cleanup, libvirt sebelum/sesudah, key, scan) | PASS — cleanup (VM/disk run + overlay server hilang, base disk tetap, key dihapus, socat tidak tersisa), ubuntu24.04/default/int/pxe-test/pxe-test-nat identik, scan bukti teks+base64 0 hit, scanEvidence bersih (kvm/post-run-checks.txt) |

Ringkasan: **43/43 AC PASS** (unit+integration 1078/1078, E2E 82/82, infra 47/47, KVM 6/6 AC + CR-4-12). Run KVM resmi `20261105T164801Z` @ commit produk `543cf5a` (+ test `fcc6a4e`), exit 0, 16:48:01Z → 17:24:58Z (37 mnt).
