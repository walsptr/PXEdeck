# infra/ — lab KVM uji PXE (`pxe-test-*`)

Script bash idempoten (`set -euo pipefail`) untuk lab uji M4 (DEC-003, DEC-009). Semua resource
libvirt berprefix `pxe-test-`; `pxe-test-node01`, `ubuntu24.04`, `default`, `int` milik user dan
ditolak oleh `lib.sh` (`assert_name`). Tanpa sudo di host. DHCP/TFTP hanya dnsmasq **di dalam**
VM `pxe-test-server`, terikat ke NIC `pxe0` (network `pxe-test`).

| Script | Fungsi |
|---|---|
| `net-up.sh` / `net-down.sh` | Network `pxe-test` (`virbr-pxe`, 10.99.0.1/24, isolated, tanpa dhcp, DNS libvirt mati) dan `pxe-test-nat` (`virbr-pxenat`, 192.168.199.1/24, NAT, tanpa dhcp/DNS). XML di `net/`. `net-down.sh` hanya di akhir semua milestone. |
| `fetch-node.sh` | Node 22 LTS resmi (nodejs.org) → `.agent/media/`, verifikasi SHA256. |
| `server-base.sh` | Sekali: `.agent/vms/pxe-test-server-base.qcow2` dari cloud image Ubuntu 24.04 + cloud-init (`cloud-localds`): dnsmasq/nginx/nfs-kernel-server/nftables/tcpdump (M7: capture DHCP relay), Node, user `pxe`, root key-only (key `.agent/keys/infra_ed25519`, dibuat bila belum ada). Marker `.ready`. ±1 menit. |
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

## Topologi VLAN (M7)

M7 (DEC-023, DEC-024, `docs/design/M7-plan.md` §2) menguji PXE boot lewat VLAN dengan topologi
production "trunk, PXE native": port node adalah trunk dengan **VLAN 10 (PXE) native/untagged** dan
**VLAN 20 (management) ber-tag**; server PXE berada di port trunk dengan sub-interface ber-tag. Switch
disimulasikan VM `pxe-test-switch` (Linux bridge `vlan_filtering=1`, root hanya di dalam VM). Default
semua script tetap `--topology flat` (perilaku M4–M6 utuh).

```
 host 10.99.0.1 (Playwright, ssh 10.99.0.2/.3 saja)
   │ virbr-pxe ── pxe-test (admin, untagged, 10.99.0.0/24, tanpa dhcp/forward) ──┬───────────────┐
   │                                     pxe-test-server                         │ sw-mgmt       │ (uji N1:
   │                           pxe0 10.99.0.2 ───────────────────────────────────┘ 10.99.0.3     │  node di admin)
   │                           nat0 192.168.199.2 ── pxe-test-nat (apt server saja, DEC-009)
   │                           trunk0 (tanpa IP) ── pxe-test-trunk ── sw-up [10T,20T]
   │                             ├ pxe10  VLAN 10  10.99.10.2/24 (dnsmasq, nginx, nfsd)
   │                             └ mgmt20 VLAN 20  10.99.20.1/24 (gateway node; ip_forward=0)
   │                                               pxe-test-switch: br0 vlan_filtering=1
   │                                                 sw-p1 [10U PVID, 20T] ── pxe-test-port1 ── node 31..34, 41..43
   │                                                 sw-p2 [access20 = 20U PVID | tagged10 = 10T] ── pxe-test-port2 ── node 37/38
```

| Network | Bridge host | IP host | Peran |
|---|---|---|---|
| `pxe-test` | `virbr-pxe` | `10.99.0.1/24` | Admin untagged: UI, ssh ke server `10.99.0.2` dan switch `10.99.0.3`, bukti |
| `pxe-test-nat` | `virbr-pxenat` | `192.168.199.1` | NAT apt server saja (DEC-009); switch & node tanpa NAT |
| `pxe-test-trunk` | `virbr-pxetrk` | **tanpa IP** | Trunk server `trunk0` ↔ switch `sw-up` (VLAN 10 + 20 ber-tag) |
| `pxe-test-port1` | `virbr-pxep1` | **tanpa IP** | Port node: VLAN 10 native, VLAN 20 ber-tag |
| `pxe-test-port2` | `virbr-pxep2` | **tanpa IP** | Port uji negatif (profil `access20` / `tagged10`) |

Tiga network baru (`net/pxe-test-{trunk,port1,port2}.xml`) tanpa `<ip>`, `<forward>`, `<dhcp>`
(host tidak punya kehadiran L3, libvirt tidak menjalankan dnsmasq); `net-up.sh --topology vlan`
menolak XML yang melanggar sebelum virsh apa pun.

| VLAN | Subnet | Alamat | Catatan |
|---|---|---|---|
| (untagged admin) | `10.99.0.0/24` | host `.1`, server `.2`, switch `.3` | Tidak ada DHCP di segmen ini |
| 10 PXE | `10.99.10.0/24` | server `pxe10` `.2` (`.1` cadangan Settings) | DHCP `.100–.200`, **tanpa opsi router**, DNS `.2` |
| 20 management | `10.99.20.0/24` | server `mgmt20` `.1` = gateway node | IP node `10.99.20.(10+NN)` |

Alur paket (§2.4): DHCP/TFTP/iPXE, kernel/initrd, `/media`, NFS root Ubuntu, stage2 Rocky dan file
konfigurasi lewat VLAN 10 (IP lease `10.99.10.x`); setelah subiquity menerapkan network target, Ubuntu
melanjutkan NFS root, late-commands, dan status `configuring` dari IP statis VLAN 20 ke `10.99.10.2`
lewat gateway `10.99.20.1` (= server, penerimaan lokal, tanpa forwarding); callback `done` semua distro
dari OS terpasang lewat VLAN 20; reboot → PXE di native → iPXE boot lokal → disk.

**Syarat jaringan production (O5, R13).** `PXE_SERVER_IP` wajib **terjangkau dari VLAN management**
lewat HTTP (callback `done` dari OS terpasang, semua distro) dan, untuk **Ubuntu**, juga lewat **NFS**
(root live tetap NFS setelah subiquity pindah ke IP statis VLAN management). Tanpa route itu job berhenti
di Configuring sampai timeout. Di lab, server sendiri adalah gateway VLAN 20 (`ip_forward=0`), nginx
listen `10.99.10.2:80` dan ekspor NFS read-only mencakup `10.99.20.0/24`.

**Perimeter layanan server di VLAN (SR-7-2, kondisi lab apa adanya).** Yang benar-benar terikat ke satu
alamat hanya dnsmasq (`pxe10`), nginx (`10.99.0.2:80`, `10.99.10.2:80`), dan nfsd (`10.99.10.2:2049`).
Yang listen **wildcard**: rpcbind tcp+udp `0.0.0.0:111` (socket activation systemd, sehingga
`OPTIONS="-w -h 10.99.10.2"` tidak berpengaruh; bukti `kvm/vlandistro/server-listen-vlan.txt`),
`rpc.mountd` dan `rpc.statd` (port dinamis), serta `sshd` `0.0.0.0:22` (root key-only). Linux memakai model weak host, jadi node di VLAN 10 dan VLAN 20
bisa menjangkau layanan wildcard itu lewat `10.99.10.2`, `10.99.20.1`, maupun `10.99.0.2`. Data NFS
tetap dibatasi ekspor **read-only** dengan ACL subnet (`10.99.10.0/24`, `10.99.20.0/24`). nftables di
server lab hanya men-drop koneksi baru dari `nat0`; tidak ada filter untuk `pxe10`/`mgmt20`.
`verify-listen-vlan.sh` hanya gagal bila ada socket yang terikat **eksplisit** ke `10.99.20.1`/`%mgmt20`,
sehingga socket wildcard tidak terdeteksi olehnya.

Untuk production disarankan filter input nftables (default drop) untuk `iifname { "pxe10", "mgmt20" }`.
Filter ini belum diterapkan di lab karena profil server termasuk jalur KVM:
- selalu: `ct state established,related accept`; tolak paket VLAN yang menuju alamat admin
  (`ip daddr 10.99.0.2 drop`);
- `pxe10` (VLAN 10): udp 67 (DHCP), udp 69 (TFTP; data TFTP lewat helper conntrack `tftp` atau
  related), udp/tcp 53 (DNS), tcp 80 (iPXE, kernel/initrd, `/media`, konfigurasi, callback), tcp 2049
  (NFS), tcp/udp 111 (rpcbind), dan port `rpc.mountd` yang dipatok tetap (mis. `[mountd] port=20048` di
  `nfs.conf`);
- `mgmt20` (VLAN 20): tcp 80 ke `10.99.10.2` (callback status), tcp 2049 + tcp/udp 111 + port mountd
  tetap (root NFS Ubuntu setelah pindah ke IP statis), udp/tcp 53 bila node memakai DNS server ini;
- drop sisanya, termasuk tcp 22 (sshd) dan `rpc.statd` (locking NLM; ekspornya ro, tetapi pastikan dulu
  klien casper/anaconda tidak membutuhkannya sebelum diblok; bila butuh, patok port statd dan izinkan).

| Script | Fungsi (M7) |
|---|---|
| `net-up.sh --topology vlan` / `net-down.sh --topology vlan` | Lima network (`pxe-test`, `pxe-test-nat`, `pxe-test-trunk`, `pxe-test-port1`, `pxe-test-port2`); down hanya saat teardown M7-T12. |
| `server-up.sh --topology vlan` | NIC ketiga `trunk0` (MAC `52:54:00:99:01:04`, `pxe-test-trunk`); dnsmasq dihentikan segera setelah SSH siap; `server/vlan/apply-profile.sh` (root VM): netplan `pxe10`/`mgmt20`, `ip_forward=0`, `dnsmasq-vlan.conf` (`interface=pxe10`, `bind-interfaces`, `except-interface=lo,nat0,pxe0,mgmt20`, `no-dhcp-interface=pxe0,mgmt20`, `dhcp-option=3`), nginx `10.99.0.2:80` + `10.99.10.2:80`, nfsd `10.99.10.2:2049` (rpcbind/mountd/statd/sshd tetap wildcard, lihat Perimeter di atas), ekspor ro `10.99.10.0/24` + `10.99.20.0/24`; lalu `server/vlan/verify-listen-vlan.sh` → `server-listen-vlan.txt` (gagal ⇒ dnsmasq dihentikan, exit 1). |
| `deploy-dashboard.sh --topology vlan` | `server/dashboard-vlan.env` (`PXE_MGMT_CIDR=10.99.10.0/24`, `PXE_SERVER_IP`/`PXE_BASE_URL`/`PXE_MEDIA_URL` = `10.99.10.2`, `PXE_DHCP_INTERFACE=pxe10`, `PXE_ALLOWED_HOSTS=10.99.0.2,10.99.10.2`, `PXE_VLAN_NETWORKS=20:10.99.20.0/24:10.99.20.1`) + `server/vlan/nginx-pxe-vlan.conf`; verifikasi dari host lewat `10.99.0.2`: `cidr 10.99.10.0/24` dan `vlanNetworks` memuat VLAN 20. |
| `switch-base.sh` | Sekali: `qemu-img convert` cloud image Ubuntu 24.04 (`.agent/media`) → `.agent/vms/pxe-test-switch-base.qcow2` + `.ready` (tanpa boot/paket). |
| `switch-up.sh` / `switch-down.sh [--purge]` | VM `pxe-test-switch` (overlay + seed cloud-init, 768 MB, 1 vCPU, root key-only, tanpa NAT): `sw-mgmt` `10.99.0.3` (pxe-test), `sw-up` (trunk), `sw-p1` (port1), `sw-p2` (port2), MAC `52:54:00:99:02:01..04`. `switch/pxe-switch.sh` (unit oneshot `pxe-switch.service`): `br0 vlan_filtering 1 vlan_default_pvid 0 stp_state 0`, tanpa IP; `sw-up` 10T+20T, `sw-p1` 10 PVID untagged + 20T, `sw-p2` profil `access20` (default) / `tagged10` (`pxe-switch.sh apply-port sw-p2 <profil>`). `switch-up.sh` menjalankan `pxe-switch.sh verify` → `switch-check.txt`. Dibuat **setelah** `verify-listen-vlan.sh` PASS. |
| `node.sh create … --net pxe-test\|pxe-test-port1\|pxe-test-port2` | Network NIC node dari allowlist (default `pxe-test`). |
| `vlan/relay.sh` | Relay SSH terbatas **di dalam VM server** (DEC-023 §4): host menjalankan `ssh -i .agent/keys/infra_ed25519 root@10.99.0.2 'MODE=… NODE_IP=… bash -s' < infra/vlan/relay.sh`. Mode `setup`/`status`/`teardown`, `verify` (verify-node.sh mode `EXPECT_VLAN`), `pwcheck`, `wait-ssh`, `reboot`, `probe` (dari node: `ping 10.99.0.1`, `GET http://10.99.10.2/api/hosts`, `GET http://10.99.0.2/api/hosts`), `capture-start`/`capture-stop` (tcpdump DHCP saja di `pxe0`/`trunk0`; hanya ringkasan teks yang dibawa ke host). `NODE_IP` wajib `10.99.20.x`; mode lain → exit 2. Key node sekali pakai dikirim lewat stdin ssh (0600 root) dan dihapus `MODE=teardown` di `finish` kvm-run (juga run gagal). Tanpa ProxyJump. |
| `cleanup.sh [run] --switch [--base]` | Matikan + undefine `pxe-test-switch`, hapus overlay + seed (`--base`: juga base switch). Run id `switch*`/`trunk*`/`port*` ditolak. |

`kvm-run.sh` skenario VLAN (menyiratkan `--topology vlan`; bukti `.agent/runs/<m>/kvm/<dir>/`, ringkasan
`.agent/runs/<m>/kvm/results.json`):

| Skenario | Run id | Dir bukti | Node default | AC |
|---|---|---|---|---|
| `vlansmoke` | `<m>vlansmoke` | `smoke/` | `41:uefi 42:uefi:os=rocky 43:uefi:os=debian` | smoke T10 |
| `vlanneg` | `<m>vlanneg` | `vlanneg/` | `36:uefi:neg=admin 37:bios:neg=access20 38:uefi:neg=tagged10` | 7.26–7.28 |
| `vlancore` | `<m>vlancore` | `vlancore/` | `31:uefi 32:bios` | 7.20–7.23, 7.29 |
| `vlandistro` | `<m>vlandistro` | `vlandistro/` | `33:uefi:os=debian 34:uefi:os=rocky` | 7.24, 7.25 |

Urutan: libvirt-before → preflight (+ `ip route get 10.99.10.2`, `/proc/sys/net/bridge/*`, baca saja) →
`net-up --topology vlan` → `server-up --topology vlan` → deploy `--topology vlan` → `switch-up` →
server-check (`verify-listen-vlan.sh`) → key sekali pakai → relay setup → capture DHCP `trunk0` + node
(`--net pxe-test-port1`) → Playwright (`PXE_KVM_TOPOLOGY=vlan`, `PXE_KVM_VLAN=20`, `PXE_KVM_GATEWAY=10.99.20.1`,
`PXE_KVM_DNS=10.99.10.2`, `PXE_KVM_INFRA_KEY`, `PXE_KVM_RELAY_CMD`, `PXE_KVM_SWITCH_IP`; UI tetap
`http://10.99.0.2`) → `capture-trunk0.txt` → verifikasi lewat relay (`<node>-verify.txt`, vlancore juga
`<node>-probe.txt` = AC-7.29) → bukti → **relay teardown** (`relay-clean: absent`, sebelum server dimatikan)
→ cleanup (node, `--switch`, `--server`) → libvirt-after/diff → redaksi + scan. Entri `cleanup` di
`results.json` memuat `switchStopped` dan `relayClean`.
`vlanneg` (§2.7) per node berurutan: profil `sw-p2` → `capture-start` (`pxe0` untuk N1, `trunk0` untuk
N2/N3) → node → tunggu `PXE_KVM_NEG_WAIT_SEC` (240) → `capture-stop` → log dnsmasq/nginx (grep MAC),
`/api/hosts`, `ip -s link show sw-p2` sebelum/sesudah, `virsh domifstat` → destroy → (N3) `sw-p2` kembali
`access20` + `switch-check-after-n3.txt`; entri `AC-7.26/27/28` di `results.json`.
`max_nodes = clamp((MemAvailable − 3072 server bila belum jalan − 768 switch bila belum jalan − 4096) / 2048, 1, 3)`.

```
infra/net-up.sh --topology vlan && infra/server-up.sh --topology vlan && infra/switch-up.sh
INFRA_DRY_RUN=1 infra/kvm-run.sh m7 --scenario vlancore     # rencana tanpa mutasi
infra/kvm-run.sh m7 --scenario vlansmoke                     # smoke dini (T10)
infra/kvm-run.sh m7 --scenario vlanneg                       # N1–N3 isolasi
infra/kvm-run.sh m7 --scenario vlancore                      # UEFI + BIOS Ubuntu (wajib gate)
infra/kvm-run.sh m7 --scenario vlandistro                    # Debian 12 + Rocky 9
infra/cleanup.sh m7 --server --switch                        # matikan server + switch
# Teardown M7-T12 (setelah APR M7): network + base + key
infra/net-down.sh --topology vlan && infra/cleanup.sh m7 --server --switch --base
```

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
