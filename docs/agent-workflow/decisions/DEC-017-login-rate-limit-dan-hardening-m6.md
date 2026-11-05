# DEC-017: Login admin, rate limit, dan hardening keamanan M6
- Tanggal: 2026-11-06T09:00:00Z
- Milestone: 6
- Status: Accepted
## Konteks
SPEC §6 mewajibkan login dan autentikasi untuk semua API. Gate M5 (`.agent/runs/m5/gate-iter3.md`)
menetapkan tiga syarat gate M6: SR-4-1 (login + rate limit), SR-5-3 (banjir log penolakan `/boot`),
SR-5-4 / DEC-016 §2 (flag insecure di production). Opsi lengkap: `docs/design/M6-options.md` O1–O8, O10, O14.
## Keputusan
1. **Login & sesi (O1, rekomendasi A).** Implementasi sendiri tanpa dependensi baru: sesi server-side
   di SQLite (migrasi 3, tabel `sessions`, hanya menambah), cookie opaque `pxe_session` 32 byte acak,
   DB hanya menyimpan SHA-256-nya. Cookie `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` bila
   `PXE_BASE_URL` https. Idle 120 menit (geser, tulis ≤ 1×/60 dtk), absolut 12 jam, keduanya env
   tervalidasi. Sesi terikat sidik kredensial (ganti hash → semua sesi batal). ID sesi baru tiap login;
   pesan gagal seragam; verifikasi waktu konstan termasuk untuk username tak dikenal. Ini menambah model
   data SPEC §5 (tabel `sessions`) — amandemen yang disetujui.
2. **Hash password (O2, A).** scrypt `node:crypto` berformat ber-parameter `scrypt$N$r$p$salt$hash`,
   parameter dibatasi (N 2^14–2^20), `maxmem` eksplisit, `timingSafeEqual`.
3. **Bootstrap admin (O3, B).** Sumber kebenaran env `PXE_ADMIN_USERNAME` + `PXE_ADMIN_PASSWORD_HASH`;
   helper `npm run admin:hash` membaca password dari stdin (12–256 karakter) dan hanya mencetak hash.
   Tidak ada kredensial default di mode apa pun. `NODE_ENV=production` tanpa admin valid → **tolak
   start**. Hash tidak pernah muncul di log atau `/api/settings`. Satu admin; multi-admin di luar cakupan.
   E2E dan KVM membuat password acak per run (E2E di `.e2e-data/`, KVM di `.agent/keys/` 0600) — tidak
   pernah di-commit atau ditulis ke log.
4. **Penegakan (O4, C).** `src/proxy.ts` untuk redirect halaman ke `/login?next=` (anti open redirect),
   `requireSession` di setiap handler API lewat `guardRead`/`guardMutation`, cek sesi di layout server,
   ditambah test statis yang mengenumerasi semua `app/api/**/route.ts`. Pengecualian hanya
   `POST /api/auth/login` dan `GET /api/auth/session` (401 tanpa sesi). `/boot/**` tetap otorisasi token
   per-MAC (DEC-008/013). SSE divalidasi ulang tiap 30 dtk.
5. **Rate limit (O5, C).** Sumber kebenaran di aplikasi: login per (IP, username) default 5 gagal / 15
   menit dan per IP 20 gagal / jendela → 429 + `Retry-After` tanpa membedakan username; API 600/menit
   per sesi; SSE maks 5 koneksi per sesi (menutup SR-5-7). nginx `limit_req` sebagai lapis kedua untuk
   `/api/auth/login` dan `/boot/`; nilai `/boot/` final harus terbukti tidak memutus run bulk KVM.
6. **SR-5-3 (O6, A).** Throttle log penolakan `/boot/**` di aplikasi: maks 20 baris/menit per jalur,
   lalu satu baris ringkasan berisi jumlah saja (tanpa MAC/IP dari input).
7. **SR-5-4 (O7, B).** `NODE_ENV=production` + `PXE_INSECURE_NO_LEASE_CHECK=1` → tolak start kecuali
   `PXE_INSECURE_NO_LEASE_CHECK_CONFIRM` berisi frasa literal yang tepat (pola `PXE_SEED=demo`,
   sesuai DEC-016 §2). Dengan konfirmasi: peringatan tiap start + banner Settings. Wajib test level
   proses (exit ≠ 0 dan pesan `[pxe] start ditolak: …`).
8. **Windows (O8, A).** Unattend tetap tidak dilayani; install Windows tetap 422. Generator dikeraskan:
   tanpa URL `/boot/` atau token dalam bentuk apa pun, hapus file unattend Panther/Sysprep, matikan
   AutoLogon, acak ulang password sementara, logoff. Kontrol positif lama diganti kontrol sintetis dan
   dicatat di `test-migration.md` sebagai pengetatan.
9. **WCAG (O10, A).** Target WCAG 2.2 AA dengan pengecualian 1.4.3 hanya untuk pasangan token SPEC
   yang terdaftar (`muted`/putih, `muted`/kanvas, `muted-soft` placeholder, teks di atas `primary`).
   Token SPEC tidak diubah. Audit axe otomatis di E2E (`@axe-core/playwright`, registry npm).
   Informasi penting (error, alasan Failed, label status) tidak boleh memakai `muted`.
10. **Redaksi (O14, A).** Perluas pendekatan peta-indeks dengan normalisasi encoding sesuai O14. Setiap
    perbaikan wajib test yang merah bila di-revert (mutasi tercatat); probe reviewer M5 jadi fixture
    regresi; fixture log installer nyata dari run KVM M6 disimpan setelah redaksi dan hanya memuat
    secret sintetis. Batas performa linear SR-5-11 (≤ 20/50 ms) tetap.
## Konsekuensi
- Semua E2E lama perlu sesi (lihat DEC-018 §3). Deploy KVM menyisipkan hash admin per run.
- Allowlist IP nginx DEC-015 §1 tetap dipertahankan sebagai lapis pertahanan tambahan.
- Sisa risiko: lab HTTP tidak bisa memakai cookie `Secure` (dicatat di README "Asumsi keamanan").
