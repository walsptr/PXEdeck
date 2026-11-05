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
| `assert-server-logs.sh <runs-dir> <name=mac=fw[=min]>…` | M5 (CR-4-12): asersi log dnsmasq (TFTP `snponly.efi` ke IP lease node UEFI) dan nginx (`GET /boot/<mac>/***/user-data` 200 ≥ min) → entri `results.json` + `server-log-asserts.txt`; FAIL = exit 1. Dipanggil `kvm-run.sh` setelah bukti terkumpul. |
| `smoke.sh <name> <mac> <uefi\|bios>` | Smoke rantai boot dengan script iPXE statis (`smoke/boot-smoke.ipxe`); bukti → `.agent/runs/m4/kvm/smoke/`. |
| `cleanup.sh [run] [--server] [--base]` | Hapus VM `pxe-test-<run>-*` + disknya; `--server` undefine server + overlay; `--base` hapus base. Snapshot `virsh list`/`net-list` sebelum/sesudah → `cleanup.txt`. |
| `deploy-dashboard.sh` | Build `PXE_STANDALONE=1 npm run build` di host (`SKIP_BUILD=1` = pakai build ada) → rilis (standalone + static + public, tanpa `.env*`/DB) di-scp ke VM → `server/install-dashboard.sh`: `/opt/pxe-dashboard/releases/<ts>` + `current`, `/etc/pxe-dashboard.env` (`server/dashboard.env`: subnet 10.99.0.0/24, DB `/var/lib/pxe-dashboard`, lease dnsmasq, `PXE_TRUST_PROXY=1`, `PXE_ALLOWED_HOSTS=10.99.0.2`), unit `pxe-dashboard` (user `pxe`, `127.0.0.1:3000`), nginx `10.99.0.2:80` (X-Real-IP, X-Forwarded-*/Forwarded dibuang). Lalu `GET http://10.99.0.2/api/settings` dari host → `deploy-dashboard.txt`. |
| `kvm-run.sh <m> [--nodes "11:uefi[:destroy] 12:bios"] [--keep-server] [--skip-build]` | Orkestrasi suite KVM: preflight (alat, OVMF, RAM → maks node, suite `dashboard/e2e-kvm`) → `net-up` → `server-up` → `deploy-dashboard` → `server-check.txt` → key ed25519 sekali pakai → node `pxe-test-<m>-nodeNN` (MAC `52:54:00:99:00:NN`, IP `10.99.0.(10+NN)`) → Playwright `dashboard/e2e-kvm/playwright.config.ts` → `ssh 'bash -s' < dashboard/e2e-kvm/verify-node.sh` per node + cek login password ditolak → bukti → `redact-evidence.sh` (samarkan token `/boot/<mac>/<token>` + hash `$6$` di semua bukti, scan ulang; temuan = run FAIL) → cleanup **selalu** (trap EXIT: node run ini, `cleanup.sh <m>`, `--server` kecuali `--keep-server` atau gagal sebelum tahap server; key dihapus). Ringkasan langkah: `kvm-run.txt`. |
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

Contoh:
```
infra/net-up.sh && infra/server-up.sh
infra/smoke.sh pxe-test-m4-smoke01 52:54:00:99:00:01 uefi
infra/smoke.sh pxe-test-m4-smoke02 52:54:00:99:00:02 bios
infra/cleanup.sh m4 && infra/server-down.sh
INFRA_DRY_RUN=1 infra/kvm-run.sh m4        # cetak rencana tanpa mutasi
infra/kvm-run.sh m4 --nodes "11:uefi"      # gate AC-4.30/31 saja
```
