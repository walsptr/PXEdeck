# Report Milestone 5
## Ringkasan
Milestone ini menambahkan siklus hidup job instalasi yang lengkap.
- **Penyajian installer:** installer dilayani hanya saat job berstatus Booting, maksimal 3 kali.
- **Mesin dimatikan atau di-reboot saat install:** mesin boot dari disk lokal, tidak menginstal ulang. Watchdog lalu menandai job Failed dengan alasan yang jelas, mis. "Timeout di tahap Installing", dan job bisa diinstal ulang.
- **Log installer:** dikirim ke dashboard lewat `POST /boot/{mac}/{token}/log`, dengan batas ukuran dan laju serta redaksi secret di server. Admin melihatnya live di halaman Provisioning Jobs lewat SSE.
- **Provisioning Jobs:** daftar, filter, timeline tahap, dan log live.
- **Halaman baru:** OS Images (registrasi dari path lokal) dan SSH Keys (tambah, ganti nama, hapus, jumlah pemakai).
- **Tabel host:** menampilkan alasan Failed.
- **Pengamanan sebelum ada login (M6):** UI dan `/api` hanya bisa diakses dari IP admin lewat allowlist nginx, sedangkan `/boot` dan `/media` tetap terbuka untuk klien PXE. Server menolak start bila trust-proxy aktif tanpa file lease (fail-closed).

Semua sudah terbukti di VM KVM sungguhan:
- Node UEFI di-destroy saat Installing → boot lokal → Failed → install ulang → Done → SSH dengan key yang di-inject.
- Node BIOS: log live, token palsu ditolak, `/api` diblokir dari node.
## Acceptance criteria
| Kriteria | Status | Bukti |
|---|---|---|
| AC-5.1 – AC-5.37 (lokal: unit/integration/E2E/infra) | Lulus | .agent/runs/m5/ac-trace.md |
| AC-5.38 – AC-5.43 (KVM) | Lulus | .agent/runs/m5/kvm/results.json, .agent/runs/m5/kvm-confirm/results.json |
## Perubahan utama
- **Backend:**
  - `dashboard/src/lib/server/{job-lifecycle,watchdog,startup,redact,sse,provisioning,settings}.ts`
  - `db/repos/{jobs,job-events}.ts` beserta migrasi 2 (`job_events`, `failure_reason`, `installer_boots`)
  - `app/boot/[name]/[token]/log`
  - `app/api/jobs/**`
  - `PATCH /api/ssh-keys/:id`
  - hook log di generator Ubuntu, Debian, Rocky, dan first-boot
- **Frontend:**
  - halaman Provisioning Jobs (timeline + log SSE dengan fallback JSON)
  - halaman OS Images dan SSH Keys
  - alasan Failed di tabel Hosts dan Sheet
  - perbaikan DR-4-1..7
- **Infra:**
  - `node.sh poweroff/start`
  - `assert-server-logs.sh` (asersi otomatis dnsmasq/nginx)
  - spec `NN:fw[:destroy]` di `kvm-run.sh`
  - allowlist admin + lokasi SSE di nginx
  - redaksi bukti hanya untuk file teks
## Iterasi & temuan
- Ada 3 iterasi review/gate, maksimum yang diizinkan.
- Masing-masing dari dua iterasi pertama gagal karena satu temuan desain major. Iterasi 1 gagal karena DR-5-1: kolom path OS Images tidak terbaca di ponsel. Iterasi 2 gagal karena DR-5-8: ID panjang menimpa kolom, regresi dari perbaikan DR-5-1.
- Bersamaan dengan itu, celah redaksi secret di log job dipersempit bertahap:
  - karakter kontrol;
  - private key multi-baris;
  - token terpotong;
  - sekuens ANSI;
  - `\r` dan karakter Unicode format;
  - regex kuadratik.
- Beberapa perbaikan memicu regresi kecil yang ditemukan reviewer di iterasi yang sama, lalu ditutup dengan test yang terbukti merah bila perbaikannya di-revert.
- Sisa celah yang diketahui butuh payload yang sengaja disusun oleh pemegang token, dan secret-nya memang sudah dipegang pemegang token itu. Celah ini dijadwalkan ke M6.
## Risiko & utang teknis
- **Login dan rate limit belum ada (SR-4-1).** Mitigasinya baru allowlist IP admin di nginx. Jangan dipasang di luar jaringan lab terisolasi sampai M6.
- **Flag `PXE_INSECURE_NO_LEASE_CHECK=1` masih diterima di production (SR-5-4).** Jangan aktifkan flag ini di server sungguhan. Penolakan di production wajib di M6.
- **Redaksi log job belum sempurna terhadap payload yang sengaja dirangkai** (CR-5-30, SR-5-19, SR-5-18, SR-5-20). Hanya admin yang bisa melihatnya.
- **Fitur SPEC yang ditunda (DEC-015):**
  - status Offline otomatis;
  - registrasi OS image dari URL jarak jauh.
- **KVM Debian 12, Rocky 9, dan bulk 3× UEFI belum diuji (CR-4-6).** Unattend Windows belum dilayani (CR-4-7).
## Blocker (jika ada)
Tidak ada.
## Housekeeping
- Network `pxe-test` dan `pxe-test-nat` masih aktif; keduanya dihapus di akhir semua milestone. Tidak ada VM `pxe-test-*` yang tersisa. VM `ubuntu24.04` tidak disentuh.
- Perlu dihapus oleh user (agent tidak diizinkan):
  - `.agent/wt-m5/dashboard/.e2e-data/design-m5-iter3b/`
  - `/tmp/pxe-e2e-*`
  - `/tmp/pxe-test-{persist,srvstat,tokdb}-*`
## Langkah berikutnya
M6 (hardening keamanan & E2E penuh). Plan oleh architect wajib memuat syarat gate M6 dan semua carry-over di `.agent/runs/m5/gate-iter3.md`.
