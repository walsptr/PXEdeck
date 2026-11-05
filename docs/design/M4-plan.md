# M4 — Backend + integrasi iPXE (plan)

- Milestone: 4 · Branch: `milestone/4-backend-ipxe`
- Sumber: SPEC §4 (Settings, OS Images), §5 (discovery, boot per-MAC, generator, callback,
  model data, API), §6 (hash, token per-MAC, validasi server), §7; DEC-003 (topologi KVM),
  DEC-004 (coverage, termasuk `src/app/boot/**`), DEC-005 (seam reset, tanpa route `__test__`),
  DEC-006 (subnet dari satu sumber konfigurasi); CLAUDE.md §Pengujian KVM.
- Opsi & rekomendasi: `docs/design/M4-options.md` (O1–O12). Plan ini ditulis dengan asumsi
  rekomendasi diterima. Bila Orchestrator memilih lain, AC yang terdampak ditandai `[O<n>]`.
- Kode yang diganti/dibangun di atasnya: `src/lib/server/mock-hosts.ts`,
  `src/lib/server/config-service.ts`, `src/lib/host-config.ts`, `src/lib/net.ts`
  (`MGMT_NETWORK`), `src/lib/os-images.ts`, `src/lib/oui.ts`, route di `src/app/api/**`.
  Lab asli yang dipakai ulang: `configs/autoinstall/user-data` (late-commands BootOrder, guard
  `pxe-force-reboot`), `scripts/pxe-nodes` (netplan match MAC, aturan IP), `configs/dnsmasq/pxe.conf`.

## 1. Scope

Masuk M4:
1. **Persistence nyata** (`node:sqlite`) menggantikan store mock: hosts, host_configs,
   os_images, ssh_keys (+ join), jobs (minimal: status, stages, token), migrasi, seam
   `resetDb()` + seed `empty|demo` (DEC-005). Simulasi tahap/discovery mock dihapus dari jalur
   produksi.
2. **Konfigurasi via env** (zod, fail fast) menggantikan konstanta `MGMT_NETWORK`;
   `GET /api/settings`; halaman Settings read-only; form Network memakai subnet dari server.
3. **Discovery**: `GET /boot/entry.ipxe`, `GET /boot/{mac}.ipxe` (upsert host, vendor OUI,
   firmware, current_ip, last_seen) + parser lease dnsmasq sebagai pelengkap dan sumber
   verifikasi IP.
4. **Script boot per-MAC**: boot lokal tanpa job; installer bila ada job Install aktif untuk
   Ubuntu (kernel/initrd HTTP + root NFS + nocloud), Debian (netboot + `preseed/url`), Rocky
   (`inst.repo` + `inst.ks`). Windows: generator saja, install ditolak 422.
5. **Generator** user-data/meta-data/vendor-data (Ubuntu), preseed (Debian), kickstart (Rocky),
   unattend.xml (Windows): hash password, hostname, network statis match MAC, authorized_keys,
   sudo, disable password SSH, callback, aman dari injeksi.
6. **Akses file konfigurasi**: `/boot/{mac}/{token}/{file}` dengan token per job + binding MAC
   dan IP lease (O2/O3).
7. **Callback minimum**: `POST /boot/{mac}/{token}/status` (`installing|configuring|done|failed`)
   sehingga status mencapai Done; setelah `configuring` host boot lokal.
8. **Status server nyata** (`GET /api/server-status`) untuk top bar.
9. **API** `GET/POST/DELETE /api/os-images`, `GET/POST/DELETE /api/ssh-keys` (backend; halaman
   UI OS Images/SSH Keys = M5).
10. **Infrastruktur test KVM** di `infra/` + run KVM UEFI dan BIOS Ubuntu 24.04.

### Pembagian M4 / M5 / M6 (eksplisit)

| Hal | M4 | M5 | M6 |
|---|---|---|---|
| Tabel `jobs` | dibuat; dipakai untuk token, status, `stages[]` timestamp | `GET /api/jobs`, `GET /api/jobs/:id/logs` (SSE), halaman Provisioning Jobs + timeline | — |
| Callback | `installing` (diturunkan dari fetch config), `configuring`, `done`, `failed` | log installer (stream), callback per tahap tambahan, timeout watchdog → `failed`, status `offline` dari last_seen | — |
| Generator | 4 OS lengkap + unit test | — | — |
| KVM | UEFI Ubuntu, BIOS Ubuntu, negatif config dari IP salah | `virsh destroy` tengah install → Failed setelah timeout, install ulang | UEFI Debian 12, UEFI Rocky 9, bulk 3× UEFI Ubuntu, E2E penuh |
| Auth | endpoint `/boot/**` dengan token; `/api/**` belum login | — | login admin, semua `/api/**` butuh auth, rate limit |
| UI | Settings read-only, form Network dari settings, OS tab dari `/api/os-images`, top bar status nyata | halaman OS Images, SSH Keys (CRUD), Jobs | — |

Alasan memindahkan Debian/Rocky/bulk ke M6: lihat O12 (repo offline, RAM anaconda, RAM bulk,
ketergantungan timeout M5). Gate M4 tetap terpenuhi oleh UEFI Ubuntu (bukti: PXE boot → config
diterima → Done → SSH dengan key yang di-inject).

Tidak masuk M4: login dashboard, edit Settings dari UI (butuh menulis config dnsmasq sebagai
root), Secure Boot / GRUB-over-HTTP (DEC-003), aksi "Reboot ke PXE" nyata (IPMI/Redfish).

## 2. Rancangan teknis

### 2.1 Konfigurasi (env)
`src/lib/server/settings.ts`, divalidasi zod sekali saat start; error menyebut nama variabel.
`dashboard/.env.example` berisi nilai dummy/default lab.

| Variabel | Default (lab) | Lingkungan KVM |
|---|---|---|
| `PXE_DB_PATH` | `./data/pxe.db` | `/var/lib/pxe-dashboard/pxe.db` |
| `PXE_SEED` | `empty` (`demo` hanya bila `NODE_ENV!=production`) | `empty` |
| `PXE_MGMT_CIDR` | `10.10.10.0/24` | `10.99.0.0/24` |
| `PXE_MGMT_GATEWAY` | `10.10.10.1` | `10.99.0.1` |
| `PXE_MGMT_DNS` | `10.10.10.1` | `10.99.0.2` |
| `PXE_SERVER_IP` | `10.10.10.1` | `10.99.0.2` |
| `PXE_DHCP_RANGE` | `10.10.10.100-10.10.10.200` | `10.99.0.100-10.99.0.200` |
| `PXE_DHCP_INTERFACE` | `enp7s0` (tampilan) | `pxe0` |
| `PXE_BASE_URL` | `http://10.10.10.1` | `http://10.99.0.2` |
| `PXE_MEDIA_URL` | `${PXE_BASE_URL}/media` | sama |
| `PXE_MEDIA_ROOT` | `/srv/pxe/media` | sama |
| `PXE_TFTP_ROOT` | `/srv/pxe/tftp` | sama |
| `PXE_DNSMASQ_LEASES` | kosong (dev) | `/var/lib/misc/dnsmasq.leases` |
| `PXE_DNSMASQ_PIDFILE` | kosong | `/run/dnsmasq/dnsmasq.pid` |
| `PXE_TRUST_PROXY` | `0` | `1` |
| `PXE_TOKEN_TTL_MIN` | `360` | `360` |
| `PXE_UNKNOWN_HOST_ACTION` | `local` | `local` |
| `PXE_KERNEL_EXTRA_ARGS` | kosong | `console=ttyS0,115200n8 console=tty0` |

Validasi silang: gateway, DNS(s), server IP, dan range DHCP di dalam CIDR; range tidak memuat
gateway/server; base URL `http(s)://`. `validateStaticIp` dan aturan DEC-006 membaca nilai ini di
server. Browser memperolehnya dari `GET /api/settings` (non-rahasia); konstanta `MGMT_NETWORK`
hanya tersisa sebagai default di `settings.ts`.

### 2.2 Database
`src/lib/server/db/` — `index.ts` (open, pragma `foreign_keys=ON`, `journal_mode=WAL`,
`busy_timeout`), `migrations/NNN-*.sql`, `repos/{hosts,configs,ssh-keys,os-images,jobs}.ts`,
`seed.ts`, `reset.ts` (`resetDb(seed)` untuk test, tidak diekspos via HTTP). Skema lihat
O1. Semua operasi tulis yang memvalidasi bentrok (apply single/bulk, install) berjalan
**sinkron** di dalam `BEGIN IMMEDIATE … COMMIT` (tanpa `await` di tengah — menutup G3-2),
constraint unik sebagai pertahanan kedua (pelanggaran → 422 yang sama dengan validasi).
`config-service.ts` dipertahankan sebagai lapisan logika; `mockDb()` diganti repo.
`os_images` di-seed: `ubuntu-24.04` (autoinstall, source `ubuntu-24.04/`), `debian-12`
(preseed, netboot `debian-netboot/`, mirror `debian-12/`), `rocky-9` (kickstart, `rocky-9/`),
`windows-2022` (unattend, `bootable=false`), `ubuntu-22.04` (tidak tersedia bila media tidak
ada). `available` = file kernel ada di `PXE_MEDIA_ROOT`. Migrasi memetakan id lama
(`ubuntu-24.04.5`, `rocky-9.4`) bila ada di seed demo.

### 2.3 Endpoint boot (non-`/api`, untuk firmware/installer)
Route Next: `src/app/boot/[name]/route.ts` (`entry.ipxe`, `{mac}.ipxe`),
`src/app/boot/[name]/[token]/[file]/route.ts`, `src/app/boot/[name]/[token]/status/route.ts`.
Semua `Content-Type: text/plain; charset=utf-8` (XML: `application/xml`), `Cache-Control: no-store`.

IP sumber: helper `requestIp(req)` membaca `X-Real-IP` hanya bila `PXE_TRUST_PROXY=1`
(nginx menimpanya dengan `$remote_addr`; Next bind `127.0.0.1`). IP lease: `leases.ts` membaca
file lease dnsmasq (cache berdasarkan mtime) → `Map<mac, Set<ip>>` lease belum kedaluwarsa
(semua IP untuk MAC itu, karena OVMF PXE dan iPXE bisa mendapat lease berbeda).

`GET /boot/entry.ipxe` (diberikan dnsmasq ke client ber-user-class iPXE):
```
#!ipxe
chain --autofree ${base}/boot/${mac}.ipxe?platform=${platform} || goto retry
:retry  sleep 5 ; chain … (maks 3x) ; exit
```
`GET /boot/{mac}.ipxe?platform=efi|pcbios`:
1. Normalisasi MAC (`normalizeMac`); invalid → 400.
2. **Verifikasi IP**: bila lease dikonfigurasi dan IP sumber ∉ IP lease MAC itu → request
   "tidak terverifikasi": tidak membuat/mengubah host, balas script boot lokal (tanpa token).
3. Upsert host: `status=discovered` bila baru, `vendor=lookupVendor` (tabel OUI ditambah
   `52:54:00` QEMU/KVM), `firmware` dari `platform`, `current_ip`, `last_seen=now`.
4. Pilih script:
   - Job aktif dengan status `booting|installing` dan image bootable → script installer
     (lihat bawah), catat `boot_served_at` + stage `booting` di `jobs.stages`.
   - Selain itu (tanpa job, `configuring`, `done`, `failed`, `discovered`, `offline`) → boot lokal:
     ```
     #!ipxe
     iseq ${platform} efi && exit ||
     sanboot --no-describe --drive 0x80 || exit
     ```
     (`PXE_UNKNOWN_HOST_ACTION=wait` + host tanpa OS → loop `sleep 30; chain` maks 20x, lalu exit.)
5. Installer per OS (`${m}`=media URL, `${c}`=`${base}/boot/{mac}/{token}/`, `${x}`=extra args):
   - Ubuntu: `kernel ${m}/ubuntu-24.04/casper/vmlinuz initrd=initrd ip=dhcp netboot=nfs
     nfsroot=${server}:${PXE_MEDIA_ROOT}/ubuntu-24.04 autoinstall ds=nocloud-net;s=${c}
     cloud-config-url=/dev/null ${x} ---` ; `initrd --name initrd ${m}/ubuntu-24.04/casper/initrd`
     ; `boot`. **Tidak pernah `url=`** (README §10, O6).
   - Debian: `kernel ${m}/debian-netboot/linux initrd=initrd auto=true priority=critical
     url=${c}preseed.cfg interface=auto netcfg/dhcp_timeout=60 ${x}` ; `initrd --name initrd
     ${m}/debian-netboot/initrd.gz` ; `boot`.
   - Rocky: `kernel ${m}/rocky-9/images/pxeboot/vmlinuz initrd=initrd ip=dhcp
     inst.repo=${m}/rocky-9 inst.ks=${c}ks.cfg inst.text ${x}` ; `initrd --name initrd
     ${m}/rocky-9/images/pxeboot/initrd.img` ; `boot`.

`GET /boot/{mac}/{token}/{file}` — syarat O2 (token aktif, MAC cocok, status
`booting|installing`, belum expired, IP ∈ lease MAC atau `current_ip`); file per metode:
Ubuntu `user-data|meta-data|vendor-data`; Debian `preseed.cfg`; Rocky `ks.cfg`. Lainnya
(termasuk `network-config`) → 404. Semua penolakan → 404 body `not found` identik. Fetch sukses
pertama atas file utama (`user-data`/`preseed.cfg`/`ks.cfg`) → job & host `installing`.

`POST /boot/{mac}/{token}/status` body `stage=<s>` (form/JSON): token cocok, job belum final,
IP ∈ lease MAC ∪ `current_ip` ∪ IP statis host. Transisi maju saja
(`booting→installing→configuring→done`, apa pun→`failed`); stage sama → 200 no-op; mundur →
409. `done`: host `done`, `os_installed=os_assigned`, `os_assigned=null`, `current_ip=IP
sumber`, job `finished_at`, token dicabut. `failed`: host `failed`, token dicabut. Setiap
transisi ditambahkan ke `jobs.stages` dan `hosts.status_since`.

### 2.4 Install
`installHosts` (single & bulk): validasi lama (OS + credentials, tidak sedang berjalan) +
image `available` dan `bootable` (Windows → "Windows: hanya generator unattend.xml di M4") →
dalam satu transaksi: buat job `install` status `booting`, token baru (hash disimpan),
`os_assigned`, host `booting`. Job aktif lain milik host (seharusnya tidak ada) dicabut. Token
plaintext tidak pernah dikembalikan API.

### 2.5 Generator (`src/lib/server/installers/`)
`context.ts` membangun `InstallContext` dari host + config + job + settings + key library
(validasi ulang: hostname RFC 1123, username, hash `^\$6\$`, IP/prefix/gateway/DNS, key via
`parseSshKey`; komentar key disanitasi). Helper: `shell.ts` (`shQuote`, `b64write(path, mode,
content)` → `printf %s '<b64>' | base64 -d > path && chmod`), `yaml` library, `xml.ts`
(escape `& < > " '`), `preseed.ts`/`kickstart.ts` writer baris yang menolak CR/LF/NUL.
- **Ubuntu** (`ubuntu.ts`): basis `configs/autoinstall/user-data` lab. `identity`
  (hostname/username/hash), `network` v2 `ethernets.mgmt.match.macaddress=<mac>` (statis:
  addresses/routes default/nameservers; DHCP: `dhcp4: true`), `ssh` (install-server,
  `allow-pw = !disableSshPassword`, authorized-keys = key library + extraKeys), `storage`
  (`lvm`/`direct`, `match.path` bila disk diisi; `custom` → 422 di M4), timezone, locale,
  `apt: {geoip: false, fallback: offline-install}`, `refresh-installer: {update: false}`,
  tanpa `packages` tambahan bila image `offline`; `late-commands`: callback `configuring`,
  sudoers `90-<user>` (0440, NOPASSWD bila sudo — paritas lab), sshd drop-in bila disable
  password, unit first-boot `pxe-callback-done.service` (token di file 0600, menghapus diri),
  snippet BootOrder UEFI, guard `pxe-force-reboot` (netboot NFS); `error-commands`: callback
  `failed`; `shutdown: reboot`. `meta-data`: `instance-id: <jobId>`, `local-hostname`.
  `vendor-data`: `#cloud-config\n{}`.
- **Debian** (`debian.ts`): `d-i` locale/keymap/timezone, `netcfg/get_hostname`, mirror
  `http://${server}` dir `/media/debian-12`, `apt-setup` sesuai DVD lokal, `passwd/root-login
  false`, `passwd/user-fullname`, `passwd/username`, `passwd/user-password-crypted`,
  partman auto (lvm/regular), `pkgsel/include openssh-server curl sudo`, grub ke disk,
  `preseed/late_command` (base64): authorized_keys, sudoers, sshd drop-in,
  `/etc/network/interfaces.d/mgmt` untuk iface yang ditemukan dari MAC, unit first-boot, callback
  `configuring`; `finish-install/reboot_in_progress note`.
- **Rocky** (`rocky.ts`): `text`, `url --url=<media>/rocky-9`, `lang`, `keyboard`,
  `timezone`, `network --device=<mac> --bootproto=static|dhcp --ip --netmask --gateway
  --nameserver --hostname --activate --onboot=yes`, `rootpw --lock`, `user --name
  --password=<hash> --iscrypted [--groups=wheel]`, `sshkey --username=<u> "<key>"`,
  `clearpart --all --initlabel [--drives]`, `autopart --type=lvm|plain`, `%packages
  @^minimal-environment curl %end`, `%post` (base64: sudoers, sshd drop-in, unit first-boot,
  callback `configuring`), `%onerror` callback `failed`, `reboot`.
- **Windows** (`windows.ts`): `unattend.xml` passes windowsPE/specialize/oobeSystem:
  `ComputerName` (hostname ≤ 15 char, else error), `Microsoft-Windows-TCPIP` interface
  `Identifier` = MAC `52-54-00-…` uppercase, IP/prefix, route default, DNS client;
  FirstLogonCommands: install OpenSSH Server, tulis `administrators_authorized_keys` (ACL),
  `PasswordAuthentication no` bila diminta; akun lokal dibuat dengan password acak yang dibuang
  (O9). Tidak ada hash/password dari config.

### 2.6 Status server
`GET /api/server-status` → `{dhcp, tftp, http}`: DHCP = pid di `PXE_DNSMASQ_PIDFILE` hidup
(`process.kill(pid, 0)`), TFTP = sama + `snponly.efi` dan `undionly.kpxe` ada di
`PXE_TFTP_ROOT`, HTTP = selalu online bila handler menjawab + `PXE_MEDIA_ROOT` terbaca. Env
kosong → `unknown` (ditampilkan abu-abu).

### 2.7 Infrastruktur KVM (`infra/`)
Semua script `set -euo pipefail`, idempoten, `VIRSH="virsh -c qemu:///system"`, mode
`INFRA_DRY_RUN=1` (cetak perintah, tidak eksekusi), tanpa sudo. `infra/lib.sh`:
`assert_name` (harus `^pxe-test-`, tolak `pxe-test-node01`, `ubuntu24.04`, `default`, `int`),
`assert_path_in .agent/vms`, logging ke `.agent/runs/<m>/kvm/`.

| Script | Isi |
|---|---|
| `infra/net-up.sh` | Define+start bila belum ada: `pxe-test` (bridge `virbr-pxe`, `10.99.0.1/24`, tanpa `<forward>`, tanpa `<dhcp>`, `<dns enable='no'/>`); `pxe-test-nat` (bridge `virbr-pxenat`, `192.168.199.1/24`, `<forward mode='nat'/>`, tanpa `<dhcp>`) [O11]. Tidak autostart. |
| `infra/net-down.sh` | Hanya di akhir semua milestone. |
| `infra/fetch-node.sh` | Unduh `node-v22.22.2-linux-x64.tar.xz` + `SHASUMS256.txt` dari nodejs.org ke `.agent/media/`, verifikasi. |
| `infra/server-up.sh` | (1) Key `.agent/keys/pxe-test-server_ed25519` (ssh-keygen) bila belum ada. (2) Base disk `.agent/vms/pxe-test-server-base.qcow2` (overlay dari cloud image, 40G) di-provision sekali (paket apt via NAT: `dnsmasq nginx nfs-kernel-server nftables`), lalu tiap run memakai overlay `pxe-test-server.qcow2` [risiko R4]. (3) Seed cloud-init (`cloud-localds`) dari `infra/server/cloud-init/{user-data,meta-data,network-config}.tmpl`: user `pxeadmin` key-only, netplan `pxe0` (match MAC `52:54:00:99:01:02`, `10.99.0.2/24`, tanpa gateway) dan `nat0` (match `52:54:00:99:01:03`, `192.168.199.2/24`, gw/dns `.1`). (4) `virt-install` 3 GB RAM, 2 vCPU, NIC di kedua network, 3 CD-ROM read-only (Ubuntu ISO, Debian DVD, Rocky ISO) [O5], serial ke `.agent/runs/<m>/kvm/pxe-test-server-serial.log`. (5) Tunggu SSH. |
| `infra/server-config.sh` | Lewat `ssh 'bash -s' < infra/server/provision.sh`: mount ISO by label ke `/srv/pxe/media/{ubuntu-24.04,debian-12,rocky-9}` (fstab ro), salin `debian-netboot/`, `snponly.efi`, `undionly.kpxe` ke `/srv/pxe/tftp`; pasang `infra/server/dnsmasq.conf` (lihat bawah), `nginx.conf` (listen `10.99.0.2:80`; `/media/` alias statis; lainnya proxy ke `127.0.0.1:3000` dengan `proxy_set_header X-Real-IP $remote_addr`; `log_format` menyamarkan segmen token), `exports` (`/srv/pxe/media/ubuntu-24.04 10.99.0.0/24(ro,no_subtree_check,fsid=1001)`), `nftables.conf` (drop input baru di `nat0` kecuali established), restart layanan; **verifikasi `ss -lunp`** (lihat AC-4.28) — gagal → exit ≠ 0 dan dnsmasq dihentikan. |
| `infra/deploy-dashboard.sh` | Di host: `PXE_STANDALONE=1 npm run build` → tar `.next/standalone`, `.next/static`, `public` → scp; di VM: Node tarball ke `/opt/node`, rilis ke `/opt/pxe-dashboard/releases/<ts>`, `pxe-dashboard.service` (user `pxe`, `EnvironmentFile=/etc/pxe-dashboard.env` dari `infra/server/dashboard.env`, `HOSTNAME=127.0.0.1 PORT=3000`), restart, tunggu `/api/settings` 200 dari host. |
| `infra/node-create.sh <m> <NN> <uefi\|bios>` | `qemu-img create -f qcow2 .agent/vms/pxe-test-<m>-node<NN>.qcow2 20G`; `virt-install --name pxe-test-<m>-node<NN> --memory 2048 --vcpus 2 --network network=pxe-test,mac=52:54:00:99:00:<NN>,model=virtio --pxe --boot network,hd` (+ UEFI: loader `/usr/share/edk2/ovmf/OVMF_CODE.fd`, template vars `OVMF_VARS.fd`, `secure=no`) `--serial file,path=.agent/runs/<m>/kvm/<name>-serial.log --graphics none --noautoconsole`. |
| `infra/cleanup.sh <m> [--server] [--base]` | Destroy + `undefine --nvram` VM `^pxe-test-<m>-node[0-9]{2}$` (dan `pxe-test-server` dengan `--server`), hapus disk yang cocok di `.agent/vms/`; tidak menyentuh network; mencatat `virsh list --all`/`net-list` sebelum/sesudah ke `cleanup.txt`. |
| `infra/kvm-run.sh <m>` | Orkestrasi: preflight ringkas → `net-up` → `server-up` → `server-config` → `deploy-dashboard` → menjalankan suite KVM test-engineer → `cleanup` (via `trap EXIT`, termasuk `--server`). |

`infra/server/dnsmasq.conf`:
```
interface=pxe0
bind-interfaces
except-interface=lo
no-resolv
domain=pxe.test
local=/pxe.test/
dhcp-authoritative
dhcp-range=pxe0,10.99.0.100,10.99.0.200,255.255.255.0,1h
dhcp-option=option:router,10.99.0.1
dhcp-option=option:dns-server,10.99.0.2
dhcp-userclass=set:ipxe,iPXE
dhcp-match=set:efi64,option:client-arch,7
dhcp-match=set:efi64,option:client-arch,9
dhcp-boot=tag:ipxe,http://10.99.0.2/boot/entry.ipxe
dhcp-boot=tag:!ipxe,tag:efi64,snponly.efi,,10.99.0.2
dhcp-boot=tag:!ipxe,tag:!efi64,undionly.kpxe,,10.99.0.2
enable-tftp
tftp-root=/srv/pxe/tftp
log-dhcp
log-facility=/var/log/dnsmasq-pxe.log
```
Rantai boot: BIOS → ROM iPXE QEMU (user-class iPXE) → `entry.ipxe`. UEFI → OVMF PXE → TFTP
`snponly.efi` → iPXE → `entry.ipxe`. Fallback `undionly.kpxe` untuk BIOS non-iPXE.

Alokasi: server `52:54:00:99:01:02/03` + `10.99.0.2`; node `52:54:00:99:00:NN` (NN ≥ 11),
IP statis test `10.99.0.(10+NN)`. Key node sekali pakai `.agent/keys/<m>-node<NN>_ed25519`,
dihapus di cleanup.

## 3. Task

| ID | Owner | Deskripsi | Dependensi | File |
|---|---|---|---|---|
| M4-T1 | backend-dev | Modul settings env + `.env.example` + `GET /api/settings`; `net.ts`/`config-service.ts` memakai settings server (DEC-006). | — | `lib/server/settings.ts`, `lib/net.ts`, `app/api/settings/route.ts`, `.env.example` |
| M4-T2 | backend-dev | DB `node:sqlite`: migrasi, repo, `resetDb`/seed, port `config-service` + semua route M2/M3 ke repo, transaksi sinkron, hapus simulasi mock; API `os-images` & `ssh-keys` (GET/POST/DELETE). | T1 | `lib/server/db/**`, `lib/server/config-service.ts`, `lib/os-images.ts`, `app/api/**`, hapus `mock-hosts.ts` |
| M4-T3 | backend-dev | Discovery: `leases.ts`, `requestIp`, OUI QEMU, `/boot/entry.ipxe`, `/boot/{mac}.ipxe` (boot lokal + installer 3 OS). | T2 | `lib/server/leases.ts`, `lib/server/request-ip.ts`, `lib/oui.ts`, `lib/server/boot-script.ts`, `app/boot/[name]/route.ts` |
| M4-T4 | backend-dev | Generator 4 OS + helper escaping + context. | T2 (paralel T3) | `lib/server/installers/**` |
| M4-T5 | backend-dev | Jobs + token + install service + `/boot/{mac}/{token}/{file}` + `/boot/{mac}/{token}/status`. | T3, T4 | `lib/server/jobs.ts`, `lib/server/tokens.ts`, `app/boot/[name]/[token]/**` |
| M4-T6 | backend-dev | `GET /api/server-status`. | T1 | `lib/server/server-status.ts`, `app/api/server-status/route.ts` |
| M4-T7 | backend-dev | Infra KVM (§2.7) + `next.config.ts` `PXE_STANDALONE`. Bisa mulai paralel sejak awal (server-up/config tidak butuh dashboard). | — (deploy butuh T5) | `infra/**`, `dashboard/next.config.ts` |
| M4-T8 | frontend-dev | `use-settings` hook; Network tab/form-state pakai settings API (bukan konstanta); halaman Settings read-only; top bar `server-status` nyata; OS tab dari `/api/os-images` (tidak tersedia = disabled + alasan; Windows: peringatan password O9); pesan error install per host. | T1, T2, T6 | `hooks/use-settings.ts`, `components/host-config/*`, `app/(dashboard)/settings/page.tsx`, `components/server-status.tsx` |
| M4-T9 | test-engineer | Unit: settings, leases, OUI, boot-script, generator (golden + parse), injeksi, tokens, request-ip. | T3–T5 | `src/**/*.test.ts` |
| M4-T10 | test-engineer | Integration route handler (DB tmp per test, lease fixture, jam injeksi) untuk semua route baru + regresi M2/M3. | T5, T6 | `src/app/**/*.test.ts` |
| M4-T11 | test-engineer | E2E Playwright lokal (`next start`, DB tmp, lease fixture, `PXE_TRUST_PROXY=1` + header): discovery live, status pill bergerak, Settings, regresi M2/M3. | T8 | `dashboard/e2e/m4-*.spec.ts` |
| M4-T12 | test-engineer | Test shell infra dengan `virsh`/`virt-install`/`qemu-img`/`ssh` palsu di `PATH` + `INFRA_DRY_RUN`. | T7 | `infra/test/*.sh` |
| M4-T13 | test-engineer | Suite KVM: Playwright `dashboard/e2e-kvm/m4-*.spec.ts` (base `http://10.99.0.2`), `virsh reset` setelah Install, script verifikasi SSH (`ssh 'bash -s' < verify-node.sh`), `results.json`, scan secret bukti; dijalankan via `infra/kvm-run.sh m4`. | T7, T8, T11 | `dashboard/e2e-kvm/**`, `.agent/runs/m4/kvm/**` |

Urutan: T1 → T2 → (T3 ∥ T4 ∥ T6) → T5 → T8 → T9/T10/T11; T7 paralel sejak awal, T12 setelah T7;
T13 terakhir (butuh semua). Run KVM pertama sebaiknya "smoke" (server + satu node discovery
saja) sebelum install penuh, untuk memvalidasi rantai iPXE lebih awal (R2).

## 4. Acceptance criteria

### Persistence & konfigurasi
- **AC-4.1** (integration) Migrasi pada DB kosong membuat semua tabel; menjalankan migrasi dua
  kali tidak error dan tidak mengubah `schema_migrations`; constraint menolak: MAC duplikat,
  IP statis duplikat, hostname duplikat beda huruf besar, job aktif kedua untuk host yang sama;
  menghapus host meng-cascade config, join key, dan job.
- **AC-4.2** (integration) Data bertahan restart: host/config/key/job yang ditulis via API
  terbaca sama setelah modul DB dibuka ulang dari file yang sama; tidak ada response API
  (`/api/**`) yang memuat `passwordHash`, `password_hash`, `token`, atau `token_hash`.
- **AC-4.3** (integration) Atomik: dua `PATCH` paralel memberi IP statis yang sama ke dua host →
  tepat satu 200, satu 422; bulk dengan satu host invalid → tidak ada perubahan tersimpan untuk
  host mana pun (G3-2 tertutup).
- **AC-4.4** (integration + e2e) Regresi: seluruh test M2/M3 lulus memakai DB (`resetDb('demo'|'empty')`);
  tidak ada impor `mock-hosts` dan tidak ada route `__test__` di `src/` (test statis).
- **AC-4.5** (unit) Env: konfigurasi valid ter-parse; CIDR invalid, gateway/DNS/server di luar
  subnet, range DHCP di luar subnet atau memuat gateway, base URL bukan http(s) → error yang
  menyebut nama variabel. Dengan `PXE_MGMT_CIDR=10.99.0.0/24`: `10.99.0.21` diterima;
  `10.10.10.21`, `10.99.0.150` (range dinamis), `10.99.0.2` (server), prefix ≠ 24 ditolak (DEC-006).
- **AC-4.6** (integration + e2e) `GET /api/settings` mengembalikan cidr, gateway, dns,
  dynamicRange, pxeServer, baseUrl, tftpRoot, interface (tanpa path DB/rahasia). Server E2E
  dengan `10.99.0.0/24`: halaman Settings menampilkan nilai itu read-only; tab Network
  menampilkan subnet `10.99.0.0/24` dan preview menandai `10.10.10.5` sebagai di luar subnet.
- **AC-4.7** (integration + e2e) `GET /api/server-status`: pidfile proses hidup + file TFTP ada →
  `online`; pidfile basi → DHCP/TFTP `offline`; env kosong → `unknown`. Top bar menampilkan
  ketiga status sesuai response (E2E dengan `page.route`).

### Discovery & script boot
- **AC-4.8** (integration) `GET /boot/52-54-00-99-00-11.ipxe?platform=efi` (MAC dash/uppercase)
  untuk MAC baru → host `discovered`, MAC normal `52:54:00:99:00:11`, vendor QEMU, firmware
  `uefi`, `current_ip` = `X-Real-IP`, `last_seen` = jam injeksi; panggilan kedua tidak
  menduplikasi dan memperbarui `last_seen`; MAC invalid → 400 tanpa host baru; body diawali
  `#!ipxe`, `Content-Type` text/plain.
- **AC-4.9** (integration) Verifikasi IP: dengan lease fixture (MAC → 10.99.0.150), request dari
  IP lain → script boot lokal, host tidak dibuat/diubah, tidak ada `kernel` maupun token di body;
  `PXE_TRUST_PROXY=0` → `X-Real-IP` diabaikan.
- **AC-4.10** (unit) Parser lease: baris valid (expiry, MAC, IP, hostname `*`, client-id)
  ter-parse; baris rusak, MAC non-ethernet, lease kedaluwarsa diabaikan; satu MAC banyak IP →
  semua IP; file tidak ada → map kosong tanpa error; cache dibaca ulang hanya saat mtime berubah.
- **AC-4.11** (integration) Sinkron lease: MAC baru di file lease muncul sebagai host
  `discovered` dengan `current_ip` saat `GET /api/hosts`; status host yang sudah ada tidak berubah.
- **AC-4.12** (e2e) Host baru muncul di tabel tanpa refresh ≤ 10 dtk setelah request
  `/boot/{mac}.ipxe` dari test (SPEC §7).
- **AC-4.13** (integration) `GET /boot/entry.ipxe` → `#!ipxe` yang `chain` ke
  `${PXE_BASE_URL}/boot/${mac}.ipxe?platform=${platform}` dengan retry terbatas.
- **AC-4.14** (integration) Boot lokal: host tanpa job dan host berstatus `discovered`, `done`,
  `failed`, `offline` → script berisi `iseq ${platform} efi && exit` dan `sanboot --no-describe
  --drive 0x80`; tidak berisi `kernel`. `PXE_UNKNOWN_HOST_ACTION=wait` + host tanpa OS → loop
  `sleep` dengan batas iterasi; host dengan `os_installed` tetap lokal.
- **AC-4.15** (integration) Installer Ubuntu: host dengan job aktif `booting` → script memuat
  `kernel <media>/ubuntu-24.04/casper/vmlinuz`, `initrd=initrd`, `ip=dhcp`, `netboot=nfs`,
  `nfsroot=10.99.0.2:/srv/pxe/media/ubuntu-24.04`, `autoinstall`,
  `ds=nocloud-net;s=<base>/boot/<mac>/<token>/`, `cloud-config-url=/dev/null`, extra args env,
  `initrd --name initrd …/casper/initrd`, `boot`; **tidak** memuat `url=`; `sha256(token)` =
  `jobs.token_hash`; `boot_served_at` dan stage `booting` tercatat.
- **AC-4.16** (integration) Installer Debian dan Rocky sesuai §2.3 (snapshot); image tidak
  tersedia atau Windows tidak pernah menghasilkan script installer.
- **AC-4.17** (integration) Setelah callback `configuring`, `/boot/{mac}.ipxe` mengembalikan boot
  lokal walau job belum `done` (tidak reinstall berulang).

### Generator (unit)
- **AC-4.18** Ubuntu: output di-parse YAML → `autoinstall.version=1`; `identity` hostname,
  username, password = hash tersimpan apa adanya; network statis `match.macaddress`=MAC,
  `addresses=[ip/prefix]`, route default via gateway, nameservers; mode DHCP → `dhcp4: true`
  match MAC; `ssh.authorized-keys` = key library + extraKeys persis; `allow-pw` = kebalikan
  disableSshPassword; sudo=true → late-command menulis sudoers 0440, sudo=false → tidak ada;
  storage `lvm`/`direct` + `match.path` bila disk diisi; timezone/locale; `apt.fallback:
  offline-install`; late-commands memuat callback `configuring`, unit first-boot `done`,
  BootOrder UEFI, guard `pxe-force-reboot`; `error-commands` memuat callback `failed`;
  `meta-data` berisi `instance-id: <jobId>` + `local-hostname`. Golden file.
- **AC-4.19** Debian preseed: setiap baris cocok `^(#.*|d-i \S+ \S+( .*)?|)$`; memuat
  `passwd/user-password-crypted` hash, `passwd/root-login false`, hostname, mirror lokal,
  `pkgsel/include` openssh-server+curl+sudo; `preseed/late_command` mendekode payload base64
  yang (didekode di test) berisi authorized_keys 0600 milik user, sudoers, drop-in sshd
  `PasswordAuthentication no` bila diminta, konfigurasi interface yang dipilih via MAC, unit
  first-boot, callback `configuring`.
- **AC-4.20** Rocky kickstart: memuat `text`, `url --url=<media>/rocky-9`, `rootpw --lock`,
  `user --name=<u> --password=<hash> --iscrypted` (+ `--groups=wheel` bila sudo), `sshkey
  --username=<u>` per key, `network --device=<mac>` statis lengkap (atau dhcp), `%post`
  (payload base64 didekode di test), `%onerror` callback `failed`, `reboot`; jumlah section
  `%…`/`%end` seimbang.
- **AC-4.21** Windows unattend.xml: well-formed (di-parse), `ComputerName`=hostname, hostname > 15
  karakter → error; `Identifier`=MAC format `52-54-00-…` uppercase, IP/prefix, gateway, DNS;
  FirstLogonCommands memasang OpenSSH + `administrators_authorized_keys` berisi key; tidak ada
  hash `$6$` maupun password dari config di output.
- **AC-4.22** Injeksi: tabel input berbahaya (hostname/username/comment key/disk berisi `\n`,
  `\r`, `'`, `"`, `$(…)`, `` ` ``, `; reboot`, `: #`, `%post`, `]]>`, `<!--`, `&`) untuk ke-4
  generator → generator melempar error validasi, **atau** output ter-parse ke nilai persis
  dengan struktur tak berubah (kunci top-level YAML sama, jumlah baris `d-i` sama, jumlah section
  kickstart sama, jumlah elemen XML sama, tidak ada baris shell tambahan). Generator menolak hash
  bukan `$6$`; tidak ada output yang memuat password plaintext test.

### Token, akses konfigurasi, install, callback
- **AC-4.23** (integration) `GET /boot/{mac}/{token}/user-data` 200 hanya bila semua syarat O2
  terpenuhi; masing-masing kasus berikut → 404 dengan body identik: token salah, token milik
  host lain (MAC path beda), IP sumber bukan IP lease MAC/`current_ip`, header IP hilang, token
  expired (jam injeksi), job `configuring`/`done`/`failed`, file tak dikenal/`network-config`,
  file milik OS lain. Response sukses `Cache-Control: no-store`. Fetch `user-data` pertama →
  host & job `installing`; `meta-data`/`vendor-data` tidak mengubah status.
- **AC-4.24** (integration) Siklus token: install membuat job dengan token 43 karakter base64url,
  DB hanya menyimpan hash (kolom diperiksa: plaintext tidak ada di file DB); install ulang
  setelah `failed` mencabut token lama (URL lama 404); `done`/`failed`/hapus host mencabut
  token; log server yang ditangkap selama test tidak memuat token.
- **AC-4.25** (integration) Install: `POST /api/hosts/:id/install` dan bulk membuat job `install`
  `booting` + host `booting` + `osAssigned` dalam satu transaksi; host sedang berjalan → gagal
  per host; image tidak tersedia → gagal "media … tidak tersedia"; Windows → gagal
  "hanya generator"; tanpa credentials/OS → gagal seperti M3.
- **AC-4.26** (integration) Callback `POST /boot/{mac}/{token}/status`: transisi maju diterima
  dan tercatat di `jobs.stages` + `status_since`; stage sama → 200 tanpa perubahan; mundur → 409;
  stage tak dikenal → 400; IP statis host diterima untuk `done`, IP asing → 404; `done` →
  host `done`, `osInstalled`=image, `osAssigned`=null, `current_ip`=IP sumber, job selesai,
  token dicabut; `failed` → host `failed`, boot lokal.
- **AC-4.27** (e2e) Setelah Install dari Sheet dan callback disimulasikan via `request`, pill
  tabel bergerak Booting → Installing → Configuring → Done tanpa refresh; OS tab menonaktifkan
  image tidak tersedia dan menampilkan peringatan Windows.

### Infra & KVM
- **AC-4.28** (unit-shell) Dengan `virsh` palsu + `INFRA_DRY_RUN=1`: `net-up.sh` dua kali →
  idempoten; XML `pxe-test` tanpa `<forward>`, tanpa `<dhcp>`, `<dns enable='no'/>`; XML
  `pxe-test-nat` NAT tanpa `<dhcp>`; semua nama yang dibuat cocok `^pxe-test-`; `cleanup.sh` dan
  `node-create.sh` menolak (exit ≠ 0, tanpa perintah virsh) nama `pxe-test-node01`,
  `ubuntu24.04`, `default`, `int` dan path disk di luar `.agent/vms/`; `bash -n` semua script.
- **AC-4.29** (kvm) Server VM: `server-check.txt` membuktikan `ss -lunp` hanya menampilkan
  socket dnsmasq di `0.0.0.0%pxe0:67`, `10.99.0.2:69`, `10.99.0.2:53` (tidak ada di
  `192.168.199.*`, wildcard tanpa `%pxe0`, atau `nat0`); `dnsmasq nginx nfs-server
  pxe-dashboard` aktif; Next hanya listen `127.0.0.1:3000`; dari host `GET
  http://10.99.0.2/api/settings` → cidr `10.99.0.0/24`; `/media/ubuntu-24.04/casper/vmlinuz`
  200; sha256 `snponly.efi`/`undionly.kpxe` di TFTP root = `media.log`.
- **AC-4.30** (kvm, wajib gate) **UEFI Ubuntu 24.04 via dashboard**: node
  `pxe-test-m4-node11` (UEFI, 2 GB) PXE boot → host muncul di dashboard (vendor QEMU, firmware
  uefi) → Playwright mengatur hostname `m4-node11`, IP statis `10.99.0.21/24` gw `10.99.0.1`
  DNS `10.99.0.2`, user + password acak per run (tidak dicatat), key ed25519 sekali pakai,
  sudo, disable password SSH → Simpan & Install → harness `virsh reset` → status teramati
  Booting → Installing → Configuring → Done ≤ 30 menit; log dnsmasq memuat TFTP `snponly.efi`
  dan nginx (tersamarkan) memuat fetch `user-data`.
- **AC-4.31** (kvm) Verifikasi SSH setelah AC-4.30 dengan key yang di-inject: `hostname` =
  `m4-node11`; `ip -4 addr` = `10.99.0.21/24` di NIC ber-MAC `52:54:00:99:00:11`; default via
  `10.99.0.1`; DNS `10.99.0.2`; `sudo -n true` sukses; `authorized_keys` berisi persis key itu;
  login password ditolak (`PreferredAuthentications=password` → Permission denied, `sshd -T` →
  `passwordauthentication no`); `reboot` → node kembali dari disk (serial log tanpa kernel
  installer kedua, `/boot/{mac}.ipxe` melayani script lokal), status tetap Done, tidak ada job baru.
- **AC-4.32** (kvm) Negatif selama job aktif AC-4.30: dari host (10.99.0.1) `GET
  /boot/52:54:00:99:00:11.ipxe` → script lokal tanpa token, `current_ip` host tidak berubah;
  `GET /boot/52:54:00:99:00:11/<token-acak>/user-data` → 404.
- **AC-4.33** (kvm) **BIOS Ubuntu 24.04**: node `pxe-test-m4-node12` (BIOS, 2 GB), alur sama
  (IP `10.99.0.22`) → Done ≤ 30 menit; SSH key login + hostname benar; reboot → boot dari disk
  lewat `sanboot`/exit, status tetap Done.
- **AC-4.34** (kvm) Cleanup & bukti: setelah run, tidak ada VM `pxe-test-m4-*` atau
  `pxe-test-server` dan disknya di `.agent/vms/`; key node dihapus; network `pxe-test` tetap;
  `virsh list --all`/`net-list` untuk `pxe-test-node01`, `ubuntu24.04`, `default`, `int`
  identik sebelum/sesudah; `results.json` memuat status + durasi per AC kvm; scan bukti
  `.agent/runs/m4/**` tidak menemukan password test, token (`[A-Za-z0-9_-]{43}` pada path
  `/boot/`), atau private key.

Total: **34 AC** (unit 6 · integration 17 · e2e 4 [beberapa gabungan integration+e2e] ·
unit-shell 1 · kvm 6).

## 5. Risiko

| ID | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | **RAM**: server 3 GB + node 2 GB (±5 GB dari 9,6 GB). Subiquity di 2 GB belum pernah dicoba (lab 4 GB); root NFS mencegah ISO ke RAM, tetapi overlay casper + curtin bisa OOM. | AC-4.30 gagal | Tanpa `updates`/paket ekstra/snap; console serial untuk bukti OOM; kandidat decision node Ubuntu 3 GB (3+3 = 6 GB masih muat, tetap 1 node sekaligus). Node dijalankan berurutan, bukan paralel. |
| R2 | **iPXE `snponly.efi` di OVMF** (build 2022) + ROM virtio QEMU; `initrd=initrd` wajib karena belum ada LoadFile2; OVMF `bootorder` fw_cfg menimpa `efibootmgr`. | Rantai UEFI macet | Run smoke dini (discovery saja) sebelum T5 selesai; boot lokal pakai `exit` (lanjut ke opsi disk) bukan BootOrder; cadangan (decision): GRUB `grubnetx64.efi` lab dengan config per-MAC via HTTP. |
| R3 | **BIOS**: ROM iPXE QEMU harus mendukung HTTP; `sanboot --drive 0x80` di SeaBIOS. | AC-4.33 | Fallback `exit` (SeaBIOS lanjut ke hd); `undionly.kpxe` tersedia untuk ROM non-iPXE. |
| R4 | **Waktu**: provisioning server (apt via NAT) + 2 instalasi ±10–15 menit masing-masing; timeout 30 menit/VM; iterasi gate hingga 3×. | Siklus lambat | Base disk server di-provision sekali, overlay per run; `apt.fallback offline-install`, `geoip:false`, `refresh-installer:false`; UEFI dan BIOS berurutan dalam satu run server. |
| R5 | **Ubuntu offline** di `pxe-test` tanpa internet: subiquity bisa menunggu cek mirror/geoip. | Install macet/lama | Opsi apt di atas; tanpa `packages`; verifikasi di run pertama dan catat. |
| R6 | **Debian/Rocky offline repo**: ABI kernel netboot vs DVD 12.15, `Release` DVD tidak bertanda tangan; repo Rocky minimal, `install.img` anaconda di RAM 2 GB. | Matriks M6 | Dipindah ke M6 (O12); M4 cukup generator + script boot (unit/integration). |
| R7 | **`node:sqlite`**: `ExperimentalWarning`, resolusi `node:sqlite` di Vitest/Turbopack. | Build/test gagal | `server.deps.external`/`serverExternalPackages`; fallback `better-sqlite3` via decision (O1). |
| R8 | **IP lease**: OVMF PXE dan iPXE bisa memakai client-id berbeda → dua lease untuk satu MAC; penulisan lease file vs request HTTP. | Config ditolak (404) | Semua IP lease MAC diterima; baca ulang file bila IP tidak cocok sebelum menolak. |
| R9 | Akses libvirt ke `.agent/vms` & ISO (ACL `qemu:--x` sudah ada, SELinux nonaktif); `dynamic_ownership` chown ISO sementara. | VM gagal start | Preflight ulang di `kvm-run.sh`; ISO di-attach `readonly`. |
| R10 | Token di log (nginx, journal, serial console bila kernel cmdline dicetak). | Gate secret gagal | `log_format` tersamar; tidak log URL di Next; serial log discan dan token disamarkan sebelum disimpan ke bukti (token sudah dicabut saat itu); cmdline kernel memuat token → disamarkan oleh harness. |
| R11 | Perubahan port dashboard `:3000` → `:80` (nginx) dan NAT tanpa DHCP menyimpang dari teks DEC-003. | Temuan gatekeeper | Ditetapkan lewat decision baru (O3, O11) sebelum Build. |
| R12 | `output: standalone` mengubah perilaku `next start` E2E M1–M3. | Regresi E2E | Hanya aktif dengan `PXE_STANDALONE=1`. |

## 6. Kandidat decision (untuk Orchestrator)
O1 persistence `node:sqlite`; O2 token per job + binding IP lease; O3 nginx + port 80
(penyempurnaan DEC-003); O4 deploy standalone; O5 ISO sebagai CD-ROM; O6 Ubuntu root NFS (bukan
`url=`) + cadangan RAM 3 GB; O7 pembagian callback M4/M5; O8 boot lokal default + `virsh
reset`; O9 Windows tanpa password dari config; O10 serializer + base64; O11 NAT tanpa DHCP;
O12 matriks KVM M4 (UEFI+BIOS Ubuntu) vs M5/M6.
