# M4 — Opsi teknis (backend + integrasi iPXE)

Dokumen ini berisi pilihan teknis yang berarti untuk M4. Setiap bagian memuat 2–3 opsi, kelebihan
dan kekurangannya, serta rekomendasi. Keputusan final ditulis Orchestrator sebagai `DEC-007` dan
seterusnya. Rujukan: SPEC §4–§6, DEC-003 (topologi KVM), DEC-004 (coverage), DEC-005 (seam
store), DEC-006 (subnet), README §10 (pelajaran `url=` vs NFS), `.agent/runs/preflight.json`
(RAM tersedia ±9,6 GB, maksimal 2 VM paralel, Node host v22.22.2, SELinux nonaktif, ACL
`user:qemu:--x` di `/home/syawal`).

Ringkasan rekomendasi ada di bagian akhir.

---

## O1. Persistence (menggantikan `mock-hosts.ts`)

Kebutuhan: model data SPEC §5, constraint unik (MAC, IP statis, hostname) untuk menutup race
G3-2, transaksi untuk apply bulk, satu job aktif per host, database sementara per test run
(DEC-005), dan tanpa server DB terpisah di VM `pxe-test-server`.

| | A. `node:sqlite` (bawaan Node 22) | B. `better-sqlite3` | C. File JSON |
|---|---|---|---|
| Dependensi | Tidak ada (builtin, tanpa flag sejak 22.13; host v22.22.2) | Native addon: prebuilt diunduh dari GitHub Releases (di luar allowlist curl) atau dikompilasi (butuh python/make/g++) | Tidak ada |
| API | Sinkron (`DatabaseSync`), `BEGIN IMMEDIATE` | Sinkron, matang, sangat cepat | Baca/tulis seluruh file |
| Constraint unik/FK/partial index | Ya (SQLite penuh) | Ya | Manual di kode |
| Atomik antar request | Ya: route handler sinkron + transaksi | Ya | Tidak (risiko file korup saat crash, perlu rename atomik + lock) |
| Bundling Next 16 / standalone | Builtin, otomatis eksternal | Perlu `serverExternalPackages` + ABI Node harus sama di VM | Mudah |
| Test (Vitest) | `:memory:` / file tmp per test. Risiko: resolusi `node:sqlite` di Vite (prefix-only builtin), mitigasi `server.deps.external` | Sama | Mudah |
| Stabilitas | Stability 1.1, mengeluarkan `ExperimentalWarning` | Stabil | Stabil, tetapi fitur kurang |

**Rekomendasi: A (`node:sqlite`) dengan SQL polos dan migrasi bernomor** (`schema_migrations`),
dibungkus repository kecil (`lib/server/db/*`) supaya API `node:sqlite` tidak bocor ke service.
Bila `node:sqlite` bermasalah di Vitest/Next, fallback ke B lewat decision (hanya lapisan
`db/index.ts` yang berubah). Tidak memakai ORM: skema kecil, dan ORM menambah dependensi tanpa
manfaat berarti.

Catatan model data (perluasan SPEC §5, tanpa mengurangi):
- `hosts`: + `mgmt_ip`, `firmware`, `os_installed`, `os_assigned`, `status_since`, `first_seen`.
  Unik: `mac`; unik `lower(hostname)` bila tidak NULL.
- `host_configs`: + `os_profile` (JSON: disk, partition, timezone, locale, customStorage),
  `sudo`, `disable_ssh_password`, `extra_keys` (JSON), `ssh_user`, `iface` (JSON),
  `updated_at`. `dns` dan `ssh_key_ids` disimpan di JSON (`dns`) dan tabel join
  `host_ssh_keys`. Unik parsial: `ip` WHERE `network_mode='static'`.
- `os_images`: + `source` (JSON: path kernel/initrd/repo/nfsroot relatif terhadap media),
  `available` dihitung saat runtime dari keberadaan file kernel di `PXE_MEDIA_ROOT`.
- `ssh_keys`: + `type`, `comment`, `created_at`.
- `jobs`: + `os_image_id`, `token_hash`, `token_expires_at`, `boot_served_at`, `updated_at`,
  `finished_at`. `stages` berupa JSON `[{stage, at, source}]`, `logs` berupa TEXT (kosong di M4,
  diisi di M5). Unik parsial: `host_id` WHERE `status IN ('booting','installing','configuring')`.
- `settings` (key/value) disiapkan, tetapi di M4 sumber kebenarannya env (lihat O10).

---

## O2. Mekanisme token untuk file konfigurasi per-MAC

Fakta yang menentukan:
- cloud-init `nocloud-net` mengambil beberapa file dari prefix yang sama (`user-data`,
  `meta-data`, `vendor-data`), dan bisa mengulang bila gagal.
- d-i dan anaconda juga bisa mengulang fetch.
- SPEC §6 meminta file hanya untuk MAC/IP yang sesuai, "idealnya token sekali pakai".

| | A. Token sekali pakai per request/file | B. Token per job (sekali pakai per instalasi) + binding MAC/IP + jendela tahap | C. URL bertanda tangan HMAC (stateless) + expiry |
|---|---|---|---|
| Kompatibel dengan multi-fetch cloud-init/d-i/anaconda | Tidak (fetch kedua gagal, instalasi macet) | Ya | Ya |
| Bisa dicabut (re-install, done, failed, hapus host) | Ya | Ya (hapus/ganti hash) | Tidak, tanpa daftar cabut (berarti stateful juga) |
| Kebocoran dari DB | Hash saja | Hash SHA-256 saja | Kunci HMAC di env (bocor = semua URL bisa dipalsukan) |
| Kompleksitas | Sedang | Rendah | Sedang (rotasi kunci) |

**Rekomendasi: B.** Detail:
- Token berupa 32 byte acak (`crypto.randomBytes`) dalam base64url. Dibuat saat
  `POST /api/hosts/:id/install`. DB hanya menyimpan `sha256(token)`. Token plaintext hanya muncul
  di script iPXE untuk host itu (dan di file konfigurasi yang sudah terkirim ke host tersebut).
- File konfigurasi (`/boot/{mac}/{token}/{file}`) hanya dilayani bila semua syarat berikut
  terpenuhi: hash cocok dengan job aktif, MAC di path = MAC host job, status job `booting` atau
  `installing`, belum lewat `token_expires_at` (default 6 jam), dan IP sumber ada di himpunan IP
  lease dnsmasq untuk MAC itu (atau IP yang tercatat saat boot bila lease tidak dikonfigurasi,
  hanya mode dev).
- Callback status (`/boot/{mac}/{token}/status`) diterima sampai job `done`/`failed`. IP yang
  diizinkan = IP lease ∪ IP management statis yang dikonfigurasi, karena callback `done` datang
  dari OS terpasang yang sudah memakai IP statis.
- Token dicabut saat `done`, `failed`, install ulang (job baru), host dihapus, atau expiry.
- Semua penolakan → `404` dengan body seragam (tanpa oracle). Alasan dicatat di log server tanpa
  token.
- Disebut "sekali pakai per instalasi". Ini satu-satunya varian "sekali pakai" yang kompatibel
  dengan installer. Kandidat decision.

---

## O3. Menentukan IP sumber request (syarat O2 dan discovery)

Next 16 App Router tidak mengekspos alamat socket ke route handler (`request.ip` sudah dihapus).

| | A. nginx reverse proxy di VM server (rekomendasi) | B. Custom server Node (`http.createServer` → Next) | C. Next langsung tanpa cek IP |
|---|---|---|---|
| IP sumber terpercaya | Ya: Next bind `127.0.0.1:3000`, nginx menimpa `X-Real-IP` dengan `$remote_addr` | Ya: inject header dari `socket.remoteAddress` | Tidak, melanggar SPEC §6 |
| Media besar (ISO mount, kernel/initrd, repo Debian/Rocky) | nginx `sendfile`, cepat dan tanpa beban Node | Node melayani GB data | Node |
| Masking token di access log | `log_format` khusus (path `/boot/*/*/` → `[redacted]`) | Kode sendiri | — |
| Perubahan DEC-003 | Dashboard di `http://10.99.0.2/` (port 80), bukan `:3000` | Tetap `:3000` | — |
| Kompleksitas | Satu paket apt + satu file config | Kode server custom (bertentangan dengan `output: standalone` bawaan) | — |

**Rekomendasi: A.** `PXE_TRUST_PROXY=1` wajib agar `X-Real-IP` dibaca. Tanpa itu, endpoint
konfigurasi menolak semua request (fail closed). Ini mengubah detail port di DEC-003
(`:3000` → `:80` lewat nginx), jadi kandidat decision.

---

## O4. Cara deploy dashboard ke VM `pxe-test-server`

| | A. Build di host (`output: "standalone"`) → tar → scp → systemd (rekomendasi) | B. Salin source, `npm ci && next build` di VM | C. Container (podman) di VM |
|---|---|---|---|
| Internet di VM | Tidak perlu untuk npm | Registry npm lewat `pxe-test-nat` | Registry image (di luar allowlist) |
| RAM/waktu di VM | Kecil (hanya `node server.js`) | `next build` butuh ±2–3 GB dan beberapa menit | Sedang |
| Reprodusibilitas | Artefak yang sama dengan yang dites di host | Bisa berbeda (lock + cache) | Baik |
| Syarat | Node VM = versi host (v22.22.2 dari nodejs.org, SHA256 diverifikasi). Tanpa native addon (cocok dengan O1-A) | — | Tooling tambahan |

**Rekomendasi: A.** `next.config.ts` mendapat `output: "standalone"` hanya bila
`PXE_STANDALONE=1`, supaya `next start` untuk E2E lokal M1–M3 tidak berubah. Artefak berisi
`.next/standalone` + `.next/static` + `public`. Unit `pxe-dashboard.service` berjalan sebagai user
`pxe` (non-root), `EnvironmentFile=/etc/pxe-dashboard.env`, DB di `/var/lib/pxe-dashboard/`.

---

## O5. Membawa media (ISO) ke VM server

Ukuran: Ubuntu ISO 4,1 GB, Debian DVD 4,0 GB, Rocky minimal 2,8 GB, Debian netboot 49 MB.

| | A. Pasang ISO sebagai CD-ROM read-only di VM server (rekomendasi) | B. `scp` ke disk VM | C. virtiofs/9p share `.agent/media` |
|---|---|---|---|
| Waktu & disk | Nol salinan | ±11 GB salinan per server baru, disk VM membesar | Nol salinan |
| Akses libvirt | qemu sudah punya ACL `--x` di home, file 0644, SELinux nonaktif | — | Butuh `memoryBacking shared` + virtiofsd, lebih banyak bagian bergerak |
| Di VM | `mount -o ro /dev/disk/by-label/...` lalu diekspor ke NFS dan HTTP | Loop mount | Mount share |
| Risiko | `dynamic_ownership` libvirt bisa chown sementara file ISO (dipulihkan saat VM mati) | Lambat | Kompleks |

**Rekomendasi: A.** Kernel/initrd Debian netboot (kecil) dan `snponly.efi`/`undionly.kpxe`
disalin lewat `scp`. ISO dipilih lewat label volume (bukan urutan `/dev/srN`).

---

## O6. Boot installer Ubuntu 24.04 dari iPXE (node 2 GB RAM)

| | A. Kernel+initrd via HTTP, root live via **NFS** (`netboot=nfs nfsroot=10.99.0.2:/srv/pxe/media/ubuntu-24.04`) | B. Kernel+initrd via HTTP + `url=<ISO>` | C. `fetch=` squashfs via HTTP |
|---|---|---|---|
| RAM node | Rendah, ISO dibaca lewat NFS (terbukti di lab dengan 4 GB) | **ISO 4,08 GB diunduh ke tmpfs, butuh > 10 GB RAM** (README §10). Mustahil di 2 GB | Live-server 24.04 memakai squashfs berlapis. `fetch=` hanya satu file, jadi tidak didukung andal |
| Bukti | Terbukti end-to-end di lab (GRUB). Di iPXE hanya cara memuat kernel yang berubah | Gagal di lab | Tidak ada |
| Efek samping | Butuh `nfs-kernel-server` di VM server. Shutdown macet di unmount `/cdrom` → wajib guard `pxe-force-reboot` (README §10, sudah ada di user-data lab) | — | — |

**Rekomendasi: A**, dipakai ulang persis dari lab: `ip=dhcp netboot=nfs nfsroot=... autoinstall
ds=nocloud-net;s=<url>/ cloud-config-url=/dev/null`, ditambah `initrd=initrd` karena iPXE 2022
di EFI belum menyediakan LoadFile2. NFS hanya diekspor ke `10.99.0.0/24`, read-only.
Risiko tersisa: subiquity di 2 GB RAM belum pernah diuji (lab memakai 4 GB). Lihat Risiko R1 di
plan. Kandidat decision cadangan: node Ubuntu 3 GB bila OOM terbukti di serial log.

---

## O7. Sumber sinyal "done" (callback minimum M4)

| | A. Unit systemd first-boot di OS terpasang (`pxe-callback-done.service`, sekali jalan lalu menghapus diri) (rekomendasi) | B. Callback di akhir `late-commands` installer | C. Server mem-probe port SSH IP statis |
|---|---|---|---|
| Makna "Done" | OS benar-benar boot dari disk dengan jaringan yang dikonfigurasi | Instalasi selesai, belum tentu bisa boot | Ada sesuatu di IP itu |
| Ketergantungan | `curl` di OS terpasang (Ubuntu dan Rocky ada, Debian dipasang dari DVD) | `curl` di live env | Tanpa kode di host |
| Keamanan | Token disimpan sementara di file 0600 root, dicabut server saat `done` | Sama | Tidak butuh token, tetapi bisa tertipu host lain |

**Rekomendasi: A untuk `done`; B untuk `configuring`** (awal `late-commands`/`%post`), yang
sekaligus menjadi titik switch boot ke lokal. `installing` diturunkan server saat file konfigurasi
utama diambil (tanpa callback). `failed` lewat `error-commands` (Ubuntu) dan `%onerror` (Rocky).
Debian tidak punya hook gagal yang setara, jadi ditangani timeout di M5.

---

## O8. Perilaku `/boot/{mac}.ipxe` untuk host tanpa job

| | A. Selalu boot lokal (`exit`/`sanboot`) (rekomendasi default) | B. Loop tunggu (`sleep 30` lalu chain ulang) untuk host `discovered` | C. Menu iPXE interaktif |
|---|---|---|---|
| Mesin baru yang punya OS di disk | Boot normal | **Tertahan selamanya di iPXE** | Menunggu operator |
| UX "pilih host lalu install" | Butuh power-cycle setelah klik Install (di KVM: `virsh reset` oleh harness) | Otomatis | Manual |

**Rekomendasi: A sebagai default.** B tersedia lewat `PXE_UNKNOWN_HOST_ACTION=wait` dengan batas
iterasi, hanya untuk host yang `os_installed` kosong. Test KVM M4 memakai default A + `virsh reset`
supaya jalur default yang teruji. Aksi "Reboot ke PXE" nyata (IPMI/Redfish) di luar M4.

---

## O9. Password akun di Windows `unattend.xml`

SPEC §6: password hanya disimpan sebagai hash SHA-512 crypt. Windows tidak bisa memakai hash
crypt. unattend hanya menerima plaintext atau base64 UTF-16 (setara plaintext).

| | A. unattend tanpa password dari konfigurasi: akun lokal dibuat dengan password acak yang dibuang saat render, login hanya lewat OpenSSH + `administrators_authorized_keys` (rekomendasi) | B. Simpan password Windows terenkripsi reversibel (kunci di env) | C. Taruh plaintext di unattend |
|---|---|---|---|
| Sesuai SPEC §6 | Ya | Melemahkan (password bisa dipulihkan) | Tidak |
| Kegunaan | Akses key-only, password diatur admin setelah login | Penuh | Penuh |

**Rekomendasi: A.** UI (OS Windows) menampilkan peringatan bahwa password Credentials tidak
diterapkan. Di M4, Windows hanya berupa generator + unit test: `POST install` untuk image Windows
ditolak 422.

---

## O10. Serialisasi dan escaping file installer

| | A. Bangun objek lalu serialisasi dengan library (`yaml` untuk user-data, writer XML kecil dengan escape penuh); preseed/kickstart lewat writer per-baris yang menolak CR/LF; payload shell (sudoers, authorized_keys, sshd drop-in, unit systemd) di-base64 (rekomendasi) | B. JSON sebagai YAML (`#cloud-config` + `JSON.stringify`) | C. Template string |
|---|---|---|---|
| Injeksi YAML/XML | Tertutup oleh serializer | Tertutup, tetapi YAML 1.1 PyYAML punya edge case | Rentan |
| Injeksi shell di late-commands/%post | Nilai pengguna tidak pernah muncul mentah di shell (base64 + `printf %s`) | Sama bila diterapkan | Rentan |
| Keterbacaan output | Baik | Kurang | Baik |

**Rekomendasi: A**, plus validasi ulang di dalam generator (hostname RFC 1123, username, hash
`$6$`, key lewat `parseSshKey` dengan komentar disanitasi ke `[A-Za-z0-9@._-]`). Generator
menolak (throw) daripada mencoba "membersihkan" nilai yang tidak valid. Dependensi baru:
`yaml` (eemeli, pure JS) dan `fast-xml-parser` (devDependency, untuk test well-formed).

---

## O11. Network NAT `pxe-test-nat` untuk VM server

DEC-003 menyebut DHCP libvirt aktif di `pxe-test-nat`. Batas keras CLAUDE.md melarang DHCP di
host. DHCP libvirt dijalankan oleh dnsmasq milik libvirt di host.

| | A. `pxe-test-nat` **tanpa `<dhcp>`**; VM server memakai IP statis `192.168.199.2/24`, gateway dan DNS `192.168.199.1` (DNS libvirt) (rekomendasi) | B. Ikuti DEC-003 apa adanya (DHCP libvirt) |
|---|---|---|
| Kepatuhan batas keras | Paling aman: tidak ada DHCP di host sama sekali | Sudah di-approve DEC-003, tetapi rawan disalahpahami gatekeeper |
| Kompleksitas | Netplan statis via cloud-init (sudah perlu untuk NIC pxe-test) | Sedikit lebih sederhana |

**Rekomendasi: A.** Network `pxe-test` juga diberi `<dns enable='no'/>` agar libvirt tidak
menjalankan dnsmasq apa pun di `virbr-pxe`. Firewall nftables di VM server menolak input baru di
NIC NAT. Kandidat decision (penyempurnaan DEC-003).

---

## O12. Cakupan matriks KVM di M4 vs M6

| Skenario | Usulan | Alasan |
|---|---|---|
| UEFI Ubuntu 24.04 (dashboard → Done → SSH + reboot lokal) | **M4** (wajib gate) | Bukti gate milestone ≥ 4 |
| BIOS Ubuntu 24.04 | **M4** | Rantai BIOS (ROM iPXE QEMU / `undionly.kpxe` + `sanboot`) adalah kode baru M4 dan belum pernah diuji di lab. Biaya tambahan ±15 menit, berurutan |
| Negatif: config per-MAC dari IP salah (host 10.99.0.1) ditolak | **M4** | Murah, dijalankan dalam run UEFI |
| UEFI Debian 12 (preseed) | M6 | Repo offline dari DVD (Release tanpa tanda tangan, ABI kernel netboot vs DVD harus cocok) butuh investigasi. Generator + boot script tetap diuji unit/integration di M4 |
| UEFI Rocky 9 (kickstart) | M6 | `install.img` anaconda dimuat ke RAM: 2 GB berisiko. Repo minimal ISO perlu diverifikasi |
| Bulk 3× UEFI Ubuntu | M6 | RAM hanya cukup server + 1–2 node. Butuh job/timeout M5 untuk eksekusi bertahap yang andal |
| `virsh destroy` di tengah install → Failed setelah timeout | M5 | Timeout watchdog adalah scope M5 (callback & jobs) |
| IP bentrok / CSV invalid | Sudah M3 (UI+API), diulang regresi M4 di E2E lokal | — |

**Rekomendasi:** tabel di atas, ditulis eksplisit di decision.

---

## Ringkasan rekomendasi (kandidat decision)

| # | Topik | Rekomendasi |
|---|---|---|
| O1 | Persistence | `node:sqlite`, SQL polos + migrasi, fallback `better-sqlite3` lewat decision |
| O2 | Token | Per job, 32 byte base64url, hash SHA-256, binding MAC + IP lease, jendela tahap, TTL 6 jam, 404 seragam |
| O3 | IP sumber | nginx reverse proxy di VM server, `X-Real-IP`, Next bind 127.0.0.1. Dashboard di `:80` (ubah detail DEC-003) |
| O4 | Deploy | Build standalone di host → scp → systemd user `pxe` |
| O5 | Media | ISO di-attach read-only sebagai CD-ROM di VM server |
| O6 | Boot Ubuntu | Kernel/initrd HTTP + root NFS (bukan `url=`). Cadangan RAM node 3 GB |
| O7 | Done | `installing` = fetch config, `configuring` = callback late-commands (switch ke boot lokal), `done` = unit first-boot |
| O8 | Host tanpa job | Boot lokal (default). Mode `wait` opsional. Harness KVM `virsh reset` |
| O9 | Windows password | Tidak dari config, key-only. Install Windows ditolak di M4 |
| O10 | Escaping | Serializer + base64 untuk payload shell + validasi ulang di generator |
| O11 | NAT | `pxe-test-nat` tanpa DHCP (IP statis). `pxe-test` dengan `dns enable=no` |
| O12 | Matriks KVM | M4: UEFI + BIOS Ubuntu + negatif IP. Debian/Rocky/bulk → M6. Destroy/timeout → M5 |
