# M6 — Opsi teknis (hardening keamanan & E2E penuh)

Dokumen ini memuat pilihan teknis yang berarti untuk M6. Setiap bagian berisi 2–3 opsi, trade-off,
dan rekomendasi. Keputusan final ditulis Orchestrator sebagai `DEC-017` dan seterusnya.

Rujukan: SPEC §1 (design system), §4 (OS Images "registrasi ISO/URL"), §5, §6 (login minimal satu
admin, semua API butuh autentikasi, validasi server); CLAUDE.md §Gate, §Batas keras, §Pengujian KVM;
DEC-003/009 (topologi, `pxe-test-nat` hanya untuk VM server), DEC-004 (coverage), DEC-005 (tanpa seam
test di produk), DEC-007 (SQLite, env = sumber kebenaran settings), DEC-008/013 (token per-MAC +
binding IP), DEC-010 (Windows generator saja; Debian/Rocky/bulk di M6), DEC-015 (allowlist nginx,
Offline & URL ditunda), DEC-016 (§2 SR-5-4 wajib M6); `.agent/wt-m5/.agent/runs/m5/gate-iter3.md`
§Kewajiban carry-over ke M6.

Fakta kode/infra yang membentuk pilihan (`main` @ `m5-approved`):
- Belum ada `src/proxy.ts`. Setiap route API memanggil `guardRead` (GET, allowlist Host) atau
  `guardMutation` (Host + Origin + `Sec-Fetch-Site` + Content-Type) di `lib/server/http.ts`.
- Next 16.4: Middleware diganti **Proxy** (`src/proxy.ts`, runtime Node.js default). Dokumentasi
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` menegaskan Proxy
  tidak boleh menjadi satu-satunya lapisan otorisasi (matcher bisa diam-diam tidak mencakup route).
- Dependensi tidak memuat library auth/hash password selain `unixcrypt` (SHA-512 crypt untuk file
  installer). `node:crypto` (scrypt, `timingSafeEqual`, `randomBytes`) tersedia tanpa dependensi baru.
- Satu proses Next standalone di belakang nginx (`10.99.0.2:80`), lab memakai **HTTP polos** (SR-4-8).
- Media sudah ada di `.agent/media/`: `debian-12.15.0-amd64-DVD-1.iso`, Debian netboot,
  `Rocky-9-latest-x86_64-minimal.iso`, Ubuntu 24.04.5 live-server; `server-up.sh` sudah memasang
  ketiganya sebagai CD-ROM read-only VM server dan menyajikannya lewat nginx `/media/`.
- `installers/windows.ts` masih menyisipkan URL callback ber-token di `FirstLogonCommands`
  (`-EncodedCommand`); `INSTALLER_FILES.unattend = {}` dan image `unattend` tidak bisa `bootable`.
- `kvm-run.sh` menghitung `max_nodes = clamp((MemAvailable − RAM server − 4096)/2048, 1, 3)` dan
  **gagal** bila jumlah node > `max_nodes` (tidak ada mode bertahap).

Ringkasan rekomendasi ada di akhir dokumen.

---

## O1. Mekanisme login & sesi

SPEC §6: "Dashboard dilindungi login (minimal satu admin); semua API butuh autentikasi."

| | A. Implementasi sendiri: sesi server-side di SQLite + cookie opaque (rekomendasi) | B. Auth.js / NextAuth (Credentials provider) | C. HTTP Basic Auth di nginx |
|---|---|---|---|
| Kesesuaian SPEC | Ya (login page, semua API) | Ya | Sebagian: hanya deploy dengan nginx; dev/E2E/deploy lain tanpa proteksi; tidak ada halaman login sesuai design system, tidak bisa logout |
| Revokasi (logout, ganti password) | Langsung: hapus baris sesi | Mode JWT tidak bisa dicabut tanpa denylist; mode DB butuh adapter | Tidak ada |
| Dependensi / kompatibilitas Next 16.4 | Tidak ada dependensi baru (`node:crypto`, `node:sqlite`) | Dependensi besar; kompatibilitas Next 16 (Proxy, `cookies()` async) harus diverifikasi; konfigurasi secret penandatangan (`AUTH_SECRET`) = secret baru yang harus dikelola | Tidak ada |
| Secret tambahan | Tidak ada (ID sesi acak, disimpan sebagai SHA-256) | `AUTH_SECRET` | File htpasswd |
| Testability (DEC-004/005) | Fungsi murni + integration route handler | Sedang | Hanya KVM |

**Rekomendasi: A.** Rincian:
- ID sesi 32 byte `randomBytes` → base64url di cookie `pxe_session`; DB menyimpan `sha256(id)` saja.
- Atribut cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` bila `PXE_BASE_URL` berskema
  `https` (lab HTTP tidak bisa memakai `Secure`/prefiks `__Host-` karena browser menolak cookie
  `Secure` di origin HTTP non-localhost — dicatat sebagai sisa risiko SR-4-8).
- Masa berlaku: idle `PXE_SESSION_IDLE_MIN` (default 120, 1–1440) dengan perpanjangan geser yang
  ditulis paling sering sekali per 60 dtk (mengurangi tulis SQLite akibat polling 5 dtk); absolut
  `PXE_SESSION_MAX_HOURS` (default 12, 1–168).
- Sesi mengikat sidik kredensial (`sha256(password_hash)` dipotong) → mengganti hash password admin
  membatalkan semua sesi lama.
- Login: `POST /api/auth/login` (melalui `guardMutation`: Host + Origin + JSON → juga menutup login
  CSRF), verifikasi waktu konstan (username tak dikenal tetap menjalankan scrypt atas hash dummy),
  pesan seragam "Username atau password salah". ID sesi baru setiap login (anti session fixation).
  Logout: `POST /api/auth/logout` menghapus baris + `Max-Age=0`. `GET /api/auth/session`.
- Migrasi 3 (hanya menambah): `sessions(id_hash PK, username, cred_fp, created_at, last_seen_at,
  expires_at, ip)`; sesi kedaluwarsa dihapus oleh sweep watchdog yang sudah ada.

Kandidat decision (menambah model data SPEC §5 dan env baru).

---

## O2. Penyimpanan hash password admin

| | A. scrypt `node:crypto` (N=2^15, r=8, p=1, salt 16 B, keylen 64) dalam format string ber-parameter `scrypt$15$8$1$<salt-b64>$<hash-b64>` (rekomendasi) | B. Argon2id (paket `argon2`/`@node-rs/argon2`) | C. SHA-512 crypt (`unixcrypt`, sudah dipakai untuk installer) |
|---|---|---|---|
| Kekuatan terhadap brute force offline | Memory-hard, standar OWASP masih menerima | Terbaik (rekomendasi OWASP utama) | Lemah (CPU-only, GPU-friendly) |
| Dependensi | Tidak ada | Modul native / WASM → build standalone + VM server harus kompatibel; risiko di `next build` standalone | Sudah ada |
| Parameter bisa dinaikkan tanpa migrasi | Ya (parameter di string) | Ya | Ya (rounds) |
| Waktu verifikasi | ~50–100 ms (memori 32 MB) | Sebanding | Kecil |

**Rekomendasi: A.** `maxmem` diset eksplisit; verifikasi dengan `timingSafeEqual`; parser menolak
parameter di luar batas (N 2^14–2^20) agar hash yang dipasok operator tidak bisa memicu DoS memori.
C ditolak karena hash admin dashboard bernilai tinggi (mengendalikan reinstall semua host).

---

## O3. Bootstrap admin pertama tanpa secret di repo

| | A. CLI `pxe-admin create` membaca password dari stdin, menulis ke tabel `admins` di DB | B. Env sebagai sumber kebenaran: `PXE_ADMIN_USERNAME` + `PXE_ADMIN_PASSWORD_HASH` (hash scrypt, bukan password) + helper `npm run admin:hash` yang membaca password dari stdin (rekomendasi) | C. Halaman setup saat belum ada admin, dilindungi kode sekali pakai yang dicetak ke journal saat start |
|---|---|---|---|
| Secret di repo | Tidak | Tidak (`.env.example` mengosongkan kedua variabel; `infra/server/dashboard.env` memakai placeholder yang diganti saat deploy) | Tidak |
| Konsisten dengan DEC-007 (env = sumber kebenaran settings) | Tidak (state admin di DB) | Ya | Tidak |
| Build standalone | CLI harus ikut dirilis dan berbagi kode migrasi/hash dengan bundle Next (bundle tidak bisa di-import dari luar) → duplikasi atau langkah build baru | Helper hanya fungsi hash murni (tanpa DB), mudah dibuktikan setara dengan verifikasi app lewat test paritas | Tidak ada CLI |
| Risiko pengambilalihan | Rendah | Rendah | Jendela race di LAN sebelum operator sempat setup; kode di journal |
| Lupa password / rotasi | CLI `reset` | Ganti env + restart (sesi lama batal karena sidik kredensial) | Hapus DB/flag |
| E2E & KVM | Harus menjalankan CLI per DB/server | E2E: config Playwright membuat password acak per run + hash → env tiap webServer; KVM: harness membuat password acak per run di `.agent/keys/` (0600), hash dihitung di host, disisipkan ke `/etc/pxe-dashboard.env` (root:pxe 0640) saat deploy | Harus mengotomasi alur setup |

**Rekomendasi: B.** Aturan:
- `NODE_ENV=production` tanpa kedua variabel atau dengan hash tidak valid → **server menolak start**
  (fail-closed, pola yang sama dengan `PXE_SEED=demo`). Non-production tanpa variabel → start dengan
  peringatan; login tidak mungkin; semua API 401 (tidak ada kredensial default dalam mode apa pun).
- Password tidak pernah lewat argv, env, atau log; helper hash membaca stdin (TTY tanpa echo) dan
  hanya mencetak hash. Panjang password 12–256 karakter (validasi di helper; app hanya memverifikasi).
- Hash tidak pernah dicetak ke log/`/api/settings`; `GET /api/settings` hanya menampilkan
  `adminUsername` dan `adminConfigured: true`.
- Satu admin memenuhi SPEC ("minimal satu admin"). Multi-admin/manajemen user lewat UI: di luar
  cakupan M6 (kandidat pekerjaan lanjutan).

---

## O4. Titik penegakan autentikasi

| | A. Hanya `src/proxy.ts` | B. Hanya di handler (`guardRead`/`guardMutation` + page layout server) | C. Keduanya: Proxy untuk redirect halaman (UX) + pemeriksaan sesi wajib di setiap handler API dan di layout server `(dashboard)` (rekomendasi) |
|---|---|---|---|
| Rekomendasi docs Next 16 | Tidak cukup ("verify inside each…") | Ya | Ya |
| Risiko route baru tanpa proteksi | Matcher salah → bolong diam-diam | Handler lupa memanggil guard | Dua lapis; ditambah test statis yang mengenumerasi semua `app/api/**/route.ts` |
| UX redirect ke `/login?next=` | Ya | Perlu di layout | Ya |

**Rekomendasi: C.** `guardRead`/`guardMutation` memanggil `requireSession` (401 JSON seragam
`{"error":"Perlu login"}`) setelah cek Host; pengecualian eksplisit hanya `POST /api/auth/login`
(dan `GET /api/auth/session` mengembalikan 401 bila tidak ada sesi). `/boot/**` tetap tanpa sesi
(otorisasi token per-MAC, DEC-008/013) dan dikecualikan dari matcher Proxy, begitu pula
`/_next/static`, font, `/login`. Parameter `next` hanya menerima path relatif yang diawali `/` tunggal
(bukan `//`, bukan `/\`, bukan skema) → anti open redirect. SSE `GET /api/jobs/:id/logs` memeriksa
sesi saat koneksi dibuka dan memvalidasi ulang tiap 30 dtk (logout/kedaluwarsa menutup stream).

---

## O5. Rate limit (SR-4-1)

| | A. Di aplikasi (in-memory, satu proses) | B. nginx `limit_req` saja | C. A sebagai sumber kebenaran + B sebagai lapis kedua di deploy nginx (rekomendasi) |
|---|---|---|---|
| Membedakan login gagal vs sukses / per-username | Ya | Tidak (hanya laju request per IP) | Ya |
| Berlaku di dev/E2E/deploy tanpa nginx | Ya | Tidak | Ya |
| Teruji integration/E2E | Ya (jam injeksi) | Hanya KVM / static | Keduanya |
| Status setelah restart | Hilang (dapat diterima: restart butuh akses root) | Hilang | — |
| Risiko memutus PXE | Tidak menyentuh `/boot/**` | Bila `limit_req` di `/boot/` terlalu ketat, instalasi bulk gagal | Sama dengan B → dibuktikan oleh run bulk KVM |

**Rekomendasi: C.** Nilai usulan (env, divalidasi):
- Login: `PXE_LOGIN_MAX_FAILURES` (default 5, 3–100) kegagalan per (IP, username) dalam
  `PXE_LOGIN_WINDOW_MIN` (default 15, 1–1440) → 429 + `Retry-After`; tambahan batas per IP 20
  kegagalan per jendela (semua username) agar enumerasi username juga tertahan. Login sukses
  menghapus hitungan (IP, username). Respons 429 tidak membedakan username ada/tidak.
- API ber-sesi: `PXE_API_RATE_PER_MIN` (default 600 per sesi, 60–10000) → 429; SSE dihitung saat
  connect. Batas SSE per sesi 5 koneksi (+ batas global 50 yang sudah ada) menutup SR-5-7.
- nginx: `limit_req_zone $binary_remote_addr zone=pxe_login:1m rate=10r/m` untuk
  `location = /api/auth/login` (burst 5, `limit_req_status 429`); `zone=pxe_boot rate=20r/s` untuk
  `/boot/` (burst 100 nodelay) — longgar terhadap installer (log POST ≤ 60/menit/job, beberapa file
  konfigurasi), ketat terhadap banjir. Nilai final divalidasi oleh run bulk KVM.

---

## O6. SR-5-3: banjir log penolakan `/boot/**`

| | A. Throttle log di aplikasi: token bucket global per jalur (`ipxe`/`file`/`status`/`log`), maks 20 baris/menit, lalu satu baris ringkasan "N penolakan ditekan dalam 60 dtk" (rekomendasi) | B. nginx `limit_req` saja | C. Hapus log penolakan |
|---|---|---|---|
| Melindungi journal di semua deploy | Ya | Hanya deploy nginx | Ya, tetapi jejak audit hilang |
| Jejak audit | Tetap (sampel + jumlah) | Tetap, tetapi tanpa batas di bawah laju nginx | Hilang |
| Teruji | Unit dengan fake timers + integration | KVM | — |

**Rekomendasi: A + `limit_req` `/boot/` dari O5.** Baris tetap satu-per-penolakan (format SR-4-4,
ter-escape, tanpa token); ringkasan memuat jumlah per jalur saja (tanpa MAC/IP dari input).

---

## O7. Flag `PXE_INSECURE_NO_LEASE_CHECK=1` di production (SR-5-4, DEC-016 §2)

| | A. Selalu ditolak saat `NODE_ENV=production` | B. Ditolak kecuali variabel konfirmasi kedua berisi frasa literal, mis. `PXE_INSECURE_NO_LEASE_CHECK_CONFIRM=I_UNDERSTAND_CONFIG_LEAKS` (rekomendasi, sesuai DEC-016 §2) | C. Konfirmasi lewat argumen CLI start |
|---|---|---|---|
| Sesuai DEC-016 §2 ("kecuali ada konfirmasi kedua yang eksplisit") | Lebih ketat dari DEC | Ya | Ya, tetapi unit systemd/`next start` tidak punya jalur argumen yang bersih |
| Salah konfigurasi tak sengaja | Tidak mungkin | Sangat kecil (frasa harus tepat, nilai lain = ditolak dengan pesan yang menyebut kedua variabel) | Kecil |
| Testability | Unit + proses | Unit + proses | Proses saja |

**Rekomendasi: B.** Dengan konfirmasi: start diizinkan, peringatan di log setiap start + banner di
Settings (sudah ada) memuat "konfirmasi production aktif". Nilai konfirmasi selain frasa tepat →
ditolak. Ditambah **test level proses** (SR-5-10): build produksi dijalankan dengan env buruk → exit
≠ 0 dalam ≤ 15 dtk dan baris `[pxe] start ditolak: …` di stderr. Bila Orchestrator memilih A, AC yang
terkait cukup menghapus kasus "dengan konfirmasi → start".

---

## O8. Windows `unattend.xml` (CR-4-7 / SR-4-3)

CLAUDE.md: "Windows: generator + unit test saja". DEC-010: install Windows lewat dashboard ditolak
422. Media Windows tidak dapat diunduh dalam batas keras (domain Microsoft tidak di allowlist curl).

| | A. Tetap tidak dilayani; generator dikeraskan agar aman bila kelak dilayani (rekomendasi) | B. Layani `unattend.xml` lewat `/boot/{mac}/{token}/unattend.xml` + wimboot | C. Biarkan generator apa adanya |
|---|---|---|---|
| Dapat dibuktikan di lingkungan uji | Ya (unit) | Tidak (tanpa media/KVM Windows) | — |
| Menutup SR-4-3 (a) token di disk target, (b) AutoLogon/sesi admin tertinggal | Ya | Butuh A dulu | Tidak (tetap "naik ke major bila dilayani") |
| Status Done Windows | Tidak berlaku (tidak dilayani) | Butuh callback | — |

**Rekomendasi: A.** Isi pengerasan:
1. unattend **tidak memuat URL `/boot/` maupun token dalam bentuk apa pun** (teks, base64, UTF-16LE);
   callback Windows dihapus dari generator (status Windows tidak didukung sampai ada desain penurunan
   URL saat runtime, mis. dari WinPE) — menutup CR-4-7 / SR-4-3(a).
2. `FirstLogonCommands` terakhir: hapus `C:\Windows\Panther\unattend*.xml` dan
   `C:\Windows\System32\Sysprep\unattend.xml`, nonaktifkan AutoLogon (hapus nilai `DefaultPassword`
   / `AutoAdminLogon=0`), acak ulang password akun `pxeadmin` sementara setelah OpenSSH + key
   terpasang, lalu `logoff` — menutup SR-4-3(b).
3. `INSTALLER_FILES.unattend` tetap kosong, image `unattend` tetap tidak bisa `bootable`, install
   Windows tetap 422 (regresi diuji).
Kontrol positif lama di `installers.test.ts` ("Windows masih menyisipkan URL ber-token") berbalik
makna; harus diganti kontrol positif sintetis untuk pemindai (`containsSecret` atas string uji yang
sengaja memuat token) dan dicatat di `test-migration.md` sebagai pengetatan, bukan pelemahan.

---

## O9. Fitur yang ditunda DEC-015: status Offline otomatis & registrasi OS image dari URL

| | A. Keduanya tetap di luar cakupan M6; dicatat sebagai deviasi SPEC di `REPORT-final.md` (rekomendasi) | B. Kerjakan keduanya di M6 | C. Hanya "registrasi URL" sebagai metadata: sumber image boleh berupa URL HTTP(S) di LAN provisioning (tanpa mengunduh), Offline tetap ditunda |
|---|---|---|---|
| Offline | Alasan DEC-015 §2 tetap berlaku (host Done boot dari disk tidak menghubungi dashboard; heuristik last-seen salah). Liveness butuh probe aktif (TCP 22) = fitur baru + akses jaringan ke semua host | Probe aktif: proses latar, akses jaringan, ICMP butuh capability | — |
| URL | Unduh ISO besar + verifikasi integritas + rantai pasok HTTP (SR-4-8); tidak teruji di `pxe-test` terisolasi | Sama, plus tidak dapat dibuktikan di KVM | Ubuntu tetap butuh NFS (DEC-009) → URL hanya untuk Debian/Rocky; `installerScript` + generator berubah di milestone terakhir (risiko regresi jalur boot yang sudah lolos KVM) |
| Fokus M6 (hardening + E2E) | Terjaga | Melebar | Melebar sedikit |

**Rekomendasi: A**, dengan catatan eksplisit di `REPORT-final.md` §"Deviasi SPEC": (1) pill Offline
ada di design system tetapi tidak ada transisi otomatis; (2) OS Images hanya registrasi path media
lokal. Bila Orchestrator ingin menutup sebagian SPEC §4, C adalah opsi teraman (dibatasi ke URL
`PXE_MEDIA_URL`-relatif di LAN, tanpa unduhan), tetapi butuh AC KVM tambahan untuk Debian/Rocky.

---

## O10. Target WCAG AA (I-5-6)

Fakta: token SPEC `muted` #807d72 = 4,12:1 di atas putih dan 3,84:1 di atas kanvas; `muted-soft`
(placeholder) 2,74:1; putih di atas `primary` #f54e00 = 3,52:1 (teks tombol 14 px/500, bukan "large
text"). SPEC §1 mewajibkan token ini dan tidak menyebut WCAG.

| | A. Tidak mengubah token SPEC; target = WCAG 2.2 AA untuk semua kriteria **kecuali** 1.4.3 pada kombinasi token SPEC yang terdaftar (pengecualian tertulis); semua kombinasi di luar daftar wajib ≥ 4,5:1; audit axe otomatis (rekomendasi) | B. Amandemen SPEC: gelapkan `muted` (mis. #6b685f), `muted-soft`, dan teks/primary agar AA penuh | C. Tanpa target aksesibilitas |
|---|---|---|---|
| Kesesuaian SPEC | Penuh (token tidak berubah) | Mengubah sumber kebenaran design system; oranye aksen berubah → identitas visual berubah | Penuh |
| Aksesibilitas | Baik kecuali kontras teks sekunder/CTA | AA penuh | Tidak terjamin |
| Biaya M6 | Kecil: `@axe-core/playwright` (registry npm) di E2E, label/role/fokus/keyboard | Sedang + regresi visual di semua halaman + update test warna M1–M5 | Nol |

**Rekomendasi: A.** Pengecualian 1.4.3 hanya untuk pasangan: `muted`/putih, `muted`/kanvas,
`muted-soft` placeholder, `on-primary`/`primary` pada tombol primary. Elemen yang memuat informasi
penting (pesan error, alasan Failed, label status) tidak boleh memakai `muted` (sudah aturan DR-4-5/6).
B hanya lewat amandemen SPEC oleh Orchestrator/user.

---

## O11. Media & jaringan untuk KVM Debian 12 dan Rocky 9

| | A. Offline penuh dari media lokal yang sudah ada (DVD-1 Debian sebagai mirror `http://10.99.0.2/media/debian`, Rocky minimal ISO sebagai `inst.repo`), node tetap di `pxe-test` terisolasi (rekomendasi) | B. Beri node akses NAT (`pxe-test-nat`) ke mirror resmi | C. A + repo tambahan kecil: paket yang terbukti tidak ada di media diunduh oleh host dari mirror resmi Debian/Rocky ke `.agent/media/extra-*` (diverifikasi checksum/GPG metadata), disajikan nginx sebagai repo lokal |
|---|---|---|---|
| Batas keras / DEC-003 | Patuh | Melanggar isolasi node (`pxe-test` tanpa `<forward>`); butuh decision baru dan mengubah DEC-003 | Patuh (curl ke mirror resmi diizinkan; node tetap terisolasi) |
| Kecukupan paket | Debian DVD-1: `openssh-server`, `sudo`, `curl` tersedia; Rocky minimal: `@core`, `openssh-server`, `sudo`, `curl-minimal` tersedia. Perlu diverifikasi oleh smoke | Lengkap | Lengkap untuk paket yang dibutuhkan |
| Determinisme | Tinggi (media terkunci checksum) | Rendah (mirror berubah) | Tinggi |

**Rekomendasi: A, dengan C sebagai jalan cadangan yang sudah disetujui sebelumnya** bila smoke
membuktikan paket kurang (bukti: log installer). B ditolak. Catatan teknis yang wajib diverifikasi
smoke: kernel/initrd netboot Debian harus seversi dengan DVD (12.15) agar modul kernel cocok; URL
`/boot/52:54:00:…/` di `inst.ks=`/`url=` (CR-4-6 b) — bila parser menolak `:`, cadangannya bentuk MAC
tanpa pemisah di path (perubahan kontrak boot → wajib decision terpisah).

---

## O12. Struktur run KVM M6 dan bulk 3× UEFI dalam batas resource

Batas: VM paralel = clamp((RAM bebas − 4 GB)/2 GB, 1, 3); server 3 GB; node 2 GB; timeout 30
menit/VM. `kvm-run.sh` saat ini menolak node > `max_nodes`.

| | A. Satu run raksasa (semua skenario, satu server) | B. Tiga run terpisah (`m6core`, `m6distro`, `m6bulk`), masing-masing server baru + cleanup + `results.json` sendiri di `.agent/runs/m6/kvm/<run>/`, diringkas ke `.agent/runs/m6/kvm/results.json` (rekomendasi) | C. B tanpa bulk paralel: 3 node bulk dijalankan satu per satu |
|---|---|---|---|
| Durasi / risiko ulang | ±3 jam; satu kegagalan mengulang semuanya | ±1,2 + 0,8 + 0,8 jam; skenario gagal diulang sendiri | Bulk ±1,2 jam |
| Isolasi bukti | Rendah | Tinggi | Tinggi |
| Arti "bulk" | — | Satu aksi bulk di UI untuk 3 host; node dinyalakan dalam **gelombang** `max_nodes` | Aksi bulk tetap satu, tetapi tidak menguji kontensi paralel |

**Rekomendasi: B** dengan pola **discover → poweroff → bulk → start bergelombang** untuk bulk:
1. Ketiga node dibuat dan PXE boot sekali (tanpa job → boot lokal → host muncul di tabel), lalu
   `node.sh poweroff` untuk membebaskan RAM;
2. aksi bulk di UI (credentials, IP range, template hostname, SSH key) + "Simpan & Install" untuk 3
   host sekaligus;
3. `node.sh start` per gelombang berukuran `max_nodes` (dihitung saat itu); gelombang berikutnya
   dimulai saat node gelombang sebelumnya mencapai Done dan dimatikan sementara (atau langsung bila
   `max_nodes = 3`). Timeout Booting 60 mnt (DEC-016, dihitung sejak klik) cukup untuk 2 gelombang;
   bila diperkirakan > 60 mnt, `dashboard.env` KVM menaikkan `PXE_JOB_BOOTING_TIMEOUT_MIN` (env, tanpa
   kode) dan nilainya dicatat di `results.json`.
`max_nodes`, gelombang yang dipakai, dan `MemAvailable` dicatat di bukti. `kvm-run.sh` mendapat mode
`--waves` (tidak lagi gagal bila node > `max_nodes` asalkan mode gelombang aktif).

---

## O13. Adaptasi E2E lama (M1–M5) ke login tanpa melemahkan test

| | A. `storageState` per server: setup project login lewat UI sekali per webServer, spec lama memakai state itu; spec auth baru memakai konteks tanpa state (rekomendasi) | B. Login di `beforeEach` setiap spec | C. Env bypass auth untuk E2E (`PXE_AUTH_DISABLED=1`) |
|---|---|---|---|
| DEC-005 (tanpa seam test di produk) | Patuh | Patuh | **Melanggar** + membuka jalur bypass di produksi → ditolak (setara melemahkan test) |
| Durasi | Kecil | +1–2 dtk per test | — |
| Isolasi | Cookie `localhost` tidak dipisah per port → state per project (bukan global) | Ya | — |

**Rekomendasi: A.** Konteks `request` (API langsung) di test lama juga memakai cookie sesi; tidak ada
asersi yang dihapus/dilonggarkan; readiness `webServer.url` pindah ke `/login` (publik). Password
admin E2E dibuat acak saat config dimuat, hash diteruskan ke env setiap webServer, password ditulis
ke `.e2e-data/` (gitignored, dihapus `globalTeardown`). Setiap perubahan file test lama dicatat di
`test-migration.md` (alasan: login wajib SPEC §6), dan gate memeriksa bahwa jumlah asersi tidak turun.

---

## O14. Redaksi: penutupan CR-5-30/SR-5-19 dan normalisasi encoding (SR-5-13/18/20, CR-5-21)

| | A. Perluas pendekatan peta-indeks yang ada: alternatif ke-4 `ANSI_RE` dibatasi `\x1b[ -/]+[0-~]`; salinan ketiga `sgr` (hanya SGR + OSC 8 utuh dibuang, escape lain hanya byte ESC); kelas karakter yang dibuang untuk salinan pencocokan + `\p{Default_Ignorable_Code_Point}`, `[\uD800-\uDFFF]` tunggal, `\p{Co}`; pra-normalisasi salinan pencocokan (decode persen sekali–dua kali, `\/`→`/`, `\$`→`$`); `TOKEN_KV_RE` parsial `{8,43}` (rekomendasi) | B. Whitelist: salinan pencocokan hanya menyimpan `[A-Za-z0-9_\-$/.:=+]` (karakter lain dibuang dengan peta indeks) | C. Tolak (bukan redaksi) seluruh baris yang memuat karakter kontrol/format/escape |
|---|---|---|---|
| Menutup semua probe reviewer | Ya, per kasus (test (a)–(d) SR-5-19 + daftar SR-5-13/18/20) | Ya secara umum, termasuk kelas karakter yang belum ditemukan | Ya, tetapi kehilangan log diagnostik (progress bar, warna ANSI) di jalur gagal |
| Over-redaksi | Rendah | Sedang (spasi/teks campuran bisa menyambung secret palsu) | Tinggi |
| Risiko regresi (pelajaran M5) | Sedang: tiap perubahan wajib mutasi + data ekstrem | Sedang–tinggi (perubahan arsitektur di milestone terakhir) | Rendah teknis, tinggi nilai produk |
| Performa (SR-5-11) | Linear dipertahankan, test ≤ 20/50 ms tetap | Linear | Linear |

**Rekomendasi: A.** Wajib: setiap perbaikan punya test yang merah bila di-revert (mutasi tercatat),
fuzz/probe reviewer M5 dijadikan fixture regresi, dan **fixture log installer nyata** (subiquity
`subiquity-server-debug.log`, curtin `install.log`, anaconda `anaconda.log`/`program.log`, d-i
`syslog`) yang diambil dari run KVM M6 (SR-5-5(c)) — disimpan sebagai fixture **setelah** redaksi
bukti dan disisipi secret sintetis (bukan token/hash sungguhan).

---

## Ringkasan rekomendasi (kandidat decision)

| # | Topik | Rekomendasi |
|---|---|---|
| O1 | Login & sesi | Sesi server-side SQLite (ID acak, simpan SHA-256), cookie HttpOnly + SameSite=Strict (+Secure bila base URL https), idle 120 mnt / absolut 12 jam, sesi terikat sidik kredensial |
| O2 | Hash password | scrypt `node:crypto` berformat ber-parameter, batas parameter, `timingSafeEqual` |
| O3 | Bootstrap admin | Env `PXE_ADMIN_USERNAME` + `PXE_ADMIN_PASSWORD_HASH`, helper hash via stdin; production tanpa admin → tolak start; tanpa kredensial default |
| O4 | Penegakan | Proxy (redirect halaman) + `requireSession` di setiap handler + test statis enumerasi route; `/boot/**` tetap token |
| O5 | Rate limit | Di aplikasi (login per IP+username dan per IP, API per sesi, SSE per sesi) + nginx `limit_req` lapis kedua |
| O6 | SR-5-3 | Throttle log penolakan di aplikasi (20 baris/menit + ringkasan) + `limit_req` `/boot/` |
| O7 | SR-5-4 | Tolak start production kecuali `PXE_INSECURE_NO_LEASE_CHECK_CONFIRM=<frasa literal>`; test level proses |
| O8 | Windows | Tidak dilayani; generator dikeraskan (tanpa token/URL, hapus Panther, matikan AutoLogon, logoff) |
| O9 | DEC-015 tertunda | Offline otomatis & registrasi URL tetap di luar cakupan; dicatat deviasi SPEC di REPORT-final |
| O10 | WCAG (I-5-6) | AA kecuali kontras token SPEC terdaftar; audit axe otomatis; tanpa mengubah SPEC |
| O11 | Debian/Rocky KVM | Offline dari media lokal yang sudah ada; cadangan repo tambahan dari mirror resmi; tanpa NAT untuk node |
| O12 | Run KVM | Tiga run terpisah; bulk = discover → poweroff → bulk UI → start bergelombang `max_nodes` |
| O13 | E2E lama | `storageState` per server; tanpa bypass auth; `test-migration.md` |
| O14 | Redaksi | Perluas peta-indeks + normalisasi; mutasi wajib; fixture log installer nyata dari KVM |
