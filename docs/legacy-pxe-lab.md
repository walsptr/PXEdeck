# PXE Boot Lab — Ubuntu 24.04.5 Autoinstall

Lab PXE server untuk instalasi Ubuntu Server 24.04.5 LTS otomatis (*zero-touch*) ke node baremetal,
menggunakan **dnsmasq** (DHCP/TFTP/DNS), **NFS** (root live installer), **Apache** (autoinstall) dan
**Subiquity autoinstall** (cloud-init NoCloud).

Status: **sudah di-deploy dan diuji end-to-end** pada 2026-11-04 (UEFI, node uji 4 GB RAM / 20 GB disk,
±5–9 menit dari power-on sampai node siap SSH, tanpa intervensi).

Peran dalam alur OpenStack (kolla-ansible): PXE hanya menyiapkan **OS dasar + IP management statis per node
(berdasarkan MAC) + SSH key + sudo**. Hostname final, NIC lain, bond/VLAN, dan prasyarat lain dikerjakan oleh
automation pre-req, lalu kolla-ansible.

---

## 1. Topologi

```
                       Internet
                          │
              ┌───────────┴────────────┐
              │  libvirt "default" NAT │ 192.168.122.0/24
              └───────────┬────────────┘
                          │ enp1s0 192.168.122.180  (management / uplink)
              ┌───────────┴────────────┐
              │   PXE server           │  foreman.local — Ubuntu 24.04.5
              │   dnsmasq · NFS ·      │
              │   apache2 · nftables   │
              └───────────┬────────────┘
                          │ enp7s0 10.10.10.1/24    (provisioning, DHCP di sini)
              ┌───────────┴────────────┐
              │ libvirt "int" (virbr1) │  terisolasi, tanpa DHCP libvirt
              └───────────┬────────────┘
                 ┌────────┴────────┐
              node-1   node-2 ...     baremetal / VM — PXE boot (UEFI atau BIOS)
```

| Item | Nilai |
|---|---|
| PXE server (SSH) | `ubuntu@192.168.122.180` |
| Interface provisioning | `enp7s0` — `10.10.10.1/24` |
| DHCP range | `10.10.10.100` – `10.10.10.200` (lease 12 jam) |
| Gateway / DNS untuk node | `10.10.10.1` (NAT keluar via `enp1s0`, DNS forward ke `192.168.122.1`, `1.1.1.1`) |
| Domain | `pxe.lab` |
| ISO | `ubuntu-24.04.5-live-server-amd64.iso` (SHA256 `97f3d7ff…f85a7`, terverifikasi) |

## 2. Alur Boot

```
Node power-on (PXE)
 │ 1. DHCP DISCOVER ──────────────► dnsmasq: IP + bootfile sesuai arsitektur (option 93)
 │                                   • UEFI x86_64 → bootx64.efi (shim, Secure Boot OK)
 │                                   • BIOS        → pxelinux.0
 │ 2. TFTP: shim → grubx64.efi → grub/grub.cfg   (BIOS: pxelinux.cfg/default)
 │ 3. TFTP: ubuntu-24.04/vmlinuz + initrd
 │ 4. Kernel: ip=dhcp netboot=nfs nfsroot=10.10.10.1:/srv/pxe/nfs/ubuntu-24.04
 │            → root live installer di-mount via NFS (ISO TIDAK disalin ke RAM)
 │ 5. cloud-init: ds=nocloud-net;s=http://10.10.10.1/pxe/autoinstall/nodes/<mac>/
 │            → GET user-data per node (MAC belum terdaftar → fallback user-data default/DHCP)
 │ 6. Subiquity autoinstall: partisi LVM, install, paket, update security (via NAT)
 │ 7. late-commands: sudoers, BootOrder UEFI (Ubuntu paling atas), guard reboot
 ▼ 8. Reboot → boot dari disk dengan IP management statis → siap di-remote automation
```

Menu boot (timeout 10 detik, default = autoinstall):

1. **Ubuntu 24.04.5 - Autoinstall (MENGHAPUS DISK!)**
2. Ubuntu 24.04.5 - Install manual (interaktif)
3. Boot dari disk lokal

## 3. Struktur Project

```
PXE-BOOT/
├── README.md
├── scripts/
│   ├── setup-pxe-server.sh          # provisioning server end-to-end (idempotent)
│   └── pxe-nodes                    # → /usr/local/sbin/pxe-nodes (inventaris MAC → IP management)
└── configs/
    ├── netplan/60-pxe.yaml          # → /etc/netplan/60-pxe.yaml
    ├── dnsmasq/pxe.conf             # → /etc/dnsmasq.d/pxe.conf
    ├── nfs/exports                  # → /etc/exports.d/pxe.exports
    ├── apache/pxe.conf              # → /etc/apache2/conf-available/pxe.conf
    ├── nftables/nftables.conf       # → /etc/nftables.conf (NAT)
    ├── nodes/nodes.csv.example      # → /srv/pxe/nodes.csv (hanya jika belum ada)
    ├── tftp/grub/grub.cfg           # → /srv/pxe/tftp/grub/grub.cfg (UEFI)
    ├── tftp/pxelinux.cfg/default    # → /srv/pxe/tftp/pxelinux.cfg/default (BIOS)
    └── autoinstall/
        ├── user-data                # → /srv/pxe/http/autoinstall/user-data
        ├── meta-data                # (kosong, wajib ada untuk NoCloud)
        └── vendor-data              # (kosong, mencegah retry 404)
```

Layout di server:

```
/srv/pxe/
├── nodes.csv                  # inventaris node: mac,ip,hostname  (sumber kebenaran)
├── dhcp-hosts                 # di-generate: reservasi DHCP (dnsmasq dhcp-hostsfile)
├── iso/ubuntu-24.04.5-live-server-amd64.iso
├── nfs/ubuntu-24.04/          # loop mount ISO (fstab, read-only) — diekspor via NFS
├── http/                      # http://10.10.10.1/pxe/
│   ├── iso/  → symlink ke ISO (untuk opsi url=, lihat §8)
│   └── autoinstall/
│       ├── {user-data,meta-data,vendor-data}     # default (MAC belum terdaftar, DHCP)
│       └── nodes/<mac>/{user-data,meta-data,vendor-data}   # di-generate per node
└── tftp/
    ├── bootx64.efi            # shimx64.efi.signed.latest (shim-signed)
    ├── grubx64.efi            # grubnetx64.efi.signed (grub-efi-amd64-signed)
    ├── grub/grub.cfg
    ├── pxelinux.0, ldlinux.c32, libcom32.c32, libutil.c32, menu.c32
    ├── pxelinux.cfg/default
    ├── pxelinux.cfg/01-<mac-dash>      # di-generate per node (BIOS)
    └── ubuntu-24.04/{vmlinuz,initrd}   # diekstrak dari casper/ di ISO
```

## 4. Komponen & Port

| Layanan | Paket | Listen | Fungsi |
|---|---|---|---|
| DHCP | dnsmasq | `enp7s0:67/udp` | IP + bootfile untuk node |
| TFTP | dnsmasq | `10.10.10.1:69/udp` | bootloader, kernel, initrd |
| DNS | dnsmasq | `10.10.10.1:53` | forwarder untuk node (tidak bentrok dengan systemd-resolved di 127.0.0.53) |
| NFS | nfs-kernel-server | `2049/tcp` | root live installer (isi ISO), ekspor `ro` hanya ke `10.10.10.0/24` |
| HTTP | apache2 | `*:80` | `/pxe/autoinstall/` (+ fallback `mod_rewrite` untuk MAC tak terdaftar), `/pxe/iso/` |
| NAT | nftables | — | `10.10.10.0/24` → masquerade via `enp1s0`, `net.ipv4.ip_forward=1` |

dnsmasq memakai `interface=enp7s0` + `bind-dynamic`, jadi **DHCP hanya dilayani di enp7s0**
dan tetap aman bila enp7s0 belum punya IP saat boot.

## 5. Instalasi / Deploy Ulang

Dari mesin lokal (root project ini):

```bash
rsync -a --delete configs scripts ubuntu@192.168.122.180:~/pxe-lab/
HASH="$(openssl passwd -6)"            # password user 'ubuntu' node (tidak disimpan di repo)
KEY="$(cat ~/.ssh/id_ed25519.pub)"     # public key admin
ssh ubuntu@192.168.122.180 "cd ~/pxe-lab && sudo PXE_PASSWORD_HASH='$HASH' PXE_ADMIN_SSH_KEY='$KEY' bash scripts/setup-pxe-server.sh"
```

`configs/autoinstall/user-data` adalah **template**: placeholder `@PXE_PASSWORD_HASH@` dan
`@PXE_ADMIN_SSH_KEY@` diisi dari env saat langkah 7 (script gagal bila env kosong/tidak valid).

Script melakukan 9 langkah (aman dijalankan berulang):

1. Netplan `enp7s0` → `10.10.10.1/24` (+ DNS uplink `enp1s0`)
2. Install paket: `nfs-kernel-server dnsmasq apache2 pxelinux syslinux-common shim-signed grub-efi-amd64-signed nftables`
3. Buat direktori `/srv/pxe/...`
4. Download ISO (jika belum ada) + verifikasi SHA256
5. Loop-mount ISO via fstab, ekspor NFS, salin `vmlinuz`/`initrd`
6. Pasang bootloader BIOS (pxelinux) & UEFI (shim + grub) beserta menu
7. Publikasikan autoinstall via Apache (`a2enconf pxe`)
8. dnsmasq, IP forwarding, NAT nftables
9. Pasang `pxe-nodes`, buat `/srv/pxe/nodes.csv` jika belum ada, lalu `pxe-nodes apply`

> `nodes.csv` di server **tidak** ditimpa oleh script, jadi inventaris aman saat deploy ulang.
> Setelah mengubah `configs/autoinstall/user-data` (template dasar), jalankan `sudo pxe-nodes apply`
> agar `user-data` per node ikut di-generate ulang. Script sudah melakukannya di langkah 9.

Mengubah template autoinstall cukup dengan menjalankan ulang script di atas (idempoten; langkah 7
me-render template dengan env yang sama, langkah 9 menjalankan `pxe-nodes apply`). Jangan menyalin
template mentah ke `/srv/pxe/http/autoinstall/` — placeholder-nya belum terisi.

## 6. IP Management per Node (`pxe-nodes`)

Setiap node didaftarkan berdasarkan **MAC NIC PXE/management**. Node yang terdaftar mendapat:

- **Reservasi DHCP** (`dhcp-host=<mac>,id:*,<ip>,<hostname>`), sehingga IP sudah sama sejak tahap PXE/installer.
  `id:*` membuat dnsmasq mengabaikan client-id, karena firmware, installer dan OS memakai client-id berbeda.
- **IP statis di OS terinstall**: `user-data` per MAC hanya mengonfigurasi NIC yang MAC-nya cocok
  (`match: macaddress`), dengan gateway `10.10.10.1` dan DNS `10.10.10.1`.
  **NIC lain dibiarkan tanpa konfigurasi**, siap untuk automation pre-req / kolla-ansible
  (mis. `neutron_external_interface` yang memang tidak boleh punya IP).
- **Hostname sementara** (opsional, default `node-10-10-10-X`). Hostname final diatur oleh automation Anda.

### Alur kerja

```bash
# 1) Nyalakan node baru (PXE). MAC-nya akan terlihat di lease DHCP:
sudo pxe-nodes discover
MAC                 IP SAAT INI     HOSTNAME DHCP    TERAKHIR TERLIHAT   STATUS
52:54:00:10:10:11   10.10.10.193    ubuntu-node      2026-11-04 04:35    BELUM TERDAFTAR

# 2) Tentukan IP management (+ hostname opsional)
sudo pxe-nodes add 52:54:00:10:10:11 10.10.10.11 node01

# 3) Cek / ubah / hapus
sudo pxe-nodes list
sudo pxe-nodes add 52:54:00:10:10:11 10.10.10.12      # ubah IP (re-add menimpa entri)
sudo pxe-nodes remove 52:54:00:10:10:11

# 4) Install / re-install node: PXE boot → otomatis memakai IP yang ditentukan
```

Banyak node sekaligus: edit `/srv/pxe/nodes.csv`, lalu jalankan `sudo pxe-nodes apply`:

```csv
mac,ip,hostname
52:54:00:10:10:11,10.10.10.11,node01
52:54:00:10:10:12,10.10.10.12,
```

Validasi yang dilakukan `pxe-nodes`:
- IP harus di `10.10.10.0/24`, bukan `.1`, dan **di luar range DHCP dinamis `.100`–`.200`**.
  Gunakan `.2`–`.99` atau `.201`–`.254`.
- MAC, IP dan hostname tidak boleh duplikat.

Cara pemilihan per node:
- **UEFI**: `grub.cfg` memakai `s=http://10.10.10.1/pxe/autoinstall/nodes/${net_default_mac}/`.
- **BIOS**: pxelinux otomatis memuat `pxelinux.cfg/01-<mac>` yang di-generate.
- **MAC belum terdaftar**: Apache (`mod_rewrite`) menyajikan `user-data` default (DHCP, hostname `ubuntu-node`).
  Node seperti ini **tetap ter-install**, jadi daftarkan MAC sebelum install bila IP harus pasti.

Setelah install, cloud-init otomatis nonaktif (`/etc/cloud/cloud-init.disabled`), sehingga netplan
`/etc/netplan/50-cloud-init.yaml` (interface id `mgmt`) tidak akan ditimpa ulang. Automation pre-req
boleh mengganti atau menambah file netplan sendiri.

Parameter jaringan (`MGMT_NET`, `GATEWAY`, `DNS`, `DYN_RANGE`) ada di bagian atas `scripts/pxe-nodes`.

## 7. Konfigurasi Autoinstall (`configs/autoinstall/user-data`)

Ini adalah **template dasar**. `pxe-nodes` menyalinnya per node dan hanya mengganti `identity.hostname`
dan `network`.

| Item | Nilai default |
|---|---|
| Locale / keyboard / timezone | `en_US.UTF-8` / `us` / `Asia/Jakarta` |
| Hostname | `ubuntu-node` (default) / dari inventaris (per node) |
| User / password | `ubuntu` / hash SHA-512 dari env `PXE_PASSWORD_HASH` saat deploy (`openssl passwd -6`); template memuat placeholder `@PXE_PASSWORD_HASH@` |
| SSH | OpenSSH terpasang, login password diizinkan, authorized key admin dari env `PXE_ADMIN_SSH_KEY` saat deploy (placeholder `@PXE_ADMIN_SSH_KEY@`) |
| Sudo | `ubuntu` NOPASSWD (`/etc/sudoers.d/90-ubuntu`) |
| Network | default: DHCP pada `en*`; per node: statis hanya pada NIC management (match MAC) |
| Storage | layout `lvm`, `sizing-policy: all` (disk terbesar, **seluruh disk dihapus**) |
| Paket tambahan | `curl vim net-tools`, `updates: security` |
| Setelah selesai | `shutdown: reboot` |

late-commands:

1. **Sudoers** untuk user `ubuntu`.
2. **BootOrder UEFI**: entry `Ubuntu` dipindah ke urutan pertama via `efibootmgr`, supaya node tidak
   PXE-install ulang terus-menerus setelah reboot.
3. **Guard reboot netboot NFS**: unit `pxe-force-reboot` (`systemd-run`, `DefaultDependencies=no`).
   Unit ini menunggu sampai sistem berstatus `stopping`, lalu 45 detik kemudian menjalankan `sync`
   dan reboot via sysrq. Penjelasannya ada di §10.

## 8. Menambah Node Baremetal

1. Hubungkan NIC node ke segmen yang sama dengan `enp7s0` (jangan ada DHCP server lain di segmen itu).
2. BIOS/UEFI node:
   - Aktifkan **Network/PXE boot (IPv4)**. UEFI dan Secure Boot didukung (shim bertanda tangan Microsoft).
   - Urutan boot yang disarankan: **Disk → Network**. Disk kosong otomatis jatuh ke PXE, dan disk yang
     sudah terinstall boot normal. Untuk UEFI, late-command juga menaruh Ubuntu di urutan pertama.
3. RAM minimal **4 GB** (sudah diuji). Disk minimal ~10 GB (diuji dengan 20 GB, terpakai 6,3 GB).
4. Daftarkan MAC NIC management dengan IP-nya (§6): `sudo pxe-nodes add <mac> <ip>`.
   MAC bisa dilihat di BIOS/BMC (iDRAC/iLO), atau dengan menyalakan node sekali lalu `sudo pxe-nodes discover`.
5. Power-on dan pantau dari server:
   ```bash
   sudo tail -f /var/log/dnsmasq-pxe.log          # DHCP + TFTP
   sudo tail -f /var/log/apache2/access.log       # fetch user-data
   ```
6. SSH ke node lewat PXE server sebagai jump host (atau langsung dari host automation di segmen management):
   ```bash
   ssh -J ubuntu@192.168.122.180 ubuntu@10.10.10.11
   ```

> ⚠️ Default menu adalah **autoinstall yang menghapus disk**. Mesin apa pun di segmen `enp7s0` yang boot
> dari jaringan akan di-install ulang setelah 10 detik.

## 9. Hasil Pengujian

VM uji `pxe-test-node01` di host KVM (network `int`, MAC `52:54:00:10:10:11`, UEFI/OVMF, 2 vCPU, 4 GB RAM, disk 20 GB).

**Uji 1: MAC belum terdaftar (user-data default, DHCP)**

| Tahap | Hasil |
|---|---|
| DHCP (tag `efi-x86_64`) → TFTP `bootx64.efi` → `grubx64.efi` → `grub.cfg` → kernel/initrd | ✅ |
| Live root via NFS, fetch `user-data` (`Cloud-Init/26.1`) | ✅ |
| Subiquity `Install: SUCCESS`, auto-reboot tanpa intervensi | ✅ (±535 detik) |
| Boot dari disk: `ubuntu-node`, Ubuntu 24.04.5 LTS, kernel 6.8.0-147 | ✅ |
| LVM `/` 17 GB, `/boot` dan `/boot/efi` terpisah, fsck `clean` | ✅ |
| SSH key + sudo NOPASSWD + internet via NAT | ✅ |
| `BootCurrent: 0007` (Ubuntu) di urutan pertama BootOrder | ✅ |

**Uji 2: node terdaftar `pxe-nodes add 52:54:00:10:10:11 10.10.10.11 node01`**

| Tahap | Hasil |
|---|---|
| DHCP saat PXE/installer/OS selalu `10.10.10.11 node01` (reservasi) | ✅ |
| Fetch `/pxe/autoinstall/nodes/52:54:00:10:10:11/user-data` | ✅ |
| OS: hostname `node01`, `enp1s0 10.10.10.11/24` statis, default via `10.10.10.1`, DNS `10.10.10.1` | ✅ |
| netplan hanya berisi interface `mgmt` (match MAC), cloud-init `disabled` | ✅ |
| Power-on sampai SSH siap | ✅ ±5 menit |
| Validasi: IP di range dinamis / IP duplikat ditolak | ✅ |
| MAC tak terdaftar → fallback `user-data` default (HTTP 200) | ✅ |

Jalur BIOS/legacy (pxelinux) sudah dikonfigurasi dan dnsmasq menyajikannya untuk client-arch 0,
tetapi **belum diuji** dengan node BIOS.

Hapus VM uji (dijalankan di host KVM):

```bash
virsh -c qemu:///system destroy pxe-test-node01
virsh -c qemu:///system undefine pxe-test-node01 --nvram --remove-all-storage
```

## 10. Troubleshooting (masalah yang ditemukan saat pengujian)

### `wget: short write: No space left on device` → `Unable to find a live file system on the network`
Penyebab: dengan opsi kernel `url=http://.../ubuntu-24.04.5-live-server-amd64.iso`, initramfs mengunduh
**seluruh ISO (4,08 GB) ke tmpfs di RAM**, dan tmpfs itu hanya sekitar 50% RAM. Ini bukan masalah disk node.
Dengan `url=`, node butuh lebih dari 10 GB RAM.
**Solusi yang diterapkan:** boot memakai `netboot=nfs nfsroot=10.10.10.1:/srv/pxe/nfs/ubuntu-24.04`,
sehingga isi ISO dibaca langsung lewat NFS. Hasilnya, node 4 GB RAM berhasil.

### `[FAILED] Failed unmounting cdrom.mount - /cdrom` lalu node macet saat reboot
Penyebab: pada netboot NFS, `/cdrom` (root live) masih di-mount NFS ketika jaringan sudah dimatikan
saat shutdown, sehingga proses unmount menunggu tanpa batas. Instalasi sendiri **sudah selesai** di titik ini.
Opsi `nfsopts=soft,...` sudah dicoba dan **tidak** membantu.
**Solusi yang diterapkan:** late-command guard `pxe-force-reboot`. 45 detik setelah shutdown dimulai, guard
menjalankan `sync` lalu reboot paksa (sysrq). Pesan `[FAILED]` masih tampil, tetapi itu normal; node lanjut reboot sendiri.

### Lainnya

| Gejala | Cek |
|---|---|
| Node tidak dapat IP yang ditentukan | `sudo pxe-nodes list`, `cat /srv/pxe/dhcp-hosts`; pastikan MAC = NIC yang dipakai PXE; cek `sudo pxe-nodes discover` |
| Node tidak dapat IP | `sudo ss -lnup \| grep :67`, pastikan tidak ada DHCP lain di segmen, dan cek `journalctl -u dnsmasq` |
| `revocations.efi not found` / `grub/x86_64-efi/*.lst not found` di log | Normal, karena shim/grub mencoba file opsional |
| Node PXE-install berulang | Atur urutan boot Disk → Network; cek `efibootmgr` di node |
| Autoinstall berhenti meminta konfirmasi | Pastikan parameter `autoinstall` ada di cmdline dan `user-data` valid (`curl http://10.10.10.1/pxe/autoinstall/user-data`) |
| Log installer di node | `/var/log/installer/` (`subiquity-server-debug.log`, `curtin-install.log`) |

## 11. Catatan Kondisi Server

- VM ini sebelumnya berisi sisa instalasi Foreman yang sudah di-purge. **Apache** sempat berjalan tanpa
  `/etc/apache2` (pasti gagal bila di-restart). Konfigurasinya saya pulihkan dengan
  `apt install --reinstall -o Dpkg::Options::=--force-confmiss apache2`, lalu modul default, `000-default`,
  dan `pxe.conf` diaktifkan.
- Layanan sisa lainnya (`puppetserver`/OpenVox, `postgresql`, `redis`) **tidak disentuh** dan masih berjalan.
- DNS uplink sebelumnya kosong (`releases.ubuntu.com` tidak bisa di-resolve). Nameserver ditambahkan
  di `/etc/netplan/60-pxe.yaml`.
- `netplan apply` sempat gagal sesaat di `netplan-ovs-cleanup.service` (berhasil saat diulang). Karena itu
  script hanya menjalankan `netplan apply` bila file netplan berubah.
- `ufw` tidak aktif. Ruleset nftables hanya berisi tabel `ip pxe_nat`.
- Kredensial default `ubuntu/ubuntu` dan login password SSH hanya untuk lab. Matikan `allow-pw`
  dan ganti hash password sebelum dipakai di luar lab.
