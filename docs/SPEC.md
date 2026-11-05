# SPEC — PXE Boot Dashboard

Sumber kebenaran untuk fitur dan design system. Disusun dari prompt produk awal. Perubahan
hanya lewat decision (`docs/agent-workflow/decisions/`).

Kembangkan project PXE Boot yang ada menjadi web dashboard untuk mengelola host yang boot lewat
jaringan dan memprovisioning OS-nya. Stack frontend: Next.js (App Router) + TypeScript +
Tailwind CSS + shadcn/ui. TanStack Table untuk tabel host (sorting, filtering, row selection).

## 1. Design system (wajib)

Gaya: kanvas krem hangat, tinta hampir-hitam hangat, satu aksen oranye yang dipakai hemat,
**tanpa drop shadow**, kedalaman hanya dari garis hairline 1px.

### Warna (light mode saja) → variabel shadcn
| Token | Hex | Pemakaian |
|---|---|---|
| canvas | #f7f7f4 | `--background` |
| canvas-soft | #fafaf7 | area dalam panel, baris tabel hover |
| surface-card | #ffffff | `--card`, `--popover`, input |
| ink | #26251e | `--foreground`, teks utama, judul |
| body | #5a5852 | teks isi sekunder |
| muted | #807d72 | `--muted-foreground`, label, caption |
| muted-soft | #a09c92 | placeholder |
| hairline | #e6e5e0 | `--border`, `--input` |
| hairline-soft | #efeee8 | pemisah baris tabel |
| hairline-strong | #cfcdc4 | border hover/focus |
| surface-strong | #e6e5e0 | `--secondary`, `--muted`, badge netral |
| primary | #f54e00 | `--primary`, `--ring` — HANYA CTA utama |
| primary-active | #d04200 | hover/pressed primary |
| on-primary | #ffffff | `--primary-foreground` |
| semantic-error | #cf2d56 | `--destructive`, status gagal |
| semantic-success | #1f8a65 | status sukses/online |

Pastel tahap provisioning (HANYA di status pill/timeline): Discovered #9fbbe0, Booting #dfa88f,
Installing #c0a8dd, Configuring #9fc9a2, Done #c08532 (teks putih). Plus "Failed" merah dan
"Offline" abu.

### Tipografi
- Sans **Inter** (letter-spacing ≈ -1.5% untuk judul). Mono **JetBrains Mono** untuk SEMUA data
  teknis: MAC, IP, hostname, SSH key, log.
- Judul halaman 26px/400, letter-spacing -0.325px. Judul section/card 16–18px/600.
- Body 14/400. Caption 13px. Label kolom tabel 11px/600 uppercase, letter-spacing 0.88px, muted.
- Tombol & nav 14px/500.

### Bentuk & spacing
- Radius: tombol & input 8px; card/dialog/panel 12px; badge & pill 9999px.
- Tanpa shadow. Card dibedakan dengan hairline + putih di atas krem.
- Tombol 40px, input 44px (36–40px di tabel/dialog padat).
- Spacing: 4, 8, 12, 16, 20, 24, 32, 48.
- Tombol: primary oranye; secondary putih + hairline; tertiary teks; aksi gelap ink + teks krem.

## 2. Layout
- Sidebar kiri krem (border kanan hairline): Hosts, OS Images, SSH Keys, Provisioning Jobs, Settings.
- Top bar 64px: judul halaman, search global, status server PXE (DHCP/TFTP/HTTP online/offline).
- Konten lebar penuh, padding 24–32px.

## 3. Halaman Hosts

### 3.1 Tabel host
Kolom: checkbox; **MAC** (mono, tombol copy); hostname (mono, "—" bila kosong); IP saat ini (lease)
dan IP management; vendor (OUI); OS terpasang/ditugaskan; status provisioning (pill); last seen
(relatif); menu aksi (Install OS, Edit konfigurasi, Lihat log, Reboot ke PXE, Hapus).

Perilaku: update otomatis (polling 5 dtk atau SSE/WebSocket); pencarian MAC/hostname/IP; filter
status & OS; **bulk action bar** saat ada baris terpilih ("N host dipilih" + Install OS, Set
Credentials, Set Hostname, Set IP, Inject SSH Key); empty state yang menjelaskan host muncul
otomatis saat PXE boot.

### 3.2 Panel konfigurasi (Sheet kanan, 1 host atau bulk) — Tabs
- **OS**: pilih image (Ubuntu, Debian, Rocky, Windows, …); profil: disk target, partisi
  (auto/LVM/custom), timezone, locale; ringkasan sebelum konfirmasi.
- **Credentials**: per host username+password (show/hide, generator). Bulk: (A) satu
  user/password sama; (B) password acak unik per host, diunduh CSV sekali; (C) import CSV
  `mac,username,password` dengan preview + validasi per baris. Opsi sudoer, nonaktifkan login
  password SSH.
- **Network**: DHCP/Static. Static: IP, prefix, gateway, DNS (multiple), VLAN opsional, interface
  (by MAC/nama). Bulk: range IP atau IP awal + increment, preview MAC → IP. Validasi format,
  subnet, konflik host lain/lease aktif.
- **Hostname**: per host (RFC 1123). Bulk: template `node-{index:02}`, `web-{mac_suffix}`,
  `{prefix}-{ip_last_octet}` dengan preview & deteksi duplikat.
- **SSH Keys**: pilih dari library atau paste/upload; validasi ssh-ed25519/ssh-rsa/ecdsa-*;
  fingerprint SHA256; user target (default user Credentials).
- Footer: "Simpan konfigurasi" (secondary) dan "Simpan & Install" (primary) dengan AlertDialog
  karena install menghapus disk.

## 4. Halaman pendukung
- **OS Images**: nama, versi, arsitektur, metode (autoinstall/kickstart/preseed/unattend),
  registrasi ISO/URL.
- **SSH Keys**: CRUD dengan nama, fingerprint, tanggal.
- **Provisioning Jobs**: riwayat per host, timeline tahapan (pill pastel), log streaming (mono).
- **Settings**: interface, subnet DHCP, TFTP root, base URL HTTP.

## 5. Backend & integrasi PXE
- **Discovery**: catat host saat request DHCP/PXE (lease dnsmasq atau endpoint iPXE `${mac}`):
  MAC, IP, vendor, last_seen.
- **Boot per-MAC**: `GET /boot/{mac}.ipxe` → script iPXE sesuai status (boot lokal tanpa job,
  installer bila ada job Install).
- **Generator konfigurasi per host**: Ubuntu autoinstall (user-data/meta-data), RHEL/Rocky
  kickstart, Debian preseed, Windows unattend.xml — berisi user/password (hash), hostname,
  network statis, authorized_keys.
- **Callback status** dari installer (booting, installing, configuring, done, failed).
- Setelah selesai, host kembali ke boot lokal (tidak reinstall berulang).

### Model data minimal
`hosts`(id, mac unik, hostname, current_ip, vendor, status, os_image_id, last_seen);
`host_configs`(host_id, username, password_hash, network_mode, ip, prefix, gateway, dns[], vlan,
ssh_key_ids[]); `os_images`(id, name, version, arch, method, source);
`ssh_keys`(id, name, public_key, fingerprint); `jobs`(id, host_id, type, status, stages[], logs,
created_at).

### API
`GET/PATCH/DELETE /api/hosts[/:id]`, `POST /api/hosts/bulk`, `POST /api/hosts/:id/install`,
`POST /api/hosts/bulk/install`, `POST /api/credentials/import`, CRUD `/api/os-images`,
`/api/ssh-keys`, `GET /api/jobs`, `GET /api/jobs/:id/logs` (SSE).

## 6. Keamanan
- Password tidak pernah plaintext: hash SHA-512 crypt dipakai langsung di file installer. Password
  acak bulk hanya ditampilkan/diunduh sekali.
- Dashboard dilindungi login (minimal satu admin); semua API butuh autentikasi.
- File konfigurasi per host hanya untuk MAC/IP yang sesuai, idealnya token sekali pakai.
- Validasi semua input di server.

## 7. Kriteria selesai
- Host yang PXE boot muncul otomatis tanpa refresh manual.
- Bulk credentials/IP/hostname/SSH key dengan preview sebelum disimpan.
- Install OS menghasilkan file autoinstall/kickstart berisi konfigurasi tersebut; status bergerak
  Booting → Done.
- UI konsisten dengan design system.
- Milestone: (1) setup + tokens + layout, (2) tabel host mock, (3) sheet & bulk, (4) backend +
  iPXE, (5) callback & jobs, (6) hardening keamanan & E2E penuh.
