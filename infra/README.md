# infra/ — lab KVM uji PXE (`pxe-test-*`)

Script bash idempoten (`set -euo pipefail`) untuk lab uji M4 (DEC-003, DEC-009). Semua resource
libvirt berprefix `pxe-test-`; `pxe-test-node01`, `ubuntu24.04`, `default`, `int` milik user dan
ditolak oleh `lib.sh` (`assert_name`). Tanpa sudo di host. DHCP/TFTP hanya dnsmasq **di dalam**
VM `pxe-test-server`, terikat ke NIC `pxe0` (network `pxe-test`).

| Script | Fungsi |
|---|---|
| `net-up.sh` / `net-down.sh` | Network `pxe-test` (`virbr-pxe`, 10.99.0.1/24, isolated, tanpa dhcp, DNS libvirt mati) dan `pxe-test-nat` (`virbr-pxenat`, 192.168.199.1/24, NAT, tanpa dhcp/DNS). XML di `net/`. `net-down.sh` hanya di akhir semua milestone. |
| `fetch-node.sh` | Node 22 LTS resmi (nodejs.org) → `.agent/media/`, verifikasi SHA256. |
| `server-base.sh` | Sekali: `.agent/vms/pxe-test-server-base.qcow2` dari cloud image Ubuntu 24.04 + cloud-init (`cloud-localds`): dnsmasq/nginx/nfs-kernel-server/nftables, Node, user `pxe`, root key-only (key `.agent/keys/infra_ed25519`, dibuat bila belum ada). Marker `.ready`. ±1 menit. |
| `server-up.sh` / `server-down.sh [--purge]` | VM `pxe-test-server` (overlay qcow2 di atas base, 3 GB, 2 vCPU), NIC `pxe0` 10.99.0.2 + `nat0` 192.168.199.2, ISO Ubuntu/Debian/Rocky sebagai CD-ROM read-only (di-mount ke `/srv/pxe/media/*`). Menyalin file TFTP + Debian netboot, lalu `server/verify-listen.sh` → `.agent/runs/m4/kvm/server-listen.txt`; gagal ⇒ dnsmasq dihentikan, exit 1. |
| `node.sh create\|destroy <name> <mac> [uefi\|bios]` / `node.sh reset <name>` | VM node: qcow2 20G di `.agent/vms/`, 2 GB, 2 vCPU, `--pxe --boot network,hd --install no_install=yes` (tanpa tahap install virt-install → XML live `on_reboot=restart`, dicek pasca-create; UEFI: OVMF non-secure-boot). Console → `.agent/runs/<run>/kvm/<name>-console.log`. |
| `node.sh poweroff <name>` / `node.sh start <name> [mac]` | M5: `poweroff` = `virsh destroy` saja (definisi, NVRAM, disk tetap; uji matikan paksa di tengah install); `start` = `virsh start` dengan listener serial disambung (append). Menolak VM server & nama terlindungi. |
| `assert-server-logs.sh <runs-dir> <name=mac=fw[=min[=file]]>…` | M5 (CR-4-12): asersi log dnsmasq (TFTP `snponly.efi` ke IP lease node UEFI) dan nginx (`GET /boot/<mac>/***/<file>` 200 ≥ min; `file` = `user-data`/`preseed.cfg`/`ks.cfg`). M6 (CR-5-10): hasil → `server-log-asserts.json` (di-escape modul `json`) lalu digabung ke `results.json` lewat `results-json.py` (tanpa `sed`) + `server-log-asserts.txt`; FAIL = exit 1. |
| `results-json.py` | M6 (CR-5-10): penulis `results.json` (`add-entry`, `add`, `set`, `summary`), atomik; `results.json` rusak dipindah ke `.invalid-<ts>`, tidak ditimpa diam-diam. |
| `smoke.sh <name> <mac> <uefi\|bios>` | Smoke rantai boot dengan script iPXE statis (`smoke/boot-smoke.ipxe`); bukti → `.agent/runs/m4/kvm/smoke/`. |
| `cleanup.sh [run] [--server] [--base]` | Hapus VM `pxe-test-<run>-*` + disknya; `--server` undefine server + overlay; `--base` hapus base. Snapshot `virsh list`/`net-list` sebelum/sesudah → `cleanup.txt`. |
| `deploy-dashboard.sh` | Build `PXE_STANDALONE=1 npm run build` di host (`SKIP_BUILD=1` = pakai build ada) → rilis (standalone + static + public, tanpa `.env*`/DB) di-scp ke VM → `server/install-dashboard.sh`: `/opt/pxe-dashboard/releases/<ts>` + `current`, `/etc/pxe-dashboard.env` (`server/dashboard.env`: subnet 10.99.0.0/24, DB `/var/lib/pxe-dashboard`, lease dnsmasq, `PXE_TRUST_PROXY=1`, `PXE_ALLOWED_HOSTS=10.99.0.2`), unit `pxe-dashboard` (user `pxe`, `127.0.0.1:3000`), nginx `10.99.0.2:80` (X-Real-IP, X-Forwarded-*/Forwarded dibuang). Lalu `GET http://10.99.0.2/api/settings` dari host → `deploy-dashboard.txt`. M6: `PXE_ADMIN_PASS_FILE` (default `.agent/keys/<run>-admin.pass`, dibuat 0600 bila belum ada) → hash scrypt di host lewat `npm run admin:hash` (password via **stdin**) → overlay `admin.env` dikirim lewat **stdin** `ssh` → `server/install-dashboard.sh` mengganti `PXE_ADMIN_USERNAME`/`PXE_ADMIN_PASSWORD_HASH` (+ `PXE_JOB_BOOTING_TIMEOUT_MIN` bila `PXE_DEPLOY_BOOTING_TIMEOUT_MIN`) di `/etc/pxe-dashboard.env` (root:pxe 0640). Verifikasi: `/login` 200, `/api/settings` tanpa sesi 401, login admin (body lewat stdin `curl`) lalu `/api/settings` dengan sesi (`cidr`, `adminConfigured`). Password/hash tidak pernah di argv, log, atau bukti. |
| `kvm-run.sh <m> [--scenario core\|distro\|bulk] [--nodes "…"] [--waves] [--booting-timeout-min N] [--keep-server] [--skip-build]` | Orkestrasi suite KVM: `libvirt-before.txt` → preflight (alat, OVMF, RAM → `max_nodes`, suite `dashboard/e2e-kvm`) → `net-up` → `server-up` → password admin acak per run (`.agent/keys/<run>-admin.pass`, 0600) + `deploy-dashboard` → `server-check.txt` (`/login` 200, `/api/settings` tanpa sesi 401, media per OS, `nginx -t`) → key ed25519 sekali pakai → node `pxe-test-<run>-nodeNN` (MAC `52:54:00:99:00:NN`, IP `10.99.0.(10+NN)`; `--waves`: create → tunggu `GET /boot/<mac>.ipxe` → poweroff per gelombang) → Playwright `dashboard/e2e-kvm` → `verify-node.sh` per node (bergelombang bila `--waves`) + cek login password ditolak → bukti → asersi log server → cleanup → `libvirt-after.txt`/`libvirt-diff.txt` (resource terlindungi harus identik) → entri `cleanup` di `results.json` → `redact-evidence.sh` + scan password admin → ringkasan gabungan. Semua sesudah "bukti" **selalu** jalan (trap EXIT), termasuk run parsial; tahap gagal dicatat `failedStage`. Spec node `NN:uefi\|bios[:destroy\|:failpath][:os=ubuntu\|debian\|rocky]`. Skenario M6 (DEC-018 §4): `core` = `21:uefi:failpath 22:bios:destroy`, `distro` = `23:uefi:os=debian 24:uefi:os=rocky`, `bulk` = `25:uefi 26:uefi 27:uefi`; run id `<m><scenario>`, bukti `.agent/runs/<m>/kvm/<scenario>/`, ringkasan `.agent/runs/<m>/kvm/results.json`. Ringkasan langkah: `kvm-run.txt`. |
| `tftp/prepare.sh` | Salin `snponly.efi`/`undionly.kpxe` (paket `ipxe` Ubuntu noble) dari `.agent/media/ipxe/`, cek `tftp/SHA256SUMS`. Biner tidak di-commit. |

Konfigurasi server ada di `server/` (`dnsmasq.conf`, `nginx-pxe.conf`, `nftables.conf`, `nfs.conf`,
`exports`, `netplan.yaml`, `fstab.append`, `provision-root.sh`).

Rantai boot: UEFI → OVMF PXE → TFTP `snponly.efi` → iPXE; BIOS → ROM iPXE QEMU. Keduanya
(user-class `iPXE`) mendapat `http://10.99.0.2/boot/${mac}.ipxe?platform=${platform}` (diekspansi
iPXE). nginx menyajikan file statis `/srv/pxe/boot/<mac>.ipxe` bila ada, selain itu proxy ke
dashboard `127.0.0.1:3000` dengan `X-Real-IP`.

Catatan:
- Env: `INFRA_DRY_RUN=1` (cetak perintah mutasi), `PXE_RUN` (default `m4`), `PXE_AGENT_DIR`
  (default `.agent` checkout utama, juga dari worktree), `SERVER_RAM_MB` (≤ 3072), `NODE_RAM_MB`.
- Serial console: file serial libvirt `qemu:///system` dibuat root 0600 (tak terbaca tanpa sudo),
  jadi VM memakai chardev TCP `mode=connect` ke listener `socat` user di `127.0.0.1:<port>`.
- Operasi admin di dalam VM server (log dnsmasq, `ss -p`, restart layanan) memakai login `root`
  key-only ke VM uji itu sendiri — tidak ada sudo di host maupun di VM.
- Socket wildcard RPC NFSv3 (rpcbind/mountd/statd) tak bisa diikat ke satu IP; dilindungi
  nftables (drop koneksi baru dari `nat0`). Verifikasi menuntut nftables aktif.

Kontrak env untuk suite Playwright `dashboard/e2e-kvm` (diset `kvm-run.sh`): `PXE_KVM_BASE_URL`
(`http://10.99.0.2`), `PXE_KVM_RUN`, `PXE_KVM_RUNS_DIR`, `PXE_KVM_NODES`
(`<name>=<mac>=<uefi|bios>=<ip>` dipisah spasi), `PXE_KVM_NODE_USER`, `PXE_KVM_SSH_KEY`,
`PXE_KVM_SSH_PUBKEY`, `PXE_KVM_RESET_CMD` (panggil `<cmd> reset <name>` setelah Install),
`PXE_KVM_GATEWAY`/`PXE_KVM_DNS`/`PXE_KVM_PREFIX`; M5: `PXE_KVM_SPEC` (`<m>` → `e2e-kvm/<m>-*.spec.ts`),
`PXE_KVM_POWER_CMD` (`<cmd> poweroff|start <name>`), `PXE_KVM_DESTROY_NODES` (node berperan `destroy`).
Setelah bukti: ekspor `jobs-<name>.json` (riwayat + log job) dan `assert-server-logs.sh`.
nginx (`server/nginx-pxe.conf`, DEC-015): UI + `/api/**` hanya IP admin (`PXE_ADMIN_ALLOW`, default
`10.99.0.1`, disubstitusi `deploy-dashboard.sh`); `/boot/**` dan `/media/**` terbuka; `/api/jobs/`
tanpa buffering (SSE). `cleanup.sh` menolak run id `server*`/`nat*` dan tidak pernah menghapus disk
`pxe-test-server*` (CR-4-13); `redact-evidence.sh` hanya mengubah file teks, biner tetap dipindai (CR-4-14). `verify-node.sh` menerima `EXPECT_HOSTNAME`,
`EXPECT_IP`, `EXPECT_PREFIX`, `EXPECT_MAC`, `EXPECT_GW`, `EXPECT_DNS`, `EXPECT_USER`, `EXPECT_PUBKEY`.

Kontrak env tambahan M6 (`kvm-run.sh` → suite): `PXE_KVM_SCENARIO`, `PXE_KVM_NODES` diperluas
`<name>=<mac>=<fw>=<ip>=<os>=<role>=<hostname>` (4 field pertama tetap), `PXE_KVM_FAILPATH_NODES`,
`PXE_KVM_ADMIN_USER`, `PXE_KVM_ADMIN_PASS_FILE` (path saja; isi dibaca suite, tidak pernah di-log),
`PXE_KVM_MAX_NODES`, `PXE_KVM_WAVES` (`"a,b c"`), `PXE_KVM_BOOTING_TIMEOUT_MIN`. `PXE_KVM_RUN` = run id
(`m6core` …), `PXE_KVM_SPEC` = milestone (`m6`). Hostname bulk = `<m>-bulk-NN` sesuai urutan `--nodes`.
Env harness: `PXE_KVM_MEMINFO` (default `/proc/meminfo`), `PXE_KVM_DISCOVER_TIMEOUT_SEC` (600),
`PXE_ADMIN_USERNAME` (`pxeadmin`), `PXE_DASHBOARD_DIR`; `PXE_KVM_DRY_FAIL_AT=<tahap>` hanya berlaku di
dry-run (test harness). Media Debian/Rocky (DEC-018 §2, O11-A) disajikan dari ISO lokal yang di-mount
di VM server (`/media/debian-12`, `/media/rocky-9`, kernel netboot Debian `/media/debian-netboot`);
cadangan O11-C: direktori `.agent/media/extra-<nama>/` (diunduh host dari mirror resmi + diverifikasi)
otomatis disajikan `server-up.sh` sebagai `/media/extra-<nama>/`. Node tetap di `pxe-test` tanpa NAT.

## Asumsi keamanan

Lab dan deploy rujukan ini mengasumsikan **LAN provisioning terisolasi** (`pxe-test`: tanpa
`<forward>`, tanpa DHCP libvirt; dnsmasq hanya di VM server, terikat `pxe0`). Konsekuensi dan
kontrol yang berlaku (DEC-015, DEC-017, SR-4-7, SR-4-8, SR-5-15):

- **HTTP polos.** nginx melayani `10.99.0.2:80` tanpa TLS (iPXE/installer lab tidak memakai HTTPS).
  Penyadap aktif di segmen yang sama dapat membaca cookie sesi, token per-MAC, dan isi file
  konfigurasi. HTTPS di luar cakupan M6; deploy di luar lab wajib menaruh UI/API di belakang TLS.
- **Cookie sesi tanpa `Secure` di lab.** `pxe_session` tetap `HttpOnly` + `SameSite=Strict`; `Secure`
  hanya aktif bila `PXE_BASE_URL` https. Mitigasi: idle 240 mnt (KVM) / 120 mnt (default), absolut 12 jam.
- **Lapisan akses admin:** (1) allowlist IP nginx (`PXE_ADMIN_ALLOW`, default host lab `10.99.0.1`)
  untuk UI + `/api/**`; (2) login admin wajib untuk semua API (sesi server-side, hash scrypt di env,
  tanpa kredensial default; production tanpa admin valid menolak start); (3) rate limit aplikasi
  (login per IP+username dan per IP, API per sesi, SSE per sesi) sebagai sumber kebenaran, ditambah
  `limit_req` nginx sebagai lapis kedua (login 10 r/mnt burst 5; `/boot/` 20 r/dtk burst 100,
  longgar untuk installer bulk). `/boot/**` dan `/media/**` sengaja terbuka untuk klien PXE;
  otorisasi `/boot/<mac>/<token>/…` = token per-MAC + binding IP lease (DEC-008/013).
- **Password admin run KVM** dibuat acak per run di `.agent/keys/<run>-admin.pass` (0600, gitignored),
  hanya lewat stdin ke `npm run admin:hash`/`curl`; hash hanya lewat stdin `ssh` ke VM; keduanya
  dihapus/tidak pernah di-log; bukti dipindai (`redact-evidence.sh`: token, `$6$`, `scrypt$`,
  private key, teks & base64; scan literal password admin di `kvm-run.sh`).
- **Sisa risiko SR-4-7(b):** log installer di disk target (`/var/log/installer`, log anaconda) dapat
  memuat URL `/boot/<mac>/<token>/…` dari job yang sudah selesai. Token itu sudah dicabut saat job
  Done/Failed sehingga tidak bisa dipakai ulang; tidak diasersi. Yang **diasersi** (`verify-node.sh`):
  `/proc/cmdline`, `/etc/default/grub`, `grub.cfg`, entri BLS, `/etc/kernel/cmdline`,
  `/root/anaconda-ks.cfg` bebas token, `/etc/pxe-callback` hilang.
- **Sisa risiko DEC-021 (apt Debian tanpa verifikasi tanda tangan selama instalasi).** Repo DVD
  Debian di server PXE tidak bertanda tangan (`Release` tanpa `InRelease`/`Release.gpg`), sehingga
  selama instalasi apt di target memakai sumber `[trusted=yes by-hash=no]` dan
  `debian-installer/allow_unauthenticated true`: paket **tidak** diverifikasi tanda tangannya.
  Dibatasi fail-closed (DEC-022 §2): hanya untuk **media lokal** (host `PXE_MEDIA_URL` =
  `PXE_SERVER_IP`); media Debian lain ditolak dashboard (422) dan generator tidak mengeluarkan
  `trusted=yes`. `trusted=yes` dan `00AllowUnauthenticated` dihapus di `late_command` (sebelum unit
  firstboot dipasang) dan diverifikasi lewat SSH di run KVM `distro` (`e2e-kvm/m6-distro.spec.ts`:
  `trusted_files=0`, tidak ada `trusted=yes` di `/etc/apt/` target). Integritas ISO dijamin checksum resmi sebelum
  dipakai (`.agent/runs/m6/kvm/media-checksums.txt`); jaringan `pxe-test` terisolasi.
- **Sesi: polling memperpanjang idle (DEC-019 §1).** Setiap request API tab yang terbuka (polling
  5 dtk, SSE) menggeser batas idle (`PXE_SESSION_IDLE_MIN`), jadi idle praktis tidak habis selama
  tab dashboard terbuka. Batas atas tetap **absolut** `PXE_SESSION_MAX_HOURS` (default 12 jam) sejak
  login, apa pun aktivitasnya; setelah itu login ulang.
- **Rate limit login tanpa `PXE_TRUST_PROXY` (SR-6-3).** Tanpa `PXE_TRUST_PROXY=1` IP klien tidak
  diketahui (`X-Real-IP` diabaikan), sehingga batas login per IP menjadi **global** untuk semua klien:
  satu pihak dapat mengunci login admin selama `PXE_LOGIN_WINDOW_MIN`. Brute force tetap dibatasi.
  Server production tanpa `PXE_TRUST_PROXY=1` mencetak `[pxe] peringatan: …` saat start; deploy
  rujukan memakai nginx (menimpa `X-Real-IP` dengan `$remote_addr`) + `PXE_TRUST_PROXY=1`.
- **Over-redaksi bukti** diterima (lihat docstring `dashboard/src/lib/server/redact.ts`): lebih baik
  bukti tersamar berlebih daripada secret lolos.

Contoh:
```
infra/net-up.sh && infra/server-up.sh
infra/smoke.sh pxe-test-m4-smoke01 52:54:00:99:00:01 uefi
infra/smoke.sh pxe-test-m4-smoke02 52:54:00:99:00:02 bios
infra/cleanup.sh m4 && infra/server-down.sh
INFRA_DRY_RUN=1 infra/kvm-run.sh m4        # cetak rencana tanpa mutasi
infra/kvm-run.sh m4 --nodes "11:uefi"      # gate AC-4.30/31 saja
INFRA_DRY_RUN=1 infra/kvm-run.sh m6 --scenario bulk --waves   # rencana gelombang M6
infra/kvm-run.sh m6 --scenario core                          # UEFI+BIOS Ubuntu, uji negatif
infra/kvm-run.sh m6 --scenario distro                        # Debian 12 preseed + Rocky 9 kickstart
infra/kvm-run.sh m6 --scenario bulk --waves                  # 3× UEFI Ubuntu bergelombang
infra/test/run.sh                                            # test shell infra (virsh/ssh palsu)
```
