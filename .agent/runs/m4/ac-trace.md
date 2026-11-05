# M4 — Trace AC → test (test-engineer)

Plan: `docs/design/M4-plan.md` §4 (AC-4.1..4.34). Branch `milestone/4-backend-ipxe`.
Bukti mentah: `typecheck.log`, `lint.log`, `unit.log`, `coverage-run.log`, `coverage-summary.txt`/
`.json`, `coverage-m4-new-code.txt`, `e2e.log`, `infra-test.log`, `guard-cr-1-10.log`,
`secret-scan.txt` (+ `secret-scan.sh`), `test-migration.md`, `screenshots/` (regresi M1–M3 berawalan `m1-`/`m2-`/`m3-`).

Singkatan path: `db` = `dashboard/src/lib/server/db/db.test.ts`; `set` =
`dashboard/src/lib/server/settings.test.ts`; `lea` = `dashboard/src/lib/server/leases.test.ts`;
`bsc` = `dashboard/src/lib/server/boot-script.test.ts`; `sst` =
`dashboard/src/lib/server/server-status.test.ts`; `gen` =
`dashboard/src/lib/server/installers/installers.test.ts`; `boot` =
`dashboard/src/app/boot/boot-routes.test.ts`; `api` = `dashboard/src/app/api/m4-api-routes.test.ts`;
`cfg` = `dashboard/src/app/api/config-routes.test.ts`; `hr` =
`dashboard/src/app/api/hosts/hosts-routes.test.ts`; `i2r` = `dashboard/src/app/api/iter2-routes.test.ts`;
`csv` = `dashboard/src/lib/server/config-service.test.ts`; `hk` = `dashboard/src/hooks/m4-hooks.test.ts`;
E2E di `dashboard/e2e/`; KVM di `dashboard/e2e-kvm/`; shell `infra/test/run.sh`.

Status: **PASS** = lulus di run ini; **FAIL** = gagal (dilaporkan apa adanya); **SIAP/TIDAK
DIJALANKAN** = suite KVM disiapkan, uji KVM nyata ditahan atas instruksi Orchestrator (insiden VM
belum dikonfirmasi user).

| AC | Jenis | File → test | Status |
|---|---|---|---|
| AC-4.1 | integration | `db` › `AC-4.1 migrasi` (DB kosong → semua tabel/indeks; migrasi 2× idempoten; reopen file + seed sekali; migrasi gagal di-rollback) + `constraint` (MAC duplikat; hostname beda huruf; IP statis duplikat + CHECK; job aktif kedua; CHECK/FK; cascade config+join+job) | PASS |
| AC-4.2 | integration | `api` › `AC-4.2 persistence & tanpa secret di response` (host/config/key/job via API identik setelah `closeDb` + buka ulang file; 11 response `/api/**` tanpa `passwordHash/password_hash/token/token_hash/$6$`); `boot` › AC-4.24 (file DB+WAL tanpa token plaintext) | PASS |
| AC-4.3 | integration | `api` › `AC-4.3 atomik (G3-2)` (5 ronde PATCH paralel IP sama → tepat 200+422; hostname paralel; bulk 1 host invalid → `dbSnapshot` identik; constraint unik → 422 sama); `csv` › atomisitas G3-2 | PASS |
| AC-4.4 | integration + e2e | Regresi M2/M3 di DB: `hr`, `cfg`, `i2r`, `csv`, `net.test.ts`, `credentials.test.ts`, dst. (semua lulus) + `db` › `AC-4.4 (statis)` (tanpa impor `mock-hosts`, tanpa `__test__`); E2E m1/m2/m3/iter2/iter3 (lihat `e2e.log`) | PASS |
| AC-4.5 | unit | `set` › `AC-4.5 settingsFromEnv: konfigurasi valid` (3), `… error menyebut nama variabel` (35 kasus), `AC-4.5 DEC-006 dengan PXE_MGMT_CIDR=10.99.0.0/24` (10.99.0.21 diterima; 10.10.10.21/10.99.0.150/10.99.0.2/prefix≠24 ditolak) | PASS |
| AC-4.6 | integration + e2e | `api` › `AC-4.6 GET /api/settings` (bentuk persis, tanpa path DB/rahasia, no-store, env invalid → 500 menyebut variabel); `hk` › use-settings; E2E `m4-settings.spec.ts` › `AC-4.6 GET /api/settings + halaman Settings read-only`, `AC-4.6 tab Network memakai subnet server 10.99.0.0/24; 10.10.10.5 ditandai di luar subnet`; `m1-layout.spec.ts` › `/settings: halaman Settings read-only` | PASS |
| AC-4.7 | integration + e2e | `sst` (pidfile hidup+TFTP → online; basi → offline; env kosong → unknown; file hilang; media tak terbaca; probe nyata); `api` › `AC-4.7 GET /api/server-status`; `hk` › use-server-status; E2E `m4-settings.spec.ts` › `AC-4.7 top bar mengikuti GET /api/server-status` (page.route, 3 state); `m1-layout.spec.ts` › AC-1.11 | PASS |
| AC-4.8 | integration | `boot` › `AC-4.8 discovery GET /boot/{mac}.ipxe` (MAC dash/uppercase → discovered, MAC normal, QEMU, uefi, current_ip = X-Real-IP, last_seen = jam injeksi; panggilan kedua tanpa duplikat; MAC invalid → 400; `#!ipxe` + text/plain) ; `oui.test.ts` QEMU | PASS |
| AC-4.9 | integration (+e2e) | `boot` › `AC-4.9 verifikasi IP` (IP bukan lease → lokal, host tidak dibuat/diubah, tanpa kernel/token; multi-lease; `PXE_TRUST_PROXY=0` mengabaikan X-Real-IP); `bsc` › request-ip; E2E `m4-discovery.spec.ts` test 1 | PASS |
| AC-4.10 | unit | `lea` › parseLeases (valid/rusak/non-ethernet/IPv6/kedaluwarsa), leaseMap (multi IP), readLeaseFile (file tidak ada → [], cache mtime, force), ipMatchesLease (baca ulang R8) | PASS |
| AC-4.11 | integration (+e2e) | `boot` › `AC-4.11 sinkron lease saat GET /api/hosts` (MAC baru → discovered + current_ip; host lama tidak berubah; tanpa duplikat; tanpa file → no-op); E2E `m4-discovery.spec.ts` test 1 | PASS |
| AC-4.12 | e2e | `m2-polling.spec.ts` › `AC-2.9/AC-4.12 host baru dari /boot/{mac}.ipxe muncul ≤ 6 dtk tanpa reload`; `m4-discovery.spec.ts` › `AC-4.9/4.11/4.12 …` (≤ 10 dtk) | PASS |
| AC-4.13 | integration | `boot` › `AC-4.13 GET /boot/entry.ipxe`; `bsc` › entryScript (inline snapshot, retry 3, base URL tidak aman ditolak) | PASS |
| AC-4.14 | integration | `boot` › `AC-4.14 boot lokal & mode wait` (tanpa job + discovered/done/failed/offline → `iseq … efi && exit` + `sanboot --drive 0x80`, tanpa kernel; wait → loop `sleep 30` terbatas, host ber-OS tetap lokal); `bsc` › local/wait | PASS |
| AC-4.15 | integration | `boot` › `AC-4.15 installer Ubuntu` (kernel/initrd/nfsroot/ds=nocloud-net/cloud-config-url/extra args persis, tanpa `url=`, sha256(token)=token_hash, boot_served_at + stage booting, boot ulang = token baru & lama 404); `bsc` › Ubuntu | PASS |
| AC-4.16 | integration | `boot` › `AC-4.16` (Debian & Rocky inline snapshot; media hilang → lokal tanpa token; job Windows → lokal); `bsc` › Debian/Rocky/Windows | PASS |
| AC-4.17 | integration (+e2e) | `boot` › `AC-4.17 setelah configuring → boot lokal`; E2E `m4-discovery.spec.ts` AC-4.27 | PASS |
| AC-4.18 | unit | `gen` › `AC-4.18 Ubuntu autoinstall` (12 test: YAML, identity, network statis/DHCP/VLAN/iface, ssh, sudoers 0440 ada/tidak, sshd drop-in, storage, apt/timezone/locale, late-commands callback+first-boot+BootOrder+guard, error-commands, meta/vendor-data, golden `src/test/golden/installers/ubuntu-*.yaml`) | PASS |
| AC-4.19 | unit | `gen` › `AC-4.19 Debian preseed` (regex baris, hash/root-login/hostname/mirror/pkgsel, late_command didekode: authorized_keys 0600+chown, sudoers, sshd, interface via MAC, first-boot, callback; variasi; golden) | PASS |
| AC-4.20 | unit | `gen` › `AC-4.20 Rocky kickstart` (direktif, sshkey per key, network statis/DHCP/VLAN, `%`/`%end` seimbang, %post didekode, %onerror failed, golden) | PASS |
| AC-4.21 | unit | `gen` › `AC-4.21 Windows unattend.xml` (well-formed via DOMParser, ComputerName, > 15 char error, Identifier `52-54-00-…`, IP/prefix/gateway/DNS, FirstLogonCommands OpenSSH + administrators_authorized_keys didekode, tanpa `$6$`/password config, golden) | PASS |
| AC-4.22 | unit | `gen` › `AC-4.22 injeksi…` (13 input berbahaya × hostname/username/disk × 4 generator + komentar key × 4 + hash non-`$6$` + field lain) — semua kasus lulus (B-1 diperbaiki `3658754`) | PASS |
| AC-4.23 | integration (+e2e) | `boot` › `AC-4.23 GET /boot/{mac}/{token}/{file}` (200 + no-store; user-data pertama → installing; meta/vendor-data tidak mengubah status; 13 penolakan → 404 body identik: token salah/bentuk, token host lain, MAC invalid, IP asing, header IP hilang, network-config, file tak dikenal, file OS lain, IP lease MAC lain, expired; job configuring/done/failed → 404); E2E `m4-discovery.spec.ts` AC-4.27 | PASS |
| AC-4.24 | integration | `boot` › `AC-4.24 siklus token` (43 char base64url; file DB + WAL hanya hash; install ulang setelah failed → URL lama 404; done/hapus host mencabut; log console yang ditangkap tanpa token); `bsc` › tokens | PASS |
| AC-4.25 | integration (+e2e) | `cfg` › AC-3.11 + M4 (tanpa credentials ditolak, media tidak tersedia, Windows "hanya generator", bulk job+host booting, tanpa token); `boot` › `AC-4.25 install (service)` (job+host booting+osAssigned, host berjalan gagal, partisi custom/user SSH beda/OS tak dikenal); E2E `m3-bulk.spec.ts` AC-3.15 | PASS |
| AC-4.26 | integration (+e2e) | `boot` › `AC-4.26 callback` (maju + stages + status_since; sama → 200 tanpa perubahan; mundur → 409; tak dikenal → 400; IP statis untuk done, IP asing → 404; done → osInstalled/osAssigned null/current_ip/job selesai/token dicabut; failed → boot lokal; body rusak/terlalu besar) | PASS |
| AC-4.27 | e2e | `m4-discovery.spec.ts` › `AC-4.27 Install dari Sheet → pill Booting → Installing → Configuring → Done tanpa refresh` (+ OS tab: ubuntu-22.04 nonaktif + alasan, Windows nonaktif + catatan password + alert peringatan); `hk` › installBlockReason | PASS |
| AC-4.28 | unit-shell | `infra/test/run.sh` (33 test, virsh/virt-install/qemu-img/ssh PALSU, PATH terisolasi): idempotensi net-up, XML, nama `^pxe-test-`, node.sh/cleanup.sh menolak nama terlindungi tanpa virsh, path disk, `bash -n`, kvm-run dry-run end-to-end; + `redact-evidence` (token path/`token=`/`$6$` disamarkan exit 0, blob base64 berisi token/`$6$`/key disamarkan (B-5), header private key exit 1, argumen salah exit 2, dipanggil di `finish()`) — `infra-test.log` 33/33 | PASS |
| AC-4.29 | kvm | `infra/kvm-run.sh` → `kvm/server-check.txt` (`server/verify-listen.sh` RESULT PASS, layanan aktif, Next `127.0.0.1:3000`, `/api/settings` cidr `10.99.0.0/24`, vmlinuz 200, sha256 TFTP = `media.log`; `# server-check exit=0`) — attempt resmi `kvm/` 20261105T135915Z @ `b3a7ed4` | PASS |
| AC-4.30 | kvm | `dashboard/e2e-kvm/m4-install.spec.ts` › `AC-4.30 pxe-test-m4-node11 (uefi) install via dashboard → Done ≤ 30 menit` — attempt resmi `kvm/` 20261105T135915Z @ `b3a7ed4`: booting 14:00:14 → installing 14:00:51 → configuring 14:06:16 → done 14:09:56 (603 s, UI tanpa reload + API); dnsmasq `sent /srv/pxe/tftp/snponly.efi`, nginx `user-data` 200 dari node (token `***`). Bukti `kvm/pxe-test-m4-node11-status.txt`, `-console.txt` (boot lokal: `exit 1` → BdsDxe `Boot0008 "Ubuntu"` shimx64.efi), `kvm/server-dnsmasq.txt`, `kvm/server-nginx.txt`, `kvm/screenshots/pxe-test-m4-node11-*.png` | PASS |
| AC-4.31 | kvm | `m4-install.spec.ts` › `AC-4.31 pxe-test-m4-node11/12: SSH key login, verifikasi, password ditolak, reboot dari disk` + `dashboard/e2e-kvm/verify-node.sh` (hostname, IP/MAC, gw, DNS, user, `sudo -n`, authorized_keys persis 0600, `sshd -T passwordauthentication no`, root fs disk lokal) sebelum & sesudah reboot; password → `Permission denied (publickey)`; kernel installer di serial 4 → 4; status tetap done, `/boot/<mac>.ipxe` lokal; kvm-run verify-node ulang — attempt resmi `kvm/` 20261105T135915Z @ `b3a7ed4`. Bukti `kvm/pxe-test-m4-node1{1,2}-verify-ssh.txt`, `-verify.txt` | PASS (node11 217 s, node12 28 s) |
| AC-4.32 | kvm | `m4-install.spec.ts` (bagian AC-4.32 di test AC-4.30/4.33) — `kvm/pxe-test-m4-node1{1,2}-negative.txt`: `/boot/<mac>.ipxe` dari host 10.99.0.1 → script lokal tanpa token, token acak → 404, current_ip tetap — attempt resmi `kvm/` 20261105T135915Z @ `b3a7ed4`; versi lokal `boot` › `AC-4.32 (lokal)` | PASS |
| AC-4.33 | kvm | `m4-install.spec.ts` › `AC-4.33 pxe-test-m4-node12 (bios) install via dashboard → Done ≤ 30 menit` — attempt resmi `kvm/` 20261105T135915Z @ `b3a7ed4`: booting 14:13:36 → installing 14:14:16 → configuring 14:19:37 → done 14:20:07 (393 s); dnsmasq `undionly.kpxe`/iPXE pcbios; reboot → `Booting from SAN device 0x80` (sanboot) → `m4-node12 login:` tanpa installer kedua; SSH key + hostname benar (AC-4.31 node12). Bukti `kvm/pxe-test-m4-node12-status.txt`, `-console.txt`, `-verify-ssh.txt` | PASS |
| AC-4.34 | kvm | `kvm-run.sh` trap cleanup (`kvm/cleanup.txt`: tanpa VM `pxe-test-m4-*`/`pxe-test-server`, disk `pxe-test-server.qcow2` dihapus, key run `.agent/keys/pxe-test-m4-*` dihapus; network `pxe-test` tetap) + `kvm/libvirt-before.txt` vs `kvm/libvirt-after.txt` (domain & network identik: `ubuntu24.04`, `default`, `int`) + `redact-evidence.sh` (redact ok, scan ulang 193 file bersih) + afterAll `scanEvidence` kini juga mendekode blob base64 (UTF-8/UTF-16LE, offset 0–3, bertingkat; token `/boot/`, `$6$`, private key, password run) → `kvm/evidence-scan.txt` bersih + `kvm/results.json` (status + durasi per AC) + `secret-scan.txt` (+ `b64-scan.py`: hanya blob sshd drop-in `PasswordAuthentication no`, bukan secret) — attempt resmi `kvm/` 20261105T135915Z @ `b3a7ed4`; B-5 tidak muncul lagi (URL callback dari `/proc/cmdline`) | PASS |

## AC tanpa test yang lulus

- (iter 1) AC-4.22: 1 kasus gagal (B-1). AC-4.28: 1 test gagal (B-2) — keduanya diperbaiki di `3658754`.
- (KVM attempt2 2026-11-05T12:00Z) AC-4.30 FAIL karena B-3 (diperbaiki `ab2904f`). Bukti di `kvm/attempt2-20261105T120018Z/`.
- (KVM attempt3 2026-11-05T12:28Z @ `ab2904f`) AC-4.30 FAIL karena **B-4**; AC-4.31/AC-4.33 NOT_RUN; AC-4.34 FAIL karena **B-5**. Gate M4 mensyaratkan bukti KVM.

- (KVM attempt4 2026-11-05T13:32Z @ `b3a7ed4`, `kvm/attempt4-20261105T133207Z/`) AC-4.29/4.30/4.31(node11)/4.32 PASS; AC-4.33 gagal di harness (bug test, bukan produk — lihat bawah), run dihentikan.
- (KVM attempt resmi 2026-11-05T13:59Z @ `b3a7ed4`, `kvm/`) **AC-4.29..AC-4.34 semua PASS** (B-4 dan B-5 terverifikasi beres).

## Bug test attempt4 (diperbaiki test-engineer, bukan pelemahan)

- `dashboard/e2e-kvm/m4-install.spec.ts` (sebelumnya :94-97) menempel public key run yang sama
  sebagai *key baru* untuk setiap node. Saat node11 key masuk library (`m4-11-run-key`); untuk node12
  produk (G3-3, M3) dengan benar menolak key baru ber-fingerprint sama → `PATCH /api/hosts/525400990012`
  **422** (`attempt4-…/server-nginx.txt` 13:46:15), lalu spec menunggu `POST /install` tanpa batas
  (Playwright `actionTimeout` 0) → di-SIGINT 13:57:51, trap cleanup berjalan
  (`attempt4-…/interrupted.txt`). Perbaikan: bila key run sudah ada di library (`GET /api/ssh-keys`,
  cocok type+blob) centang `#lib-<id>` dan tegaskan `aria-checked=true`; bila belum, tempel sebagai key
  baru seperti sebelumnya. Ditambah assertion lebih ketat: `PATCH` simpan harus 200 (gagal cepat dengan
  body error). Verifikasi tetap sama (authorized_keys berisi persis key itu).
- `dashboard/e2e-kvm/kvm-harness.ts` `scanEvidence`: ditambah deteksi secret di blob base64
  (`base64Secret`, selaras `infra/redact-evidence.sh` `_b64_secret` dan `b64-scan.py`); temuan
  base64 tidak disamarkan oleh harness → dilaporkan sebagai temuan (AC-4.34-scan FAIL).
  Diuji manual pada data sintetis (token URL base64, `$6$` UTF-16LE dengan offset, base64 bertingkat,
  password run base64 → terdeteksi; blob sshd `PasswordAuthentication` → tidak).

## Bug baru (attempt3)

- **B-4 (major, produk)** `dashboard/src/lib/server/boot-script.ts:46` (`localBootScript`: `iseq ${platform} efi && exit ||`; juga `:38` entryScript `:fail … exit`, `:47`, `:61`). iPXE `exit` tanpa argumen = status 0 → `snponly.efi` kembali `EFI_SUCCESS` ke OVMF; BdsDxe (UEFI spec: Boot#### yang kembali sukses → tampilkan boot manager menu) membuka `BootManagerMenuApp` dan berhenti memproses BootOrder, sehingga opsi `Ubuntu` (disk) tak pernah dicoba. Log: `kvm/pxe-test-m4-node11-console.txt` akhir (`Tidak ada instalasi aktif: boot dari disk lokal` → `No more network devices` → `BdsDxe: loading Boot0000 "BootManagerMenuApp"` → menu `Please select boot device`). Dampak: OS terpasang tidak boot → `pxe-callback-done.service` tak jalan → status tertahan `configuring`. Late-command efibootmgr (Ubuntu dulu) tidak berpengaruh karena OVMF menimpa BootOrder dari fw_cfg (risiko R2). Repro: `infra/kvm-run.sh m4` (node 11:uefi). Kandidat perbaikan (untuk backend-dev): `exit 1` di jalur EFI agar BDS lanjut ke opsi berikutnya; test integration/inline snapshot `bsc`/`boot` perlu ikut.
- **B-5 (major, keamanan bukti)** `infra/redact-evidence.sh` dan scan afterAll `dashboard/e2e-kvm/` hanya mencari token pada path `/boot/` teks biasa; subiquity mencetak late-command `printf %s '<base64 callback URL berisi token>' | base64 -d > /target/etc/pxe-callback/url` ke console serial (generator `dashboard/src/lib/server/installers/firstboot.ts`, `b64write(...CALLBACK_URL_FILE...)` baris 51; pola redaksi `infra/redact-evidence.sh:24,33`). Token lolos ke `kvm/pxe-test-m4-node11-console.{log,txt}`; `evidence-scan.txt` melaporkan 0 temuan. Disamarkan manual (`<REDACTED-B64-CALLBACK-URL-WITH-TOKEN>`); token sudah mati (DB server dihapus saat cleanup). `.agent/runs/m4/b64-scan.py` ditambahkan ke `secret-scan.txt` sebagai deteksi.

## Carry-over gate M3 (diperiksa)

| Item | Test | Status |
|---|---|---|
| CR-1-10 guard spec rekursif | `playwright.config.ts` (`readdirSync(…, { recursive: true })`); bukti `guard-cr-1-10.log` (spec yatim di subfolder → config gagal dimuat) | PASS |
| I-3-14 hash `$6$pxelab$` di `configs/autoinstall/user-data` | `db` › `tidak ada hash lab … configs/autoinstall (I-3-14)` | PASS |
| SR-3-5 allowlist Host | `http.test.ts`, `i2r` › SR-3-5 | PASS |
| SR-2-1 / CR-3-12 | `db` › G-SEC-2/SR-2-1; `cfg` › SR-2-1 | PASS |
| CR-3-4 peekConfig | `db` › `peekConfig/configOrDefault tidak menulis baris` | PASS |
| CR-3-15 budget planIps | `dashboard/src/lib/net-carryover.test.ts` | PASS |
| CR-1-7 status server nyata | AC-4.7 di atas | PASS |
| DR-1-3 toast Inter | `iter3-ui.spec.ts` › M2 hapus host (sukses & gagal): font toast `"Inter Variable"` | PASS |
| DR-2-3 hostname mono di judul toast | `iter3-ui.spec.ts` › hostname `.type-data` `"JetBrains Mono Variable"` | PASS |
| CR-2-11 use-now | `hk` › `carry-over CR-2-11 use-now` | PASS |
| I-3-8 shadow toast.error | `iter3-ui.spec.ts` › `M2 hapus host gagal → toast.error datar` | PASS |

## Hasil run (sesi ini, 2026-11-05T13:33–14:22Z @ `b3a7ed4` + perubahan test e2e-kvm)

| Perintah | Exit | Ringkasan |
|---|---|---|
| `npm run typecheck` | 0 | bersih |
| `npm run lint` | 0 | bersih |
| `npm test` (vitest + coverage v8) | 0 | 766/766 lulus, 30 file; all files lines 99.14% / branches 96.94%; kode baru M4 lines 1512/1526 = 99.08% / branches 1320/1363 = 96.85% (`coverage-m4-new-code.txt`) |
| `npm run test:e2e` | 0 | 69/69 lulus |
| `bash infra/test/run.sh` | 0 | 33/33 lulus |
| `infra/kvm-run.sh m4` (attempt resmi 20261105T135915Z) | 0 | Playwright KVM 4/4 lulus (20.7 menit), verify ×2 ok, redact ok, cleanup done |
| guard CR-1-10 | — | spec yatim di subfolder → config gagal dimuat (exit 1) |
| scan secret bukti | — | bersih |

## Bug produk / temuan (tidak diperbaiki test-engineer)

- **B-1 (AC-4.22)** `dashboard/src/lib/server/installers/context.ts:80-81` — `validateContext`
  memanggil `validateHostname(c.hostname)` yang men-*trim* input, tanpa cek
  `c.hostname === c.hostname.trim()` (berbeda dengan username di baris 82-83). Hostname dengan
  `\r`/`\n`/spasi di tepi lolos validasi generator. Windows: `xmlEscape` mempertahankan CR,
  parser XML menormalkan CR→LF sehingga `ComputerName` ter-parse `"n1\n"` ≠ `"n1\r"` (bukan
  "nilai persis", bukan penolakan). Ubuntu/Windows juga menerima `"n1\n"` apa adanya ke
  `identity.hostname`/`ComputerName`. Repro: `windowsUnattend({...ctx, hostname: "n1\r"})`
  (test `installers.test.ts` › `AC-4.22 … windows: hostname = "n1\r"`). Jalur API aman (hostname
  di-trim `config-service.ts` sebelum disimpan), jadi dampak hanya pada pemanggilan generator
  langsung — tetap melanggar AC-4.22.
- **B-2 (AC-4.28)** `infra/cleanup.sh:18` — run id divalidasi `^[a-z0-9]+$`, sehingga
  `cleanup.sh default` dan `cleanup.sh int` diterima (exit 0) dan menjalankan `virsh list`/
  `net-list` (baca saja; tidak ada mutasi, VM/network milik user tidak tersentuh — dibuktikan test).
  AC-4.28 menuntut penolakan exit ≠ 0 tanpa perintah virsh untuk nama `default`/`int`.
  (`pxe-test-node01`, `ubuntu24.04` sudah ditolak.)

Observasi (minor, untuk reviewer):
- `infra/kvm-run.sh` tidak memanggil pemindaian/penyamaran token pada bukti setelah
  `collect_evidence` (console `*-console.txt` dibuat SETELAH Playwright selesai). Suite
  `e2e-kvm` memindai di `afterAll`, tetapi console txt, `server-nginx.txt`, dan journal dibuat
  sesudahnya → perlu langkah akhir (mis. `node` menjalankan `scanEvidence`) sebelum bukti AC-4.34
  dianggap bersih.
- `infra/kvm-run.sh` membuang stdout `net-up.sh` (`>/dev/null`) sehingga rencana `net-define`
  tidak tampil di dry-run kvm-run (diuji terpisah lewat `net-up.sh` dry-run).
- Kontrak `kvm-run.sh` mencari `dashboard/e2e-kvm/verify-node.sh`; plan/Orchestrator menyebut
  `infra/verify-node.sh` → disediakan sebagai symlink ke file yang sama.
- Alert `windows-warning` di tab OS hanya terjangkau bila config tersimpan sudah Windows (radio
  Windows selalu nonaktif karena `bootable=false`); E2E menguji jalur itu.

## Uji KVM nyata 2026-11-05 (test-engineer)

- Attempt 1 (`kvm/attempt1-20261105T115847Z/`): gagal karena **bug test** di
  `dashboard/e2e-kvm/m4-install.spec.ts:67` — firmware ditegaskan seketika saat host muncul dari
  lease dnsmasq (`discovery.ts` menyimpan `firmware: null` sampai iPXE meminta `?platform=`).
  Diperbaiki dengan `expect.poll` (≤ 5 menit) dengan nilai yang dituntut sama
  (`{vendor: "QEMU/KVM", firmware: node.fw}`); bukan pelemahan.
- Attempt 2 (`kvm/`): **B-3 (infra, blocker AC-4.30/4.31/4.33)** `infra/node.sh:40-45` —
  `virt-install ... --pxe --boot network,hd --noautoconsole` menjalankan domain dengan XML fase
  install (`<on_reboot>destroy</on_reboot>`, QEMU `-no-reboot`); XML persisten `restart`. Karena
  virt-install tidak menunggu, XML live tetap `destroy`, sehingga `infra/node.sh reset`
  (`virsh reset`, dipanggil harness setelah Install) **mematikan** node: `domstate --reason` =
  `shut off (shutdown)`, console berhenti 12:01:10Z tepat setelah reset, status host tetap
  `booting`. Reboot akhir installer juga akan mematikan VM. Bukti `kvm/diag-B3-reset-shutdown.txt`.
  Repro: `infra/node.sh create pxe-test-m4-node11 52:54:00:99:00:11 uefi` → `virsh dumpxml
  pxe-test-m4-node11 | grep on_reboot` (live: destroy) → `infra/node.sh reset pxe-test-m4-node11`
  → `virsh domstate --reason` = shut off. Usulan (backend-dev): definisikan node tanpa fase
  install (mis. `--install no_install=yes` atau `--import` + `--boot network,hd`), atau restart
  domain setelah virt-install; test infra perlu menegaskan `on_reboot=restart` pada XML live.
  Run dihentikan setelah 20 menit tanpa progres (SIGINT Playwright); trap cleanup berjalan.

