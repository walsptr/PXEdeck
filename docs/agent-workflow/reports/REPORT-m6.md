# Report Milestone 6
## Ringkasan
Milestone terakhir ini menutup hardening keamanan dan membuktikan seluruh alur di VM KVM untuk semua distro yang didukung.
- **Login admin (DEC-017):** semua halaman UI dan `/api` wajib login.
  - Sesi disimpan di SQLite. Cookie `pxe_session` berisi token mentah, dan DB hanya menyimpan sha256-nya. Cookie diset `HttpOnly` dan `SameSite=Strict`.
  - Sesi berakhir karena idle atau setelah batas absolut 12 jam. Polling UI ikut memperpanjang idle (DEC-019 §1).
  - Password admin di-hash dengan scrypt dan dibaca dari env `PXE_ADMIN_USERNAME` dan `PXE_ADMIN_PASSWORD_HASH`.
  - Server menolak start di production bila admin belum dikonfigurasi, hash tidak valid, atau flag insecure dipakai tanpa frasa konfirmasi.
  - Server memberi peringatan saat start di production bila `PXE_TRUST_PROXY` tidak aktif.
- **Rate limit:**
  - Login: 5 kegagalan per (IP, username) dan 20 per IP, lalu 429 dengan sisa menit.
  - API: 600 request per menit per sesi.
  - SSE: maksimal 5 koneksi.
  - Log penolakan `/boot/*` dibatasi 20 baris per jendela, sisanya diringkas.
- **Redaksi log job diperkuat:** termasuk secret yang dirusak escape ganda, normalisasi encoding, base64 berlapis, dan base64 ter-wrap per 60/64/76 kolom. Waktu proses tetap linear.
- **Installer:**
  - Debian 12 memakai preseed dengan repo DVD lokal (DEC-021). `trusted=yes` hanya dipakai bila media berasal dari server PXE lokal dan dibersihkan sebelum firstboot. Media eksternal ditolak dengan 422.
  - Rocky 9 memakai kickstart dengan stage2 lewat NFS (DEC-020).
  - Total `authorized_keys` dibatasi 32 KiB per host. Generator menolak `late_command` di atas 100 000 byte.
  - Windows tetap hanya generator, dengan pembersihan unattend dikeraskan.
- **UI:**
  - Halaman login dan tombol Keluar, dengan penanganan 401 dan 429 di semua request.
  - Informasi penting (alasan Failed, error, label status) tidak memakai warna muted.
  - Status server bisa dibedakan tanpa warna.
  - Ring fokus input diperkuat, hostname panjang dipotong, IP/CIDR memakai font mono, plus perbaikan carry-over UI M5.
- **KVM:** matriks penuh CLAUDE.md lulus di VM sungguhan, termasuk semua uji negatif. Rinciannya ada di tabel berikut.

## Acceptance criteria
| Kriteria | Status | Bukti |
|---|---|---|
| AC-6.1 – AC-6.42 (lokal: unit/integration/proses/E2E/infra) dan AC-6.53 (README §Asumsi keamanan) | Lulus | .agent/runs/m6/ac-trace.md, .agent/runs/m6/final-iter2/ |
| AC-6.43 – AC-6.52 (KVM: perimeter, UEFI/BIOS Ubuntu, destroy → Failed → install ulang, uji negatif, Debian, Rocky, bulk 3×, brute-force, throttle log, scan bukti) | Lulus, commit `18913b5` | .agent/runs/m6/kvm/results.json, .agent/runs/m6/kvm/{core,bulk,distro}/ |
| Test tidak dilemahkan, migrasi tercatat (gate) | Lulus | .agent/runs/m6/final-iter2/skip-weakening.txt, .agent/runs/m6/test-migration.md |
| AC-6.54 (teardown network `pxe-test`) | Lulus | .agent/runs/m6/teardown.txt |

Durasi resmi KVM iterasi 2:
- **core:** UEFI node21 Done dalam 570 s; BIOS node22 install ulang Done dalam 389 s. Total run 2247 s.
- **bulk:** 3 node Done dalam 606–627 s.
- **distro:** Debian node23 608 s, Rocky node24 713 s.

`ac-trace.md` masih mencantumkan durasi iterasi 1. Angka yang resmi adalah angka di atas.

## Perubahan utama
- **Backend:**
  - `dashboard/src/lib/server/auth/**` (sesi, scrypt, rate limit, `login-service`, `request-ip`)
  - `src/proxy.ts` dan `SessionGate`
  - `app/api/auth/{login,logout,session}`
  - guard untuk setiap route `/api`
  - `settings.ts` (start guard, `trustProxyWarnings`)
  - `boot-http.ts` (throttle log penolakan)
  - `redact.ts` (`wrappedB64Ranges` dan normalisasi)
  - `config-service.ts` (batas byte key)
  - `install-service.ts` (`installBlocker` 422)
  - `installers/{debian,rocky,windows,context,firstboot,shell}.ts`
- **Frontend:**
  - halaman `/login`, tombol Keluar, `apiFetch` dengan penanganan 401/429
  - `server-status`, `ip-text`, input/select/textarea dengan fokus baru
  - jobs, hosts dan Sheet memakai `text-body` untuk informasi penting
- **Infra:**
  - suite `kvm-run.sh` `core`, `bulk --waves`, `distro`
  - stage2 Rocky lewat NFS, cache modul disk Debian
  - perbaikan BUG-M6-10
  - `infra/README.md` §Asumsi keamanan
- **Test:**
  - `e2e-kvm/m6-{core,bulk,distro}.spec.ts` dan `e2e-kvm/apt-trust.ts` (cek `/etc/apt` fail-closed)
  - `e2e/m6-ui*.spec.ts`
  - matriks auth, fixture log installer nyata
  - helper `waitForLocatorAnimations`

## Iterasi & temuan
- **Selama build dan test:**
  - BUG-M6-10: `kvm-run.sh` keluar setelah node pertama karena `$( ((…)) && …)` di bawah `set -e`.
  - BUG-M6-L4: screenshot E2E tertulis ke folder m4.
  - Asersi AC-6.51b vacuous karena pola log tidak cocok.
  - Cek password Rocky terlalu ketat.

  Semua diperbaiki dan diuji.
- **Iterasi 1: CHANGES_REQUESTED.** Satu temuan major, DR-6-1: alasan Failed dan pesan error memakai warna muted, melanggar DEC-017 §9. Gate juga mewajibkan R2–R8:
  - label timeline;
  - teks "media tidak tersedia";
  - DEC-021 dibuat fail-closed;
  - README;
  - test `m5-te-hooks` dikembalikan ke `toEqual` persis;
  - status server tanpa bergantung pada warna;
  - referensi bukti yang hilang.

  DEC-022 memutuskan cakupan iterasi 2.
- **Iterasi 2: APPROVED.** R1–R8 dan delapan minor lain selesai, masing-masing dengan test yang merah bila di-revert. Ketiga run KVM diulang di commit final.
  - E2E run 2 sempat gagal satu test (`m5-library` DR-5-5, selisih 1,27 px > 1 px). Akar masalahnya dibuktikan: pengukuran diambil saat animasi pembukaan Dialog masih berjalan, dan masalah ini bisa diulang secara pasti dengan CDP.
  - Test distabilkan dengan menunggu animasi selesai. Ambang dan jumlah asersi tidak berubah.
  - Run 3 dan run 4 masing-masing 186/186 lulus.

## Teardown (AC-6.54)
Status: **PASS** (commit `b09ac84`, `.agent/runs/m6/teardown.txt`).
- Network `pxe-test` dan `pxe-test-nat` sudah dihapus (`infra/net-down.sh`). `net-list --all` sekarang hanya berisi `default` dan `int`.
- `cleanup.sh --server --base`: base disk server PXE dihapus. Domain `pxe-test-server` sudah tidak ada, dan tidak ada VM `pxe-test-*` yang tersisa.
- `.agent/vms/` kosong. Ini termasuk cache `pxe-test-debian-disk-modules` yang ikut dihapus.
- `.agent/keys/` kosong. `.agent/media/` dipertahankan.
- Resource terlindungi identik sebelum dan sesudah, dicek lewat status dan sha256 XML: VM `ubuntu24.04`, network `default` dan `int`. VM `pxe-test-node01` tidak ada, baik sebelum maupun sesudah.
- Sisa: storage pool libvirt `vms`, yang menunjuk ke `.agent/vms`, masih mencantumkan volume yang filenya sudah dihapus. Namanya tidak berprefix `pxe-test-`, jadi tidak disentuh agent. User bisa menjalankan `virsh pool-refresh vms` bila ingin membersihkan daftarnya.

## Risiko & utang teknis
Dicatat lengkap di REPORT-final §Carry-over.
- **CR-6-2:** `CommandLine` Windows lebih dari 1024 karakter. Laten, karena Windows tidak dilayani.
- **Temuan info:** tidak ada yang berdampak terbukti.
- **Hostname 63 karakter:** tabel Hosts masih perlu digeser 76 px di lebar 1440 (DR-6-16).
- **AC-6.47a:** penolakan bentrok dengan IP lease tidak bisa diisolasi di KVM, karena IP lease selalu berada di range DHCP dinamis yang memang ditolak. Aturan lease-nya diuji di level unit/integration.
- **Bulk multi-gelombang:** jalur `--waves` dengan lebih dari satu gelombang tidak teruji di KVM, karena RAM cukup untuk 3 node dalam satu gelombang. Logika gelombangnya diuji di test infra.

## Blocker (jika ada)
Tidak ada.
