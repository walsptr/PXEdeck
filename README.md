# PXEdeck: PXE Boot Dashboard

PXEdeck adalah dashboard web untuk provisioning mesin baremetal atau VM lewat PXE. Mesin yang
melakukan PXE boot otomatis muncul di dashboard. Admin mengatur OS, kredensial, jaringan, hostname
dan SSH key, lalu klik **Simpan & Install**. Dashboard menyajikan script iPXE dan konfigurasi installer
per MAC, memantau proses instalasi sampai selesai, lalu mesin reboot dari disk dan bisa langsung di-SSH
dengan key yang di-inject.

Seluruh alur ini sudah dibuktikan di VM KVM sungguhan:
- Ubuntu 24.04 (UEFI dan BIOS)
- Debian 12 (UEFI)
- Rocky Linux 9 (UEFI)
- Topologi flat maupun **VLAN PXE terpisah**: trunk dengan VLAN PXE native dan VLAN management ber-tag

---

## Fitur

- **Discovery host otomatis.** Host diambil dari lease dnsmasq dan request iPXE. Tabel Hosts
  menampilkan MAC, IP, vendor, status, dan last seen, dengan pencarian, filter, dan bulk action.
- **Konfigurasi per host atau bulk** lewat Sheet dengan lima tab:
  - **OS:** memilih image dan disk target.
  - **Credentials:** password yang sama, acak per host (hanya ditampilkan sekali), atau import CSV.
  - **Network:** DHCP, atau IP statis dengan prefix, gateway, DNS, dan VLAN. Tersedia range IP dengan
    preview dan deteksi bentrok.
  - **Hostname:** template dengan preview.
  - **SSH key:** dari library, atau paste/unggah.
- **Generator installer:**
  - Ubuntu autoinstall (cloud-init)
  - Debian preseed
  - Rocky kickstart
  - Windows unattend (generator saja, belum dilayani)
- **Token per job.** Hash token disimpan di DB, request dengan token salah mendapat 404 seragam, dan
  konfigurasi per MAC hanya bisa diambil dari IP lease host tersebut.
- **Siklus hidup job:** Booting → Installing → Configuring → Done/Failed.
  - Watchdog timeout per tahap.
  - Batas berapa kali installer disajikan; mesin yang reboot di tengah instalasi boot dari disk, tidak
    menginstal ulang.
  - Log installer tampil live (SSE), dengan redaksi secret di sisi server.
- **Halaman lain:** Provisioning Jobs, OS Images, SSH Keys, Settings, dan status DHCP/TFTP/HTTP.
- **VLAN management.** Env `PXE_VLAN_NETWORKS` mendaftarkan subnet per VLAN, lalu IP statis divalidasi
  terhadap subnet VLAN tersebut. Tab Network otomatis mengisi prefix dan gateway.
- **Keamanan:**
  - Login admin tunggal (hash scrypt dari env), sesi di SQLite, cookie `HttpOnly` dan `SameSite=Strict`.
  - Rate limit untuk login, API, dan SSE.
  - Server menolak start bila konfigurasi production tidak aman.
  - Access log nginx tanpa query string.

## Arsitektur

```
 Node (PXE/UEFI/BIOS)
   │ DHCP + TFTP (dnsmasq) ──► snponly.efi / undionly.kpxe ──► iPXE
   │ HTTP  GET /boot/<mac>.ipxe ───────────────┐
   │ HTTP  GET /boot/<mac>/<token>/user-data   │
   │ HTTP  POST /boot/<mac>/<token>/status|log │
   │ NFS / HTTP media (ISO di /srv/pxe/media)  │
   ▼                                           ▼
 ┌──────────────────────────── PXE server ────────────────────────────┐
 │ dnsmasq (DHCP/TFTP, bind ke NIC provisioning)                      │
 │ nginx :80 ──► Next.js dashboard 127.0.0.1:3000 (systemd, user pxe) │
 │               SQLite /var/lib/pxe-dashboard                        │
 │ nfs-kernel-server (root live installer, read-only)                 │
 └────────────────────────────────────────────────────────────────────┘
        ▲
        └── Admin (browser) → UI + /api (login wajib, allowlist admin)
```

- iPXE di node meminta `/boot/<mac>.ipxe`.
  - Host tanpa job mendapat **boot dari disk lokal**.
  - Host dengan job Install mendapat kernel/initrd installer beserta URL konfigurasi ber-token.
- Installer melapor status dan mengirim log ke `/boot/<mac>/<token>/…`. Job jadi Done setelah callback
  firstboot dari OS yang sudah terpasang.

## Stack

- **Dashboard:** Next.js 16, React 19, shadcn/ui (Radix), TanStack Table dan Query, Tailwind 4,
  SQLite (`node:sqlite`), zod.
- **Test:** Vitest (unit dan integration), Playwright + axe (E2E), harness KVM/libvirt (`infra/`).
- **Server:** Ubuntu 24.04, dnsmasq, nginx, NFS, Node 22.

## Menjalankan untuk development

```bash
cd dashboard
npm ci
cp .env.example .env.local          # sesuaikan subnet, URL, dsb.
printf '%s' 'password-admin-anda' | npm run --silent admin:hash
# isi PXE_ADMIN_USERNAME dan PXE_ADMIN_PASSWORD_HASH di .env.local
# (di .env.local tulis setiap '$' pada hash sebagai '\$')
PXE_SEED=demo npm run dev           # http://localhost:3000
```

Tanpa `PXE_DNSMASQ_LEASES`, dashboard berjalan dalam mode dev: verifikasi lease nonaktif dan status
DHCP/TFTP tampil "unknown". Semua variabel lingkungan beserta penjelasannya ada di
[`dashboard/.env.example`](dashboard/.env.example).

Perintah lain:

```bash
npm run typecheck      # next typegen + tsc
npm run lint
npm run test           # vitest + coverage
npm run test:e2e       # Playwright (menjalankan server sendiri)
npm run build          # production build; PXE_STANDALONE=1 untuk output standalone
```

## Deploy ke PXE server

Contoh konfigurasi server lengkap ada di [`infra/server/`](infra/server/):

| File | Isi |
|---|---|
| `dnsmasq.conf` | DHCP/TFTP, wajib `interface=<NIC provisioning>` + `bind-interfaces`; boot iPXE → `http://<server>/boot/${mac}.ipxe` |
| `nginx-pxe.conf` | Proxy ke dashboard, `X-Real-IP`, allowlist admin untuk UI/`/api`, `/boot` dan `/media` terbuka untuk klien PXE, rate limit, log tanpa query string |
| `pxe-dashboard.service` | Unit systemd (Next standalone, `127.0.0.1:3000`, user `pxe`, `EnvironmentFile=/etc/pxe-dashboard.env`) |
| `dashboard.env` | Contoh env server (hash admin berupa placeholder; jangan commit hash asli) |
| `install-dashboard.sh` | Pasang rilis ke `/opt/pxe-dashboard/releases/<ts>` + symlink `current` |
| `exports`, `nfs.conf`, `nftables.conf`, `netplan.yaml` | NFS read-only untuk root installer, firewall, dan jaringan |
| `vlan/` | Profil topologi VLAN (sub-interface ber-tag, dnsmasq hanya di VLAN PXE) |

Langkah umum:

1. Siapkan server Ubuntu 24.04 dengan dnsmasq, nginx, dan nfs-kernel-server. Mount ISO OS ke
   `/srv/pxe/media/<id>` dan siapkan biner iPXE di `/srv/pxe/tftp` (lihat `infra/tftp/prepare.sh`).
2. Build dashboard: `cd dashboard && PXE_STANDALONE=1 npm run build`. Salin `.next/standalone`,
   `.next/static`, dan `public` ke server.
3. Tulis `/etc/pxe-dashboard.env` (mode 0640, root:pxe). Isi minimal:
   - `PXE_ADMIN_USERNAME` dan `PXE_ADMIN_PASSWORD_HASH`
   - `PXE_MGMT_CIDR`, `PXE_MGMT_GATEWAY`, `PXE_MGMT_DNS`, `PXE_SERVER_IP`, `PXE_DHCP_RANGE`
   - `PXE_BASE_URL`, `PXE_MEDIA_URL`
   - `PXE_DNSMASQ_LEASES` (wajib bila `PXE_TRUST_PROXY=1`)
   - opsional `PXE_VLAN_NETWORKS`
4. Aktifkan `pxe-dashboard.service` dan nginx, lalu verifikasi:
   - `ss -lunp`: dnsmasq hanya listen di NIC provisioning.
   - `/login` mengembalikan 200.
   - `/api/settings` tanpa sesi mengembalikan 401.

Untuk lab KVM, `infra/deploy-dashboard.sh` mengotomatiskan semua langkah ini (build → scp →
install → verifikasi).

> ⚠️ Konfigurasi dengan status Install akan **menghapus disk** target. Jalankan hanya di segmen
> provisioning yang terisolasi, tanpa DHCP server lain.

## Topologi VLAN

PXEdeck mendukung topologi production berikut:
- Port node berupa trunk: VLAN PXE native (untagged) dan VLAN management ber-tag.
- Server PXE terhubung lewat sub-interface ber-tag.
- Firmware node tidak perlu mendukung tag VLAN.

Contoh env:

```env
PXE_MGMT_CIDR=10.99.10.0/24            # subnet VLAN PXE (DHCP)
PXE_SERVER_IP=10.99.10.2
PXE_VLAN_NETWORKS=20:10.99.20.0/24:10.99.20.1
```

Syarat yang terbukti di pengujian:
- Bila VLAN PXE tidak punya router, VLAN management harus bisa menjangkau `PXE_SERVER_IP` lewat HTTP
  (untuk callback). Ubuntu juga butuh NFS, karena installer Ubuntu pindah ke VLAN management di tengah
  instalasi.
- `PXE_MGMT_DNS` (entri pertama) harus bisa dijangkau dari VLAN PXE. Debian 12 menerimanya lewat
  `netcfg/get_nameservers` karena udhcpc d-i tidak menulis DNS bila DHCP tidak memberi router.
- Di server PXE, layanan RPC NFS (rpcbind/mountd/statd) listen di wildcard. Untuk production,
  gunakan filter nftables per interface VLAN. Rekomendasinya ada di
  [`infra/README.md`](infra/README.md) §Topologi VLAN.

## Pengujian

| Lapisan | Isi |
|---|---|
| Unit/integration | ±2150 test Vitest; coverage kode baru ≥ 80% (aktual ~99%) |
| E2E | ±200 test Playwright + audit axe di 4 lebar layar |
| Infra | Test shell dry-run untuk semua script `infra/` (`infra/test/run.sh`) |
| KVM | `infra/kvm-run.sh`: VM node nyata PXE boot → dashboard (Playwright) → Done → verifikasi SSH, reboot dari disk, uji negatif (IP bentrok, CSV invalid, destroy di tengah install, token/MAC/IP salah, isolasi VLAN) |

Lab KVM berjalan tanpa sudo di jaringan libvirt terisolasi `pxe-test-*`. Detailnya ada di
[`infra/README.md`](infra/README.md).

## Struktur repo

```
dashboard/          Next.js app: UI, API, endpoint /boot (iPXE, config per-MAC, callback)
  src/lib/server/   settings, auth, generator installer, job lifecycle, redaksi log
  e2e/, e2e-kvm/    Playwright (mock) dan suite KVM
infra/              Lab KVM: network/VM pxe-test-*, PXE server VM, switch VLAN, deploy, test shell
  server/           Konfigurasi PXE server (dnsmasq, nginx, systemd, NFS, profil VLAN)
docs/
  SPEC.md           Spesifikasi produk
  design/           Plan per milestone
  agent-workflow/   Decision (DEC), approval (APR), dan report per milestone
  legacy-pxe-lab.md Dokumentasi lab PXE awal (dnsmasq + GRUB/pxelinux + Apache)
configs/, scripts/  Lab PXE awal sebelum dashboard (lihat docs/legacy-pxe-lab.md)
```

## Status

Milestone M1–M7 selesai, dengan tag `m1-approved` … `m7-approved`. Ringkasan, deviasi SPEC, dan
pekerjaan lanjutan ada di
[`docs/agent-workflow/reports/REPORT-final.md`](docs/agent-workflow/reports/REPORT-final.md).
Deviasi dan keterbatasan saat ini:
- Status Offline otomatis belum ada.
- Registrasi OS image hanya dari path lokal, belum dari URL.
- Instalasi Windows belum dilayani.
- Tab Credentials masih punya catatan aksesibilitas.
