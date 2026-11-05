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
| `node.sh create\|destroy <name> <mac> [uefi\|bios]` | VM node: qcow2 20G di `.agent/vms/`, 2 GB, 2 vCPU, `--pxe --boot network,hd` (UEFI: OVMF non-secure-boot). Console → `.agent/runs/<run>/kvm/<name>-console.log`. |
| `smoke.sh <name> <mac> <uefi\|bios>` | Smoke rantai boot dengan script iPXE statis (`smoke/boot-smoke.ipxe`); bukti → `.agent/runs/m4/kvm/smoke/`. |
| `cleanup.sh [run] [--server] [--base]` | Hapus VM `pxe-test-<run>-*` + disknya; `--server` undefine server + overlay; `--base` hapus base. Snapshot `virsh list`/`net-list` sebelum/sesudah → `cleanup.txt`. |
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

Contoh:
```
infra/net-up.sh && infra/server-up.sh
infra/smoke.sh pxe-test-m4-smoke01 52:54:00:99:00:01 uefi
infra/smoke.sh pxe-test-m4-smoke02 52:54:00:99:00:02 bios
infra/cleanup.sh m4 && infra/server-down.sh
```
