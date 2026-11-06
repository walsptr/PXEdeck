# Report akhir: PXE Boot Dashboard
## Ringkasan
Keenam milestone sudah APPROVED oleh gatekeeper dan di-merge ke `main` lokal, masing-masing dengan tag `m1-approved` … `m6-approved`. Proyek ini dikerjakan otonom oleh tim subagent: architect, frontend-dev, backend-dev, test-engineer, tiga reviewer, dan gatekeeper. Orchestrator menulis decision, approval dan report.

Produk akhirnya adalah dashboard Next.js 16 + shadcn/ui untuk provisioning mesin lewat PXE, dengan alur berikut:
1. Mesin PXE boot dan otomatis muncul di tabel Hosts.
2. Admin login.
3. Admin mengatur OS, credentials, network, hostname dan SSH key, per host atau bulk.
4. Admin klik Simpan & Install.
5. Server menyajikan iPXE dan konfigurasi installer per MAC dengan token sekali pakai.
6. Status job bergerak Booting → Installing → Configuring → Done, dengan log live.
7. Mesin reboot dari disk dan bisa diakses lewat SSH dengan key yang di-inject.

Alur ini terbukti di VM KVM sungguhan, di jaringan terisolasi `pxe-test`, untuk:
- Ubuntu 24.04 BIOS dan UEFI;
- Debian 12 UEFI (preseed);
- Rocky 9 UEFI (kickstart);
- bulk 3× UEFI Ubuntu.

## Milestone
| # | Milestone | Iterasi gate | Approval | Merge | Inti |
|---|---|---|---|---|---|
| 1 | Setup + tokens + layout | 3 | APR-001 | `m1-approved` | Design tokens SPEC (kanvas krem, oranye hanya CTA, tanpa shadow, Inter + JetBrains Mono), shell, tooling test |
| 2 | Tabel host (mock) | 3 | APR-002 | `m2-approved` | Tabel Hosts, polling, pencarian MAC/IP/hostname, filter, bulk bar |
| 3 | Sheet & bulk | 3 | APR-003 | `m3-approved` | Sheet konfigurasi 5 tab, bulk atomik, CSV credentials, IP range + deteksi bentrok |
| 4 | Backend + iPXE | 1 | APR-004 | `m4-approved` | SQLite, discovery dari lease, iPXE per-MAC, generator Ubuntu/Debian/Rocky/Windows, token, lab KVM |
| 5 | Callback status & jobs | 3 | APR-005 | `m5-approved` | Siklus hidup job + watchdog, log installer + redaksi, Provisioning Jobs (SSE), OS Images, SSH Keys |
| 6 | Hardening keamanan & E2E penuh | 2 | APR-006 | `m6-approved` | Login + sesi + rate limit, redaksi diperkuat, Debian/Rocky di KVM, matriks KVM penuh + uji negatif |

Laporan per milestone ada di `REPORT-m1.md` … `REPORT-m6.md`. Keputusan desain dicatat di DEC-001 … DEC-022.

## Kondisi akhir (`main` @ merge M6 `246aa83`)
- **Typecheck dan lint:** bersih.
- **Unit dan integration:** 1947/1947 lulus. Diverifikasi ulang di checkout `main` setelah merge.
- **Coverage:** kode baru M6 98.95% lines.
- **Test lain:** E2E Playwright 186/186 (dua run penuh), test proses 15/15, test infra 76/76.
- **axe:** 0 pelanggaran di luar filter kontras yang terdaftar (DEC-019).
- **KVM M6:** run `core`, `bulk` dan `distro` semuanya PASS. Cleanup bersih, dan resource libvirt milik user tidak tersentuh.
- **Secret:** tidak ada secret sungguhan di repo maupun bukti. `.env.example` hanya berisi nilai dummy.

## Deviasi SPEC
| Item SPEC | Status | Alasan / decision |
|---|---|---|
| Status host **Offline** otomatis | Tidak diimplementasikan. Pill Offline ada di design system, tapi tidak ada transisi otomatis | DEC-015 §2, DEC-018 §1. Host yang Done boot dari disk dan tidak lagi menghubungi dashboard, jadi heuristik last-seen akan menandai semua host sehat sebagai Offline. Butuh mekanisme deteksi keaktifan terpisah, misalnya ping atau agent |
| Registrasi OS image dari **URL jarak jauh** (unduh ISO) | Tidak diimplementasikan. Registrasi hanya dari path media lokal di server PXE | DEC-015 §3, DEC-018 §1. Butuh unduhan besar dan validasi integritas di luar cakupan lab |
| Instalasi **Windows** | Hanya generator unattend dan unit test. Install Windows ditolak 422 | CLAUDE.md §Matriks, DEC-010, DEC-017 §8 |
| Repo Debian **bertanda tangan** | Repo DVD Debian dipakai dengan `[trusted=yes by-hash=no]` hanya selama install, hanya untuk media lokal server PXE. Penanda ini dibersihkan sebelum firstboot, dan media eksternal ditolak 422 | DEC-021, DEC-022 §2. Sisa risikonya: integritas paket selama install bergantung pada checksum ISO (`media-checksums.txt`) dan pada jaringan lab yang terisolasi. Didokumentasikan di `infra/README.md` §Asumsi keamanan |
| Sesi idle | Polling UI memperpanjang idle, dengan batas absolut 12 jam | DEC-019 §1 |
| Kontras pill **Done** | Teks putih di atas `#c08532` menjadi satu-satunya pengecualian kontras | DEC-019 §2 |

## Batas pengujian yang perlu diketahui
- **AC-6.47a, bentrok dengan IP lease:** tidak bisa diisolasi di KVM. IP lease selalu berada di range DHCP dinamis, dan range itu sudah ditolak oleh aturan lain. Aturan lease-nya diuji di level unit/integration.
- **Bulk multi-gelombang:** `kvm-run.sh bulk --waves` hanya teruji dengan satu gelombang di KVM, karena RAM cukup untuk 3 node sekaligus. Pembagian gelombang untuk `max_nodes` 1/2/3 diuji di test infra (AC-6.41).
- **Windows:** tidak ada uji KVM, sesuai CLAUDE.md.

## Carry-over (temuan terbuka yang diterima)
Tidak ada temuan critical, major, atau minor keamanan yang terbuka. Daftar lengkap ada di `.agent/runs/m6/gate-iter2.md`.

| ID | Severity | Ringkasan | Saran tindak lanjut |
|---|---|---|---|
| CR-6-2 | minor | `FirstLogonCommands/CommandLine` unattend Windows bisa lebih dari 1024 karakter. Laten, karena Windows tidak dilayani | Pecah perintah penulisan key, lalu test `CommandLine.length <= 1024` |
| CR-6-5 | info | Varian `BootDeniedPath "ipxe"` tidak pernah dicatat | Hapus varian itu, atau log penolakan iPXE |
| CR-6-7 | info | Logout dengan sesi invalid tidak menghapus cookie | Sertakan `clearSessionCookieHeader()` pada 401 |
| CR-6-8 | info | `guardRead` dan `currentSession` sama-sama membaca DB (2 query per request) | Pakai ulang sesi dari guard |
| CR-6-11 / SR-6-14a | info | Pembersihan dan cek `trusted=yes` hanya untuk format `.list`, belum deb822 `*.sources` | Perluas ke `*.sources` sebelum mendukung rilis Debian berikutnya |
| CR-6-12 | info | `installBlocker` tidak mengecek ulang batas byte key untuk config lama | Cek `authorizedKeysBytes` di `installBlocker` |
| SR-6-5 | info | `..\` di path → redirect 308 (aman, berujung 401/403) | — |
| SR-6-7 … SR-6-12 | info | Catatan hardening tanpa jalur eksploit terbukti | Lihat `review-security-iter1.md` |
| SR-6-13 | info | Base64 ter-wrap tanpa padding bisa lolos redaksi utuh, dan komentar header menyebut cakupannya lebih sempit dari kenyataan | Evaluasi run beserta baris penutupnya, perbaiki komentar, tambah fixture |
| SR-6-14b | info | `isLocalMedia` menerima port lain di IP server PXE | Catat asumsi ini di README |
| CR-6-6 / SR-6-3 | — | Sudah diperbaiki: peringatan saat start. Tetap jalankan di belakang nginx dengan `PXE_TRUST_PROXY=1` | — |
| DR-6-9 | info | Hairline Card memakai ring box-shadow 1px | `border border-border` |
| DR-6-11 … DR-6-14 | info | Bukti screenshot lockout, penjelasan sesi berakhir di halaman login, judul terpotong di 768, fallback sidebar | Opsional |
| DR-6-15 | info | Hasil axe palsu di tab OS Sheet host Failed: teks tertutup footer sticky | Scroll node ke viewport sebelum menjalankan axe |
| DR-6-16 | info | Tabel Hosts masih perlu digeser 76 px di 1440 dengan hostname 63 karakter | Batasi sel ±16ch |
| DR-6-17 | info | Perubahan warna fokus input 2.78:1. Memenuhi target M6, belum WCAG AAA 2.4.13 | `ring-ring/60` atau border fokus 2px |

## Teardown lab
Lab KVM sudah dibongkar (AC-6.54 PASS, `.agent/runs/m6/teardown.txt`). Network `pxe-test` dan `pxe-test-nat`, VM server, disk dan key sekali pakai sudah dihapus. Resource milik user (`ubuntu24.04`, `default`, `int`) identik sebelum dan sesudah. Media ISO di `.agent/media/` dipertahankan. Untuk menjalankan lab lagi: `infra/net-up.sh` lalu `infra/server-up.sh`. Sisa: pool libvirt `vms` masih mendaftar volume yang sudah dihapus; bersihkan dengan `virsh pool-refresh vms` bila perlu.

## Asumsi operasional
- Hanya untuk LAN lab terisolasi. Trafik HTTP polos, cookie tanpa `Secure` kecuali base URL https.
- Jalankan di belakang nginx dengan `PXE_TRUST_PROXY=1`. Tanpa itu, semua klien berbagi kunci rate limit `login-ip:unknown`.
- Lihat `infra/README.md` §Asumsi keamanan.

## Blocker
Tidak ada.

## Addendum 2026-11-07: Milestone 7, PXE lewat VLAN
Atas permintaan user, M7 menambahkan dukungan dan pembuktian topologi production dengan VLAN PXE terpisah. Port node berupa trunk dengan VLAN PXE native dan VLAN management ber-tag. Status APPROVED (gate iterasi 2), dengan APR-007, tag `m7-approved` dan DEC-023 … DEC-028. Rincian ada di `REPORT-m7.md`.
- **Hasil KVM:** Ubuntu 24.04 UEFI/BIOS, Debian 12 dan Rocky 9 Done lewat VLAN, beserta uji negatif isolasi dan regresi flat.
- **Perbaikan produk:**
  - Validasi IP per VLAN (`PXE_VLAN_NETWORKS`).
  - Debian d-i tanpa router DHCP.
  - NIC native Rocky tanpa IPv4.
- **Perbaikan keamanan:** form login tidak lagi bisa mengirim kredensial di URL, dan log nginx tidak mencatat query string (DEC-027). Bug ini ada di `main` sejak M6.
- **Carry-over baru (prioritas):**
  - DR-7-2, aksesibilitas tab Credentials (axe critical, sejak M3).
  - Filter nftables untuk VLAN di server PXE (SR-7-2/SR-7-9).
  - Masking `error_log` nginx (SR-7-1).
- **Lab:** sudah dibongkar lagi (AC-7.32).
