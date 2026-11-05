# M6 — Hardening keamanan & E2E penuh (plan)

- Milestone: 6 (terakhir) · Branch: `milestone/6-hardening-e2e`
- Sumber: SPEC §6 (login minimal satu admin, semua API butuh autentikasi, config hanya untuk MAC/IP
  yang sesuai, validasi server), §7 (kriteria selesai), §1 (design system, juga untuk halaman login),
  §4/§5 (OS Images, generator Windows unattend); CLAUDE.md §Gate approval, §Batas keras, §Pengujian
  KVM (matriks lengkap, alur E2E via dashboard, verifikasi SSH, semua uji negatif, cleanup, hapus
  network di akhir); DEC-003/009 (topologi), DEC-004 (coverage), DEC-005 (tanpa seam test),
  DEC-007 (SQLite, env), DEC-008/013 (token per-MAC + binding IP), DEC-010 (Debian/Rocky/bulk di M6,
  Windows generator saja), DEC-014 (job/log), DEC-015 (allowlist nginx; Offline & URL ditunda),
  DEC-016 §2 (SR-5-4 syarat gate M6).
- Masukan wajib: `.agent/wt-m5/.agent/runs/m5/gate-iter3.md` §"Kewajiban carry-over ke M6",
  `docs/agent-workflow/approvals/APR-005-m5.md`, `docs/agent-workflow/reports/REPORT-m5.md`,
  `review-{code,security,design}-iter{1,2,3}.md` M5, `review-*-iter1.md` M4 (CR-4-6/7, SR-4-3/6/7/8).
  Trace lengkap di §7.
- Opsi & rekomendasi: `docs/design/M6-options.md` (O1–O14). Plan ini mengasumsikan rekomendasi
  diterima; AC yang bergantung pada opsi ditandai `[O<n>]`.
- Kode dasar (`main` @ `m5-approved`): `lib/server/{http,settings,startup,sse,redact,provisioning,
  job-lifecycle,watchdog,boot-http,install-service,jobs-service,library-service}.ts`,
  `lib/server/db/{migrations.ts,repos/{jobs,job-events,os-images}.ts}`, `lib/server/installers/*`,
  `app/api/**`, `app/boot/**`, `hooks/*`, `components/{hosts,host-config,jobs,os-images,ssh-keys,
  settings}/*`, `infra/**`, `dashboard/e2e/**`, `dashboard/e2e-kvm/**`.
- **Next 16.4**: Middleware sudah menjadi **Proxy** (`src/proxy.ts`, runtime Node.js). Dev wajib
  membaca `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`,
  `.../01-app/02-guides/authentication.md`, dan dokumentasi `cookies()` sebelum menulis kode
  (`dashboard/AGENTS.md`).

## 1. Ruang lingkup

Masuk M6:
1. **Login admin & sesi** (SR-4-1, SPEC §6) [O1–O4]: halaman `/login` sesuai design system, logout,
   sesi server-side, semua `/api/**` (kecuali login) butuh sesi, redirect halaman lewat Proxy,
   bootstrap admin dari env berisi hash (tanpa secret di repo, tanpa kredensial default).
2. **Rate limit** (SR-4-1) [O5]: login per (IP, username) dan per IP, API per sesi, SSE per sesi
   (SR-5-7); nginx `limit_req` lapis kedua.
3. **SR-5-3** [O6]: log penolakan `/boot/**` dibatasi (throttle + ringkasan) + `limit_req /boot/`.
4. **SR-5-4 / DEC-016 §2** [O7]: tolak start production + flag insecure tanpa konfirmasi kedua;
   **SR-5-10**: bukti level proses untuk semua penolakan start.
5. **Redaksi** [O14]: CR-5-30 + SR-5-19; SR-5-18/SR-5-20/SR-5-13/CR-5-21; CR-5-20 (a, b, c) +
   SR-5-5(c) dengan fixture log installer nyata; docstring `job-events.ts:106`; SR-5-14 (opsional
   tetapi direncanakan); SR-5-15 (dokumentasi).
6. **Carry-over backend M5**: CR-5-3 … CR-5-11, SR-5-6, SR-5-7, SR-5-8, SR-5-10.
7. **Generator**: SR-4-6 (preseed ` ---`), CR-4-7/SR-4-3 pengerasan unattend Windows (tetap tidak
   dilayani) [O8]; CR-4-6 dibuktikan oleh KVM Debian/Rocky.
8. **UI**: halaman login + logout + penanganan 401/sesi habis; DR-5-10, DR-5-11, DR-5-14, I-5-9,
   E2E OS Images 768–1279; pantau DR-5-1 (batas 200 px **tidak boleh** dinaikkan); target
   aksesibilitas [O10].
9. **Infra & KVM**: matriks lengkap (BIOS Ubuntu, UEFI Ubuntu, UEFI Debian 12, UEFI Rocky 9, bulk 3×
   UEFI Ubuntu sesuai resource) + seluruh alur E2E dashboard **dengan login** + semua uji negatif
   CLAUDE.md + jalur gagal installer nyata (SR-5-5(c)); harness selalu menulis entri cleanup; bukti
   libvirt sebelum/sesudah; mode gelombang untuk bulk [O11, O12].
10. **Penutupan**: hapus network `pxe-test` dan `pxe-test-nat` setelah approval M6 (task terakhir).

Opsional (dikerjakan bila waktu cukup; **bila dikerjakan wajib ber-test**, dicatat sebagai `OPT-*`
di `ac-trace.md`; tidak dikerjakan = tidak memblokir gate): I-5-13 (header "Platform" → "Arsitektur ·
Metode"), I-5-14, I-5-16, CR-5-27 (`cleanAndRedact` per baris), CR-5-32 (komentar/hapus `min-w-0`
redundan), CR-5-34 (`expect.soft`/`test.step` di cleanup E2E), CR-5-35 (`PathText` tidak memenggal
segmen pendek), CR-5-36 (rapikan `found`/docstring), CR-5-15 (KCMD lama = hasil turunan), CR-5-16
(hapus no-op), SR-4-7(a) (URL callback lewat stdin `curl --config -`).

Tidak masuk M6 [O9]: status `offline` otomatis; registrasi OS image dari URL jarak jauh (keduanya
dicatat sebagai deviasi SPEC di `REPORT-final.md`); penyajian/instalasi Windows (DEC-010);
multi-admin/manajemen user lewat UI; HTTPS (SR-4-8 → dokumentasi asumsi LAN terisolasi saja);
kendali daya IPMI/Redfish (DEC-012); aksi "Batalkan job".

## 2. Rancangan teknis

### 2.1 Settings (env) baru — `lib/server/settings.ts`, `.env.example`, `infra/server/dashboard.env`

| Variabel | Default | Batas / format | KVM |
|---|---|---|---|
| `PXE_ADMIN_USERNAME` | — | `^[a-z_][a-z0-9_-]{0,31}$` | `pxeadmin` (non-rahasia) |
| `PXE_ADMIN_PASSWORD_HASH` | — | `scrypt$<logN 14–20>$<r 8–16>$<p 1–4>$<salt b64 ≥16 B>$<hash b64 64 B>` | placeholder `@PXE_ADMIN_PASSWORD_HASH@`, diganti saat deploy |
| `PXE_SESSION_IDLE_MIN` | 120 | 1–1440 | 240 (run KVM panjang) |
| `PXE_SESSION_MAX_HOURS` | 12 | 1–168 | 12 |
| `PXE_LOGIN_MAX_FAILURES` | 5 | 3–100 | 5 |
| `PXE_LOGIN_WINDOW_MIN` | 15 | 1–1440 | 15 |
| `PXE_API_RATE_PER_MIN` | 600 | 60–10000 | 600 |
| `PXE_INSECURE_NO_LEASE_CHECK_CONFIRM` | — | frasa literal `I_UNDERSTAND_CONFIG_LEAKS` | tidak diset |

Aturan start (fail fast, pesan menyebut nama variabel, tanpa mencetak nilai hash):
- `NODE_ENV=production` dan (`PXE_ADMIN_USERNAME` kosong atau `PXE_ADMIN_PASSWORD_HASH` kosong/tidak
  valid/parameter di luar batas) → **tolak start** [O3]. Non-production tanpa admin → start dengan
  satu baris peringatan; semua API 401, login selalu gagal (tanpa kredensial default).
- **SR-5-4** [O7]: `NODE_ENV=production` + `PXE_INSECURE_NO_LEASE_CHECK=1` → tolak start kecuali
  `PXE_INSECURE_NO_LEASE_CHECK_CONFIRM` sama persis dengan frasa; nilai lain → tolak (pesan menyebut
  kedua variabel). Diizinkan → peringatan setiap start.
- `PXE_ADMIN_PASSWORD_HASH` tidak pernah masuk log, `GET /api/settings`, atau pesan error.

`GET /api/settings` menambah `auth {adminUsername, adminConfigured, sessionIdleMin, sessionMaxHours,
loginMaxFailures, loginWindowMin, apiRatePerMin}` dan `insecureConfirmed` (boolean). Halaman Settings
menampilkan blok "Akses" read-only (username mono).

Helper `dashboard/scripts/admin-hash.mjs` (`npm run admin:hash`): membaca password dari stdin (TTY
tanpa echo atau pipe), menolak < 12 / > 256 karakter, mencetak hanya hash. Memakai fungsi hash yang
sama dengan app (modul murni `lib/server/auth/password.ts`; skrip memakai implementasi setara yang
dibuktikan oleh test paritas dua arah).

### 2.2 Data — migrasi 3 (`db/migrations.ts`, hanya menambah)

```sql
CREATE TABLE sessions (
  id_hash      TEXT PRIMARY KEY,          -- sha256(id sesi) hex; id mentah hanya di cookie
  username     TEXT NOT NULL,
  cred_fp      TEXT NOT NULL,             -- sha256(PXE_ADMIN_PASSWORD_HASH) 16 hex: ganti hash = sesi batal
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,             -- created_at + PXE_SESSION_MAX_HOURS
  ip           TEXT
);
CREATE INDEX sessions_expires ON sessions(expires_at);
ALTER TABLE job_events ADD COLUMN last_at TEXT;   -- CR-5-7: waktu kemunculan terakhir event gabungan
```
Sesi kedaluwarsa dihapus oleh `sweepJobs`/watchdog (fungsi terpisah `pruneSessions(now)`, idempoten).
Backfill `last_at = at`.

### 2.3 Autentikasi [O1, O2, O4]

Modul `lib/server/auth/{password,session,rate-limit,guard}.ts` (logika di `lib/server` agar masuk
coverage DEC-004; `src/proxy.ts` tipis).
- **password.ts**: `hashPassword(pw)`, `verifyPassword(pw, encoded)` (scrypt, `maxmem` eksplisit,
  `timingSafeEqual`, parser menolak parameter di luar batas). Username tak dikenal → verifikasi
  terhadap hash dummy (waktu setara).
- **session.ts**: `createSession(username, ip, now)` → id 32 B base64url; `getSession(cookie, now)`
  (cek `expires_at`, idle `last_seen_at + idle`, `cred_fp` = sidik hash saat ini); perpanjangan
  `last_seen_at` paling sering 1×/60 dtk; `destroySession`.
- **Cookie** `pxe_session`: `HttpOnly; SameSite=Strict; Path=/; Max-Age=<max hours>`; `Secure` bila
  `PXE_BASE_URL` https. Lab HTTP tanpa `Secure` (sisa risiko SR-4-8, didokumentasikan).
- **Route**: `POST /api/auth/login` `{username, password}` (zod `.strict()`, password 1–256) melalui
  `guardMutation("json")` (Host + Origin + `Sec-Fetch-Site` + JSON) → 204 + `Set-Cookie`, atau 401
  `{"error":"Username atau password salah"}` seragam, atau 429 + `Retry-After`. Setiap login sukses
  membuat ID baru (sesi lama di cookie request dihapus). `POST /api/auth/logout` → 204, baris sesi
  dihapus, cookie `Max-Age=0`. `GET /api/auth/session` → `{username, expiresAt}` atau 401.
- **Penegakan** [O4]: `guardRead`/`guardMutation` memanggil `requireSession` setelah cek Host →
  401 `{"error":"Perlu login"}` (`no-store`). Semua route `app/api/**` wajib memanggil salah satu
  guard; pengecualian hanya `POST /api/auth/login`. `/boot/**` tidak memakai sesi (token per-MAC).
  `src/proxy.ts`: matcher semua path kecuali `/boot/`, `/api/`, `/_next/static`, `/_next/image`,
  font/ikon publik, `/login`; tanpa cookie sesi yang valid → 307 ke `/login?next=<path+query>`.
  Layout server `(dashboard)` juga memeriksa sesi (lapis kedua) → `redirect('/login?next=…')`.
  `next` hanya diterima bila cocok `^/(?![/\\])[^\s]*$` dan bukan `/login`; selain itu → `/hosts`.
- **SSE** `GET /api/jobs/:id/logs`: sesi diperiksa saat connect, divalidasi ulang tiap 30 dtk di
  loop tick (logout/kedaluwarsa → `event: end` dengan `data {"reason":"session"}` lalu tutup); batas
  5 koneksi per sesi (429) + batas global 50 (503) yang sudah ada (SR-5-7).

### 2.4 Rate limit & log penolakan [O5, O6]

`lib/server/auth/rate-limit.ts`: jendela geser in-memory (satu proses), jam injeksi, `unref`
pembersih. Kunci:
- login gagal per `(ip, username)` → `PXE_LOGIN_MAX_FAILURES` per `PXE_LOGIN_WINDOW_MIN`; per `ip`
  → 4× nilai itu (default 20). Saat terkunci, password benar pun → 429 (tanpa membocorkan validitas).
  Login sukses menghapus hitungan `(ip, username)`.
- API ber-sesi: `PXE_API_RATE_PER_MIN` per sesi → 429 `{"error":"Terlalu banyak request"}` +
  `Retry-After`.
- IP klien = `requestIp(req)` (X-Real-IP hanya bila `PXE_TRUST_PROXY=1`); IP tak diketahui → kunci
  `"unknown"` (tetap dibatasi).

`boot-http.ts` (SR-5-3): `logBootDenied` lewat throttle per jalur (`ipxe|file|status|log`): maks 20
baris detail per 60 dtk, lalu satu ringkasan `[boot] <n> penolakan <jalur> ditekan dalam 60 dtk`
saat jendela berganti. Format baris detail tetap (SR-4-4: MAC ternormalisasi atau `-`, escape, tanpa
token).

nginx (`infra/server/nginx-pxe.conf`): `limit_req_zone $binary_remote_addr zone=pxe_login:1m
rate=10r/m;` + `location = /api/auth/login` (allowlist admin tetap, `limit_req zone=pxe_login burst=5
nodelay`); `limit_req_zone … zone=pxe_boot:2m rate=20r/s;` di `location /boot/` (`burst=100
nodelay`); `limit_req_status 429`. Allowlist IP admin DEC-015 tetap (lapis tambahan, bukan pengganti).

### 2.5 Redaksi [O14]

Perubahan di `lib/server/redact.ts` dan `db/repos/job-events.ts` (setiap butir = test merah bila
di-revert, dicatat di mutasi):
1. **CR-5-30 + SR-5-19**: alternatif ke-4 `ANSI_RE` → `\x1b[ -/]+[0-~]` (ESC tunggal + huruf/angka
   diserahkan ke `stripControl`); salinan pencocokan ketiga `sgr` (hanya SGR `\x1b\[[0-9;:]*m` dan
   OSC 8 utuh yang dibuang; escape lain hanya byte ESC); tanda dari ketiga salinan digabung lewat peta
   indeks; `TOKEN_KV_RE` parsial `{8,43}` (bersama CR-5-21).
2. **SR-5-18 / SR-5-20 / SR-5-13 / CR-5-21**: kelas karakter yang dibuang dari salinan pencocokan
   ditambah `\p{Default_Ignorable_Code_Point}`, surrogate tunggal `[\uD800-\uDFFF]` (yang tidak
   berpasangan), `\p{Co}`; pra-normalisasi salinan pencocokan: `\/`→`/`, `\$`→`$`, decode
   persen (`%2F`, `%3D`, `%24`, dan satu lapis ganda `%25xx`) dengan peta indeks.
3. **CR-5-20 (a, b, c) + SR-5-14**: baris isi key berprefiks log umum (`[ <angka>.<angka>] `,
   `<proses>[<pid>]: `, timestamp ISO/syslog) dikenali; rangkaian ≥ 2 baris base64 berurutan
   sepanjang 64 atau 70 karakter (pola isi OpenSSH/PEM) tanpa BEGIN/END diredaksi; batas `guard <
   64` footer yatim dihapus (tetap linear).
4. **SR-5-15**: docstring modul `redact.ts` memuat tabel perilaku over-redaksi yang diterima
   (`awk '{print $6$7}'`, BEGIN tanpa footer, footer yatim menelan baris berbentuk key, path BLS
   machine-id, emoji ZWJ terpecah) dan sisa risiko (token ter-wrap ke baris berikut); tabel yang sama
   diuji sebagai "perilaku terdokumentasi".
5. **Docstring `job-events.ts:106`**: klaim "tidak lagi meloloskan sisa secret" diganti deskripsi
   yang akurat + rujukan sisa risiko.
6. **Fixture log installer nyata** (SR-5-5(c)): dari run KVM M6 (jalur gagal Ubuntu, log
   Debian/Rocky), diambil **setelah** `redact-evidence.sh`, disisipi secret sintetis (token 43 dummy,
   hash `$6$fixture…`, key OpenSSH dummy) di posisi realistis → `dashboard/test/fixtures/installer-logs/`.

Batas performa SR-5-11 dipertahankan (16 KB: `redactSecrets`/`cleanEventMessage` ≤ 20 ms terbaik
dari 5; `handleLogPost` ≤ 50 ms terbaik dari 5). AC-5.13 (perilaku endpoint log) tidak boleh berubah;
bila ekspektasi tampilan berubah, entri di `test-migration.md` dengan alasan.

### 2.6 Carry-over backend M5

| ID | Perubahan |
|---|---|
| CR-5-3 | `sweepJobs` pra-cek tanpa transaksi (`listActiveJobs` + filter jatuh tempo, juga sesi kedaluwarsa); `BEGIN IMMEDIATE` hanya bila ada kandidat, baca ulang di dalam tx |
| CR-5-4 | Cursor `before` = token opak `base64url(created_at|id)` tanpa lookup id (tidak bisa basi); klien hanya me-refetch halaman pertama saat polling (`maxPages`/refetch page 0) |
| CR-5-5 | `use-job-log`: polling 404 (atau 4xx selain 401/429) → hentikan, status final "Job tidak ditemukan"; 401 → alur sesi habis (§2.8) |
| CR-5-6 | Resume SSE dengan `after=k>0` mengirim ulang event `k` sekali dengan `repeat` terkini |
| CR-5-7 | Jendela gabung 60 dtk dihitung dari `last_at`; `last_at` diperbarui saat merge; API event memuat `lastAt`; UI menampilkan "terakhir HH:MM:SS" untuk `repeat > 1` |
| CR-5-8 | `installHosts` memanggil `sweepJobs(now, hostId)` di awal tx |
| CR-5-9 | Tipe kontrak API satu sumber di `lib/types.ts` (bebas server) diimpor server & klien, atau `expectTypeOf` paritas; `HostLastJob.failureReason: FailureReason \| null` |
| CR-5-10 | `assert-server-logs.sh` menulis `server-log-asserts.json` terpisah lewat `python3 -c`/`jq` (escape benar), lalu digabung ke `results.json` oleh harness tanpa `sed` |
| CR-5-11 | `tick` SSE gagal → satu baris `[sse] tick gagal: <kelas error>` (tanpa pesan bebas dari data); `SQLITE_BUSY` di-retry sekali |
| SR-5-6 | Varian path ke `/api` lewat `/boot/` diuji statis + KVM (lihat AC-6.43) |
| SR-5-7 | Batas SSE per sesi (§2.3) |
| SR-5-8 | `library-service.ts`: nama SSH key, name/version OS image menolak `\p{Cc}`, `\p{Cf}` (termasuk bidi U+202A–U+202E, U+2066–U+2069), `\p{Co}` → 400 per field |
| SR-5-10 | Test level proses (§2.9, AC-6.3) |

### 2.7 Generator

- **SR-4-6**: `installerScript` preseed menambah ` ---` setelah parameter konfigurasi (parameter
  `url=`/`auto`/`priority` tetap **sebelum** `---`) agar d-i tidak menyalinnya ke bootloader target.
  Rocky: tidak berubah (anaconda tidak menyalin `inst.*`), diverifikasi KVM.
- **CR-4-6**: tidak ada perubahan kode di awal; smoke KVM dini (M6-T15) membuktikan `/proc/cmdline`
  di chroot d-i/`%post`, `:` dalam URL `inst.ks=`/`url=`, dan sed BRE di busybox. Bila salah satu
  gagal: perbaikan generator (bukan kontrak path) + test; perubahan bentuk path `/boot/<mac>` hanya
  lewat decision baru.
- **CR-4-7 / SR-4-3** [O8]: `installers/windows.ts` tanpa URL/token; `FirstLogonCommands` terakhir
  (urut): hapus `C:\Windows\Panther\unattend*.xml` + `C:\Windows\System32\Sysprep\unattend.xml`,
  `AutoAdminLogon=0` + hapus `DefaultPassword`, acak ulang password `pxeadmin` (PowerShell
  `RandomNumberGenerator`, tidak dicetak), `logoff`. Tetap: `INSTALLER_FILES.unattend = {}`,
  image `unattend` tidak bisa `bootable`, install Windows 422. Golden file diperbarui.

### 2.8 UI

Semua mengikuti SPEC §1 (tanpa shadow, hairline, oranye hanya CTA primary, mono untuk data teknis,
judul 26/400 −0.325 px, label 11/600 uppercase). Dev wajib **mengaudit sendiri** setiap perubahan
layout di 375, 414, 768, 800, 1024, 1279, 1280, 1440 dengan data ekstrem (fixture stres M5: ID 48
karakter ber-hyphen dan tanpa titik pecah, nama 64 tanpa spasi, nama ber-underscore 40, segmen path
110) **sebelum** menyerahkan ke test-engineer.

**Halaman login** (`app/login/page.tsx` di luar route group `(dashboard)`, `components/auth/*`):
- Kanvas krem penuh, tanpa sidebar/top bar; card putih hairline radius 12, tanpa shadow, lebar
  maks 400 px, padding 32 (24 di 375); di atas card: nama produk 16–18/600.
- Judul "Masuk" 26/400 −0.325 px; deskripsi caption 13 px `muted`.
- Field "Username" (input 44 px, radius 8, `font-mono` konsisten dengan field username tab
  Credentials, `autocomplete="username"`, `autocapitalize="none"`, `spellcheck=false`) dan
  "Password" (`autocomplete="current-password"`, tombol show/hide ber-`aria-label`).
- Tombol "Masuk" primary oranye 40 px lebar penuh (satu-satunya oranye); status loading spinner.
- Error: Alert `destructive` `role="alert"` "Username atau password salah"; 429 → "Terlalu banyak
  percobaan. Coba lagi dalam N menit." (N dari `Retry-After`); admin belum dikonfigurasi (non-prod)
  → Alert netral berisi instruksi `npm run admin:hash` + variabel env (mono).
- Submit dengan Enter; fokus ke field pertama; fokus ke Alert saat error; tanpa flash konten
  terproteksi.

**Logout & identitas**: footer sidebar: username (mono 13 px `muted`) + tombol tertiary "Keluar"
(ikon + teks 14/500). Tidak menambah elemen di top bar (menjaga I-5-9). Mode sidebar collapsed/mobile:
item tetap terjangkau.

**Sesi habis**: wrapper fetch klien (`lib/api-client.ts` atau hook bersama) — 401 dari API mana pun →
hentikan polling/SSE (TanStack `retry` tidak mengulang 401), `router.replace('/login?next=<path>')`
sekali (tanpa loop toast). 429 → toast tunggal "Terlalu banyak request", polling mundur sesuai
`Retry-After`.

**Carry-over design**:
- **DR-5-10** SSH Keys 375: pola kartu `< md` seperti OS Images (nama, tipe, fingerprint mono utuh
  ber-`wrap-anywhere`, dibuat, dipakai, aksi rename/hapus terlihat); tabel `≥ md` tidak berubah.
- **DR-5-11**: path di dalam kalimat alasan (kolom Ketersediaan OS Images, kartu OS di Sheet) dirender
  `PathText`/`type-data` (mono).
- **DR-5-14**: span alasan tidak memakai `wrap-anywhere`; path dipenggal hanya di `/` (via
  `PathText`) dan kolom diberi `xl:min-w-[22ch]` (atau setara) sehingga `vmlinuz`/`ubuntu-22.04` tidak
  terbelah di 1280 dengan data stres.
- **I-5-9**: klaster kanan top bar tidak membuat `scrollWidth` > viewport di 768–818 (mis. search
  global menyusut/ikon-saja `< lg`, label status server dipendekkan) — tanpa menyembunyikan status
  DHCP/TFTP/HTTP (SPEC §2).
- **DR-5-1** (pantau): tinggi kartu image bawaan di 375 tetap ≤ 200 px; bila perubahan font/login
  membuat > 200, layout yang diperbaiki — batas tidak dinaikkan tanpa decision.
- **Aksesibilitas [O10]**: semua input berlabel, tombol ikon ber-`aria-label`, fokus terlihat
  (`ring`), urutan tab logis di login/Sheet/dialog; target AA kecuali pengecualian 1.4.3 token SPEC
  yang terdaftar di DEC.

### 2.9 Infra, harness, dan uji level proses

- **Deploy admin** (`infra/deploy-dashboard.sh`, `infra/server/install-dashboard.sh`): harness
  membuat password admin acak per run (`/dev/urandom`, 24 karakter) → file
  `.agent/keys/<run>-admin.pass` (0600); hash dihitung di host via `npm run admin:hash` (stdin);
  hash dikirim ke VM lewat stdin `ssh … 'bash -s'` dan disisipkan ke `/etc/pxe-dashboard.env`
  (root:pxe 0640) menggantikan placeholder. Password/hash tidak pernah di argv, log, atau
  `kvm-run.txt`. Cleanup menghapus file password.
- **`kvm-run.sh`**:
  - `--scenario <core|distro|bulk>` → run id `m6core`/`m6distro`/`m6bulk`, bukti di
    `.agent/runs/m6/kvm/<scenario>/` + ringkasan gabungan `.agent/runs/m6/kvm/results.json` [O12];
  - `--waves` untuk bulk (§5) — tanpa `--waves`, node > `max_nodes` tetap ditolak (perilaku lama);
  - spec node diperluas: `NN:uefi|bios[:destroy|:failpath][:os=ubuntu|debian|rocky]`;
  - **entri cleanup selalu ditulis** ke `results.json` dari trap EXIT, termasuk run parsial/gagal
    di tahap mana pun (preflight, net-up, server-up, deploy, playwright, verify), memuat status
    cleanup + ringkasan diff libvirt;
  - snapshot `virsh list --all` + `net-list --all` sebelum dan sesudah → `libvirt-before.txt`,
    `libvirt-after.txt`, `libvirt-diff.txt` (resource terlindungi identik).
- **`dashboard/e2e-kvm/verify-node.sh`**: tambahan pemeriksaan "target bebas token": `/proc/cmdline`,
  `/etc/default/grub`, `/boot/grub*/grub.cfg`, `/boot/loader/entries/*.conf`, `/etc/kernel/cmdline`,
  `/root/anaconda-ks.cfg`, `/etc/pxe-callback/` (harus hilang) tidak cocok
  `/boot/<mac>/[A-Za-z0-9_-]{43}` (output hanya jumlah cocok, bukan isinya). Sisa SR-4-7(b)
  (`/var/log/installer` memuat token yang sudah dicabut) dicatat, tidak diasersi.
- **Ekstraksi token untuk uji negatif config per-MAC** (AC-6.47): harness membaca console serial node
  **di memori** saat job Installing, mengambil token dari `ds=nocloud-net;s=…/<token>/`, memakainya
  untuk request negatif, lalu membuang variabel; token tidak pernah ditulis ke file/log (redaksi bukti
  tetap berjalan sebagai lapis kedua).
- **Uji level proses** (SR-5-10, SR-5-4, O3): `dashboard/test/process/start-guard.test.ts` (vitest,
  `node` env) menjalankan build standalone (`.next/standalone/server.js`, dibangun sekali di
  globalSetup bila belum ada) dengan env buruk → exit ≠ 0 dalam ≤ 15 dtk, stderr memuat
  `[pxe] start ditolak:` + nama variabel; env baik → `GET /login` 200 lalu dimatikan.
- **Dokumentasi** (SR-4-8, SR-5-15, SR-4-7): `infra/README.md` §"Asumsi keamanan" (LAN provisioning
  terisolasi, HTTP polos, cookie tanpa `Secure` di lab, allowlist + login + rate limit, sisa risiko
  token di log installer target) dan `.env.example` (variabel §2.1 + peringatan).
- **Penutupan** (M6-T16, setelah APR M6): `infra/net-down.sh` menghapus `pxe-test` dan `pxe-test-nat`;
  `infra/cleanup.sh --server --base` menghapus overlay & base disk server di `.agent/vms/`; key
  `.agent/keys/*` dihapus; media `.agent/media/` dipertahankan. Bukti `.agent/runs/m6/teardown.txt`.

### 2.10 Adaptasi E2E lama ke login [O13]

- `playwright.config.ts`: password admin acak per run (dibuat saat config dimuat), hash ke env setiap
  webServer; `webServer.url` readiness → `/login`; project `setup-<server>` login lewat UI dan
  menyimpan `storageState` per server; project lama `dependencies` ke setup-nya. Spec auth baru memakai
  konteks tanpa state. Server tambahan: `m6-auth` (lockout), `m6-session` (`PXE_SESSION_IDLE_MIN=1`,
  uji sesi habis — pola webserver kedua O13 M5, tanpa seam), `m6-ui`.
- Konteks `request` di test lama memakai cookie sesi dari `storageState`; **tidak ada asersi yang
  dihapus/dilonggarkan**; tidak ada env bypass auth. `test-migration.md` iter1 mendaftar setiap file
  yang berubah + alasan; skrip hitung asersi (`expect(` + `toHave*`) per file sebelum/sesudah dilampirkan.
- `assertEverySpecCollected` tetap; `forbidOnly`, `retries: 0`, `workers: 1` tetap.

## 3. Task

| ID | Owner | Deskripsi | Dependensi | File |
|---|---|---|---|---|
| M6-T1 | backend-dev | Settings §2.1 (admin, sesi, rate, konfirmasi SR-5-4) + aturan start; `startup.ts`/`instrumentation.ts`; `/api/settings` diperluas; `.env.example`; `dashboard.env` placeholder; helper `scripts/admin-hash.mjs` + `npm run admin:hash`. | — | `lib/server/{settings,startup}.ts`, `src/instrumentation.ts`, `dashboard/scripts/admin-hash.mjs`, `dashboard/package.json` (script saja), `.env.example`, `infra/server/dashboard.env` |
| M6-T2 | backend-dev | Auth §2.3: `auth/{password,session,guard}.ts`, migrasi 3 (sessions + `job_events.last_at`), repo sessions, route `app/api/auth/{login,logout,session}`, `requireSession` di `guardRead`/`guardMutation`, `src/proxy.ts`, cek sesi di layout `(dashboard)`, SSE revalidasi + batas per sesi (SR-5-7), `pruneSessions` di sweep. | T1 | `lib/server/auth/*`, `lib/server/http.ts`, `lib/server/db/{migrations.ts,repos/sessions.ts}`, `app/api/auth/**`, `src/proxy.ts`, `app/(dashboard)/layout.tsx`, `lib/server/{sse,job-lifecycle,watchdog}.ts` |
| M6-T3 | backend-dev | Rate limit §2.4 (login, API, SSE) + throttle log penolakan `/boot/**` (SR-5-3). | T2 | `lib/server/auth/rate-limit.ts`, `lib/server/{http,boot-http}.ts`, `app/api/auth/login/route.ts` |
| M6-T4 | backend-dev | Redaksi §2.5 butir 1–5 (CR-5-30, SR-5-19, SR-5-18, SR-5-20, SR-5-13, CR-5-21, CR-5-20 a/b/c, SR-5-14, SR-5-15, docstring). Fixture nyata (butir 6) ditambahkan oleh T14 setelah run KVM. Paralel sejak awal. | — | `lib/server/redact.ts`, `lib/server/db/repos/job-events.ts` |
| M6-T5 | backend-dev | Carry-over §2.6: CR-5-3, 5-4 (server), 5-6, 5-7, 5-8, 5-9, 5-11, SR-5-8. | T2 (migrasi 3 untuk CR-5-7) | `lib/server/{job-lifecycle,sse,install-service,jobs-service,library-service}.ts`, `lib/server/db/repos/{jobs,job-events}.ts`, `lib/types.ts`, `app/api/jobs/**` |
| M6-T6 | backend-dev | Generator §2.7: SR-4-6 ` ---` preseed; pengerasan Windows (CR-4-7/SR-4-3); perbaikan CR-4-6 bila smoke T15 menemukan masalah. | — (CR-4-6: T15) | `lib/server/boot-script.ts`, `lib/server/installers/{windows,debian,rocky,shell}.ts`, golden file |
| M6-T7 | backend-dev | Infra §2.9: deploy admin (password per run, hash via stdin), nginx `limit_req` + `location = /api/auth/login`, `kvm-run.sh` (`--scenario`, `--waves`, spec `:failpath`/`:os=`, cleanup entry selalu, libvirt before/after/diff), `verify-node.sh` cek target bebas token, CR-5-10 `assert-server-logs.sh` JSON, `README.md` §Asumsi keamanan. Paralel sejak awal. | — (login harness: T2) | `infra/**`, `dashboard/e2e-kvm/verify-node.sh` |
| M6-T8 | frontend-dev | Login page + logout di sidebar + wrapper fetch 401/429 + integrasi hook polling/SSE (CR-5-5 klien), Settings blok "Akses". | T2 (kontrak API) | `app/login/page.tsx`, `components/auth/**`, `components/app-sidebar.tsx`, `lib/api-client.ts`, `hooks/*.ts`, `components/settings/settings-view.tsx`, `components/providers.tsx` |
| M6-T9 | frontend-dev | Carry-over UI §2.8: DR-5-10, DR-5-11, DR-5-14, I-5-9, CR-5-4 klien (refetch halaman pertama), CR-5-7 tampilan `lastAt`, a11y [O10]; opsional I-5-13/14, CR-5-32, CR-5-35. Audit mandiri data ekstrem. | T5 (kontrak `lastAt`/cursor) | `components/{ssh-keys,os-images,host-config,jobs}/**`, `components/top-bar.tsx`, `hooks/use-jobs.ts` |
| M6-T10 | test-engineer | Unit: settings/start (§2.1), password/scrypt + paritas helper, sesi (jam injeksi), rate limit, throttle SR-5-3, redaksi (tabel kasus reviewer + mutasi), `next` sanitizer, generator SR-4-6/Windows, tipe CR-5-9. | T1–T6 | `src/**/*.test.ts` |
| M6-T11 | test-engineer | Integration route handler: matriks auth semua route × method (+ test statis enumerasi), login/logout/sesi, rate limit, SSE (auth, revalidasi, per-sesi), carry-over CR-5-3..11, SR-5-8, regresi M2–M5 dengan sesi; uji level proses `test/process/start-guard.test.ts`. | T2–T5 | `src/app/**/*.test.ts`, `src/lib/server/**/*.test.ts`, `dashboard/test/process/*` |
| M6-T12 | test-engineer | E2E Playwright: migrasi ke `storageState` (§2.10, `test-migration.md`), spec baru `m6-auth`, `m6-session`, `m6-ui` (DR-5-10/11/14, I-5-9, OS Images 768–1279, DR-5-1), axe [O10]. | T8, T9 | `dashboard/e2e/**`, `dashboard/playwright.config.ts`, `package.json` (devDependency `@axe-core/playwright`) |
| M6-T13 | test-engineer | Test shell infra (virsh/ssh palsu, `INFRA_DRY_RUN`): cleanup entry pada run parsial per tahap, `--waves`, `--scenario`, deploy admin tanpa bocor, CR-5-10 JSON, nginx statis (limit_req, allowlist, lokasi login), verify-node cek token. | T7 | `infra/test/*.sh` |
| M6-T14 | test-engineer | Suite KVM `dashboard/e2e-kvm/m6-*.spec.ts` + `kvm-harness.ts` (login UI, storageState, ekstraksi token di memori, gelombang); jalankan run `core`, `distro`, `bulk` (§5); `results.json`; ambil fixture log installer nyata → `dashboard/test/fixtures/installer-logs/` (disanitasi + secret sintetis) lalu test AC-6.17; scan bukti. | T7, T8, T12, T15 | `dashboard/e2e-kvm/**`, `.agent/runs/m6/kvm/**`, `dashboard/test/fixtures/installer-logs/**` |
| M6-T15 | test-engineer | **Smoke KVM dini** (setelah T6 + T7, sebelum UI selesai): UEFI Debian 12 dan UEFI Rocky 9 lewat API (sesi bila T2 sudah ada) sampai Done + SSH; Ubuntu jalur gagal `/dev/vdz` → `error-commands`. Tujuan: membuktikan CR-4-6, O11 (paket cukup), SR-5-5(c) sebelum suite penuh. Bukti `.agent/runs/m6/kvm/smoke/`. | T6, T7 | `.agent/runs/m6/kvm/smoke/**` |
| M6-T16 | test-engineer (infra) | **Setelah APR M6** (Orchestrator sudah merge): `infra/net-down.sh` hapus `pxe-test` + `pxe-test-nat`, `cleanup.sh --server --base`, hapus `.agent/keys/*`; snapshot libvirt sebelum/sesudah. | APR M6 | `.agent/runs/m6/teardown.txt` |

Urutan: (T1 ∥ T4 ∥ T6 ∥ T7) → T2 → (T3 ∥ T5) → T15 (smoke, boleh mulai setelah T6+T7) →
(T8 ∥ T9) → (T10 ∥ T11 ∥ T13) → T12 → T14 → review/gate → APR → **T16 terakhir**.

Aturan kerja (pelajaran M5):
- Setiap perbaikan (termasuk perbaikan dari review) disertai test yang **merah bila perbaikan
  di-revert**; test-engineer menjalankan mutasi dan mencatatnya di `.agent/runs/m6/mutation-iter<k>.txt`
  (revert → merah → pulihkan dengan sha256 identik).
- Perbaikan layout/redaksi: dev mengaudit sendiri dengan data ekstrem (lebar §2.8; untuk redaksi:
  korpus probe reviewer M5 + fixture nyata) sebelum menyerahkan; reviewer memeriksa ulang.
- Fakta yang sudah terbukti dipertahankan: iPXE UEFI memakai `exit 1` (bukan `exit`); entry/wait
  `chain --replace --autofree`; node dibuat dengan `virt-install … --install no_install=yes`; token
  tidak boleh masuk config installer mana pun (URL diturunkan dari `/proc/cmdline` saat runtime,
  kontrak B-5) — termasuk unattend Windows sekarang.
- Perubahan pada jalur boot/installer/infra (`installers/**`, `boot-script.ts`, `app/boot/**`,
  `provisioning.ts` jalur ingest, `infra/**`) setelah run KVM resmi → run konfirmasi KVM atas kode
  final (sesuai praktik M5) atau bukti `kvm-path-diff.txt` kosong.

## 4. Acceptance criteria

### Settings & start
- **AC-6.1** (unit + integration + e2e) Env §2.1 ter-parse dengan default/batas; nilai di luar batas
  → error menyebut nama variabel. `GET /api/settings` memuat blok `auth` + `insecureConfirmed`, dan
  respons (rekursif) **tidak** memuat `PXE_ADMIN_PASSWORD_HASH`, substring `scrypt$`, maupun nilai
  hash; halaman Settings menampilkan blok "Akses" read-only (username mono).
- **AC-6.2** (unit + proses) [O3] `NODE_ENV=production` tanpa `PXE_ADMIN_USERNAME`, tanpa
  `PXE_ADMIN_PASSWORD_HASH`, hash format salah, atau `logN=21` → start ditolak (unit: `startOrExit`
  memanggil exit 1; proses: build standalone exit ≠ 0 ≤ 15 dtk, stderr `[pxe] start ditolak:` + nama
  variabel, tanpa nilai hash). Non-production tanpa admin → start, satu peringatan, `POST
  /api/auth/login` apa pun → 401, `GET /api/hosts` → 401.
- **AC-6.3** (unit + proses) SR-5-4/DEC-016 §2 + SR-5-10 [O7]: production + `PXE_INSECURE_NO_LEASE_CHECK=1`
  tanpa konfirmasi → ditolak; konfirmasi `yes`/frasa beda huruf/berspasi → ditolak (pesan menyebut
  kedua variabel); frasa tepat → start + peringatan; non-production tidak terpengaruh. Uji proses juga
  untuk `PXE_TRUST_PROXY=1` tanpa `PXE_DNSMASQ_LEASES` (SR-5-10): exit ≠ 0 + baris penolakan.

### Autentikasi & sesi
- **AC-6.4** (unit) `hashPassword`/`verifyPassword`: round-trip; password salah → false; hash
  rusak/parameter di luar batas (logN 13/21, r 0, keylen ≠ 64) → false tanpa melempar; perbandingan
  memakai `timingSafeEqual` (spy); username tak dikenal tetap menjalankan scrypt (spy). Paritas: hash
  dari `scripts/admin-hash.mjs` (stdin) diverifikasi app dan sebaliknya; helper menolak password < 12
  / > 256 dan tidak mencetak password.
- **AC-6.5** (integration) `POST /api/auth/login`: kredensial benar → 204 + `Set-Cookie pxe_session`
  dengan `HttpOnly`, `SameSite=Strict`, `Path=/`, tanpa `Secure` untuk base URL http dan dengan
  `Secure` untuk https; DB `sessions` hanya berisi `sha256` (nilai cookie tidak ada di DB); password
  salah dan username tak dikenal → 401 dengan body identik; Origin lintas → 403; non-JSON → 415; body
  berkunci tambahan → 400; dua login berurutan → dua ID berbeda dan ID dari cookie request lama
  dihapus.
- **AC-6.6** (integration, jam injeksi) Siklus sesi: idle `PXE_SESSION_IDLE_MIN` + 1 dtk → 401;
  aktivitas sebelum idle memperpanjang (≤ 1 tulis `last_seen_at` per 60 dtk walau 20 request);
  absolut `PXE_SESSION_MAX_HOURS` → 401 walau aktif; logout → 204, cookie `Max-Age=0`, cookie lama →
  401; mengganti `PXE_ADMIN_PASSWORD_HASH` → semua sesi lama 401; sesi kedaluwarsa terhapus oleh
  sweep.
- **AC-6.7** (static + integration) Cakupan: test statis mengenumerasi setiap fungsi `GET|POST|PUT|
  PATCH|DELETE` di `src/app/api/**/route.ts` dan gagal bila ada yang tidak memanggil `guardRead`/
  `guardMutation` (pengecualian tertulis: `auth/login`). Integration: setiap route × method tanpa
  cookie, dengan cookie palsu, dan dengan cookie kedaluwarsa → 401 `Perlu login`, snapshot DB tidak
  berubah; dengan sesi valid → regresi suite M2–M5 lulus. `/boot/**` (ipxe, file, status, log) tetap
  bekerja tanpa cookie (regresi AC-4.x/5.x).
- **AC-6.8** (integration + e2e) Halaman: tanpa sesi, `/`, `/hosts`, `/jobs?host=x`, `/os-images`,
  `/ssh-keys`, `/settings`, `/design` → redirect `/login?next=<path+query>` tanpa merender data;
  `/login`, aset `_next/static`, font tetap 200. `next` berbahaya (`//evil.test`, `/\evil.test`,
  `https://evil.test`, `javascript:alert(1)`, `/login`) → setelah login mendarat di `/hosts`; `next`
  sah → mendarat di path itu.
- **AC-6.9** (integration, fake timers) SSE: tanpa sesi → 401; sesi di-logout saat stream aktif →
  stream mengirim `end` (`reason: session`) dan tutup ≤ 30 dtk; koneksi ke-6 dari sesi yang sama →
  429 sementara sesi lain tetap bisa membuka; batas global 50 → 503 (regresi AC-5.17).

### Rate limit & log penolakan
- **AC-6.10** (integration, jam injeksi) Login: 5 gagal untuk (IP, `admin`) → percobaan ke-6 (bahkan
  dengan password benar) 429 + `Retry-After`; dari IP sama username lain masih bisa sampai total 20
  gagal per IP → 429; setelah jendela lewat → login benar 204; login sukses mereset hitungan; body 429
  identik untuk username ada/tidak ada; `X-Real-IP` hanya dipakai bila `PXE_TRUST_PROXY=1`.
- **AC-6.11** (integration) API: request ke-601 dalam 60 dtk dari satu sesi → 429 + `Retry-After`;
  sesi lain tidak terdampak; request `/boot/**` tidak dihitung.
- **AC-6.12** (unit + integration) SR-5-3 [O6]: 100 penolakan `POST /boot/<x>/<y>/log` dalam 60 dtk →
  ≤ 20 baris detail + tepat 1 baris ringkasan `[boot] 80 penolakan log ditekan dalam 60 dtk` saat
  jendela berganti; jalur lain punya kuota sendiri; setiap baris tetap satu baris, ter-escape, tanpa
  token (regresi AC-5.6).
- **AC-6.13** (static-shell) nginx: `limit_req_zone` `pxe_login` dan `pxe_boot`, `limit_req` di
  `location = /api/auth/login` (dengan allowlist admin) dan `location /boot/`, `limit_req_status 429`;
  `/boot/` dan `/media/` tetap tanpa `allow/deny`; `nginx -t` di `install-dashboard.sh`.

### Redaksi
- **AC-6.14** (unit + integration) CR-5-30/SR-5-19: kasus (a) `pw=\x1b$6$salt\x1b[0msalt$<86>`,
  (b) `\x1b[token=<20>\x1b[0m<23>`, (c) `GET \x1b/boot/<mac>/<5>\x1b[0m<38>`, (d) `\x1b-----BEGIN
  OPENSSH \x1b[0mPRIVATE KEY-----\n<body>` tanpa footer, dan `token=<20>ESC[0mESC<23>` — masing-masing
  sendiri dan bersama secret kedua di body yang sama — lewat `handleLogPost` → DB: tidak ada potongan
  token ≥ 8 karakter, badan hash, maupun baris isi key yang tersimpan. AC-5.13 tetap lulus tanpa
  perubahan ekspektasi.
- **AC-6.15** (unit + integration) SR-5-18/SR-5-20/SR-5-13/CR-5-21: token/hash yang disisipi U+034F,
  U+FE0F, U+3164, U+200B, `\uD800` tunggal, U+E001 (PUA), serta bentuk `\/boot\/…`, `%252F`,
  `/boot%2F…`, `token%3D…`, `\$6\$…`, `$$6$$…`, `%246%24…`, `token=<8..42>` → tersamar; daftar teks
  benign (log apt/subiquity/anaconda contoh, emoji, URL tanpa token) identik; idempoten; batas
  performa 16 KB ≤ 20 ms (`redactSecrets`/`cleanEventMessage`) dan ≤ 50 ms (`handleLogPost`), terbaik
  dari 5.
- **AC-6.16** (unit + static) CR-5-20 (a, b, c) + SR-5-14 + SR-5-15: ekor key berprefiks
  `[  1.234] `, `cloud-init[1234]: `, `2026-11-06T01:02:03Z `; body hanya isi key (≥ 2 baris base64
  64/70) tanpa BEGIN/END; 70 footer yatim dalam satu body → semua tersamar; tabel perilaku
  terdokumentasi di docstring `redact.ts` diuji satu per satu (hasil = yang didokumentasikan);
  docstring `job-events.ts` tidak lagi memuat klaim "tidak lagi meloloskan sisa secret".
- **AC-6.17** (unit, fixture nyata) SR-5-5(c): fixture `test/fixtures/installer-logs/{subiquity-
  server-debug,curtin-install,anaconda,program,di-syslog}.log` dari run KVM M6 (disanitasi, disisipi
  secret sintetis) melalui `handleLogPost` (potongan 16 KB, ≤ 200 baris) → semua secret sintetis
  tersamar; setiap baris tanpa secret tersimpan identik (setelah normalisasi kontrol yang
  terdokumentasi); fixture lolos `secret-scan` (hanya secret sintetis bertanda `FIXTURE`).

### Carry-over backend
- **AC-6.18** (integration) CR-5-3: dengan koneksi kedua memegang `BEGIN IMMEDIATE`, `GET /api/hosts`,
  `GET /api/jobs`, `GET /api/jobs/:id` (tanpa job jatuh tempo) → 200 tanpa `SQLITE_BUSY` dan tanpa
  menunggu lock; dengan job jatuh tempo, sweep tetap menandai `failed` setelah lock dilepas.
- **AC-6.19** (integration + e2e) CR-5-4: cursor opak; halaman 2 setelah job cursor terhapus oleh
  retensi → 200 tanpa duplikat/lompatan; job baru disisipkan di antara dua fetch → gabungan halaman
  tanpa item hilang; cursor rusak → 400. E2E: daftar Jobs dengan > 50 job selama ≥ 3 siklus polling
  tidak menampilkan Alert error.
- **AC-6.20** (e2e) CR-5-5: membuka log job yang tidak ada / terhapus → status final "Job tidak
  ditemukan"; tidak ada request polling lagi selama 15 dtk berikutnya (dihitung via
  `page.on('request')`).
- **AC-6.21** (integration) CR-5-6: event `k` digabung (repeat 1 → 3) saat klien terputus; reconnect
  `Last-Event-ID: k` → event `k` dikirim ulang sekali dengan `repeat: 3`, lalu event `> k`.
- **AC-6.22** (integration) CR-5-7: event identik tiap 30 dtk selama 5 menit → 1 event `repeat=11`
  dengan `lastAt` = kemunculan terakhir; jeda > 60 dtk dari `lastAt` → event baru; migrasi 3 atas DB
  v2 mengisi `last_at = at`; migrasi dua kali tanpa error.
- **AC-6.23** (integration) CR-5-8: job lewat timeout tanpa GET di antaranya → `POST
  /api/hosts/:id/install` → 200 job baru; job lama `failed` `timeout-<tahap>`.
- **AC-6.24** (static/unit tipe) CR-5-9: `expectTypeOf` (atau impor satu sumber) membuktikan tipe
  klien = tipe server untuk `JobSummary`, `JobLogEvent`, `HostLastJob`, `OsImageInfo`, `SshKeyInfo`;
  `failureReason` bertipe `FailureReason | null`; mutasi satu field di sisi server → typecheck merah.
- **AC-6.25** (unit-shell) CR-5-10: `assert-server-logs.sh` dengan `note` berisi `&`, `"`, `\`,
  newline → `server-log-asserts.json` dan `results.json` hasil gabungan valid (di-parse `python3
  -m json.tool`), entri utuh.
- **AC-6.26** (integration) CR-5-11: tick yang melempar → tepat satu baris `[sse] tick gagal:` tanpa
  isi pesan event/token; `SQLITE_BUSY` sekali → retry, stream tetap hidup dan event berikutnya terkirim.
- **AC-6.27** (integration) SR-5-8: `POST`/`PATCH /api/ssh-keys` nama berisi U+202E, U+0007, U+200F,
  U+E000 → 400 per field; `POST /api/os-images` name/version yang sama → 400; nama Unicode biasa
  (`Kunci Budi – lab`) → diterima.

### Generator
- **AC-6.28** (unit) SR-4-6: baris `kernel` preseed diakhiri ` ---` dan `url=…/preseed.cfg` berada
  sebelum `---`; Ubuntu tidak berubah; Rocky tanpa `---` (tetap); test turunan CR-4-4 (AC-5.20) tetap
  lulus untuk ketiga metode.
- **AC-6.29** (unit) CR-4-7/SR-4-3 [O8]: `windowsUnattend()` untuk berbagai konteks tidak memuat
  `/boot/`, token fixture, atau pola `[A-Za-z0-9_-]{43}` — termasuk setelah mendekode setiap
  `-EncodedCommand` (UTF-16LE) dan blob base64; `FirstLogonCommands` diakhiri berurutan: hapus
  Panther/Sysprep unattend, `AutoAdminLogon=0` + hapus `DefaultPassword`, acak password `pxeadmin`,
  `logoff`; `INSTALLER_FILES.unattend` kosong; image `unattend` `bootable:true` → 400; install host
  dengan OS Windows → 422 (regresi). Kontrol positif pemindai diganti input sintetis (dicatat di
  `test-migration.md`).

### UI
- **AC-6.30** (e2e) Desain login: tanpa sidebar/top bar; card `background` putih, `border` 1px
  `#e6e5e0`, `border-radius` 12px, `box-shadow: none`; judul 26px/400; input tinggi 44 px radius 8;
  tombol "Masuk" 40 px dengan background `#f54e00` dan merupakan satu-satunya elemen oranye; field
  username `font-family` JetBrains Mono; label terasosiasi (`getByLabel`); `autocomplete` username/
  current-password; di 375 dan 1440 `scrollWidth` = viewport.
- **AC-6.31** (e2e) Alur login: password salah → Alert `role=alert` "Username atau password salah"
  dan fokus berpindah ke Alert; Enter mengirim form; login benar → `/hosts`; dari
  `/jobs?host=<id>` tanpa sesi → login → kembali ke URL itu; tombol "Keluar" di footer sidebar →
  `/login`, tombol Back browser tidak menampilkan data (API 401 → kembali ke `/login`); username tampil
  mono di footer sidebar.
- **AC-6.32** (e2e, server `m6-session`, idle 1 mnt) Sesi habis saat di `/hosts`: ≤ 90 dtk setelah
  idle lewat → redirect `/login?next=/hosts` tepat sekali, tanpa toast berulang dan tanpa request
  polling setelah redirect; login ulang → kembali ke `/hosts`.
- **AC-6.33** (e2e, server `m6-auth`) Lockout UI: 5 password salah → percobaan ke-6 menampilkan
  "Terlalu banyak percobaan. Coba lagi dalam N menit." (N dari `Retry-After`), tombol tetap aktif,
  tanpa membocorkan apakah username ada.
- **AC-6.34** (e2e) DR-5-10: `/ssh-keys` di 375 dengan key ber-nama 64 karakter dan komentar panjang →
  kontainer daftar `scrollWidth` = `clientWidth`, fingerprint utuh (teks lengkap terlihat, mono),
  tombol rename/hapus terlihat dan dapat diklik tanpa scroll horizontal; di 1440 tetap tabel.
- **AC-6.35** (e2e) DR-5-11 + DR-5-14: path di dalam alasan "tidak tersedia" (tabel OS Images dan kartu
  OS di Sheet) ber-`font-family` JetBrains Mono; di 1280 dengan image stres (ID 48, nama
  ber-underscore 40) token `vmlinuz` dan `ubuntu-22.04` pada alasan bawaan masing-masing berada dalam
  satu baris (rect `Range` per token = 1 baris); path hanya pecah setelah `/`.
- **AC-6.36** (e2e) I-5-9: `document.documentElement.scrollWidth` = viewport di 768, 800, 818, 1024,
  1279, 1280, 1440 untuk `/hosts`, `/jobs`, `/os-images`, `/ssh-keys`, `/settings`, `/login`; status
  DHCP/TFTP/HTTP tetap terlihat di top bar pada setiap lebar ≥ 768.
- **AC-6.37** (e2e) OS Images 768–1279: mode kartu terasersi di 768, 1024, 1279 dan tabel di 1280
  (mutasi breakpoint `xl`→`md` membuat test merah, dicatat di mutasi); DR-5-1: kartu image bawaan di
  375 tinggi ≤ 200 px (setelah `document.fonts.ready`), batas tidak berubah.
- **AC-6.38** (e2e) Aksesibilitas [O10]: axe (`@axe-core/playwright`) pada `/login`, `/hosts` (dengan
  Sheet terbuka), `/jobs` (detail job), `/os-images`, `/ssh-keys`, `/settings` → 0 pelanggaran selain
  `color-contrast` pada pasangan token yang terdaftar di DEC (filter berdasarkan warna terhitung, bukan
  selector); navigasi keyboard login (Tab → username → password → toggle → Masuk) dengan fokus terlihat.
- **AC-6.39** (e2e regresi) Seluruh spec M1–M5 lulus dengan login (`storageState`); `test-migration.md`
  mendaftar setiap file test lama yang berubah + alasan; jumlah asersi per file lama tidak turun
  (skrip hitung terlampir); grep `skip|only|fixme` = 0.

### Infra (unit-shell)
- **AC-6.40** Cleanup selalu tercatat: `kvm-run.sh` (virsh/ssh palsu) yang digagalkan di masing-masing
  tahap preflight, net-up, server-up, deploy, playwright, verify → `results.json` valid dan memuat
  entri `cleanup` (status + ringkasan `libvirt-diff`), exit ≠ 0; run sukses juga memuat entri itu.
- **AC-6.41** `--waves`: dengan `max_nodes` 1, 2, 3 (MemAvailable palsu) dan 3 node bulk, dry-run
  mencetak `node.sh start` dalam gelombang yang benar dan menunggu Done sebelum gelombang berikut;
  tanpa `--waves` 3 node dengan `max_nodes=2` → exit ≠ 0 (perilaku lama); nama terlindungi tetap
  ditolak (regresi AC-5.33).
- **AC-6.42** Deploy admin: password dibuat di `.agent/keys/<run>-admin.pass` mode 0600; dry-run dan
  log deploy (`deploy-dashboard.txt`, `kvm-run.txt`) tidak memuat password maupun hash (dicek
  dengan nilai uji yang diketahui); perintah yang menerima password/hash hanya lewat stdin (tidak
  ada di argv yang dicetak); cleanup menghapus file password; `verify-node.sh` dengan fixture file
  ber-token → mencetak jumlah cocok > 0 dan exit ≠ 0, tanpa mencetak token.

### KVM (syarat gate: bukti KVM milestone ≥ 4)
- **AC-6.43** (kvm) Server & perimeter (run `core`): regresi AC-5.38 (`ss -lunp` hanya dnsmasq di
  `pxe0`, Next hanya `127.0.0.1:3000`, `nginx -t`); dari host 10.99.0.1 tanpa sesi `GET /api/hosts` →
  401 dan `/hosts` → redirect `/login`; dari node (SSH) `GET /api/hosts` → 403; varian SR-5-6 dari node
  (`/boot/%2e%2e/api/hosts`, `/boot/..%2Fapi/hosts`, `/boot/..\api/hosts`, `//api/hosts`,
  `/api/../api/hosts`, `/%61pi/hosts`) → tidak ada yang 200 dengan body berisi MAC node.
- **AC-6.44** (kvm, wajib gate) UEFI Ubuntu 24.04 `pxe-test-m6core-node21` (MAC `…:21`, IP
  `10.99.0.31`) **alur E2E penuh via dashboard dengan login**: login UI → VM PXE boot → host muncul
  tanpa reload → Sheet: hostname `m6-node21`, IP statis/prefix/gateway/DNS, credentials (password
  generator, sudoer, nonaktifkan login password SSH), SSH key ed25519 sekali pakai → "Simpan & Install"
  (AlertDialog) → Booting → Installing → Configuring → Done ≤ 30 mnt tanpa reload; verifikasi SSH:
  hostname, `ip -4 addr` pada NIC MAC `…:21`, gateway, DNS, user + `sudo -n true`, `authorized_keys`
  tepat key itu, `sshd -T` `passwordauthentication no`, login password ditolak; target bebas token
  (§2.9); `reboot` → boot dari disk tanpa kernel installer baru di serial, status tetap Done, jumlah
  job sesuai.
- **AC-6.45** (kvm) Jalur gagal nyata (SR-5-5(c)), node21 sebelum AC-6.44: konfigurasi dengan disk
  target `/dev/vdz` → Failed `installer-error` ≤ 15 mnt; job log memuat ≥ 1 event `installer` dari
  `error-commands` (tail log) dan ekspor `jobs-node21.json` tidak memuat token/hash/private key (teks &
  base64); lalu install ulang dengan disk otomatis = AC-6.44 (riwayat host 2 job).
- **AC-6.46** (kvm, wajib gate) BIOS Ubuntu 24.04 `pxe-test-m6core-node22` (`10.99.0.32`), uji negatif
  `virsh destroy`: Installing teramati + event installer pertama → `node.sh poweroff` → `start` → boot
  lokal (kernel installer tetap 1, `installerBoots` 1) → Failed `timeout-installing` di UI tanpa
  reload → Install ulang → Done ≤ 30 mnt → verifikasi SSH paritas AC-6.44 → reboot tanpa reinstall,
  jumlah job 2.
- **AC-6.47** (kvm) Uji negatif di server nyata (run `core`, dengan sesi): (a) IP bentrok — UI: set IP
  node22 = `10.99.0.31` (milik node21) → error field, tidak tersimpan; API `PATCH` yang sama → 409/422;
  IP yang sedang dipegang lease aktif host lain → ditolak; (b) CSV credentials berisi MAC tidak valid +
  MAC tak dikenal + baris valid → error per baris di preview, tombol simpan nonaktif / API 422, konfigurasi
  semua host identik sebelum/sesudah (dibandingkan via API); (c) config per-MAC: dengan token node21
  yang diambil di memori dari serial saat Installing, `GET /boot/<mac21>/<token>/user-data` dari host
  10.99.0.1 → 404, dari node22 via SSH → 404, `GET /boot/<mac22>/<token21>/user-data` → 404, token acak
  → 404; jumlah event/token job node21 tidak berubah; nginx log mencatat 404 tersebut.
- **AC-6.48** (kvm) UEFI Debian 12 preseed `pxe-test-m6distro-node23` (`10.99.0.33`): alur penuh via
  dashboard dengan login → Done ≤ 30 mnt; event installer `preseed/early_command`, `late_command`,
  first-boot tiba berurutan (CR-4-6: URL dari `/proc/cmdline` di d-i/chroot bekerja); verifikasi SSH
  paritas AC-6.44; target bebas token termasuk `/etc/default/grub`, `/boot/grub/grub.cfg`,
  `/proc/cmdline` (SR-4-6); reboot tanpa reinstall.
- **AC-6.49** (kvm) UEFI Rocky 9 kickstart `pxe-test-m6distro-node24` (`10.99.0.34`): sama dengan
  AC-6.48 untuk `%pre`/`%post`/first-boot; target bebas token termasuk `/etc/default/grub`,
  `/boot/loader/entries/*.conf`, `/etc/kernel/cmdline`, `/root/anaconda-ks.cfg`.
- **AC-6.50** (kvm) Bulk 3× UEFI Ubuntu `pxe-test-m6bulk-node25..27` [O12]: ketiga node PXE boot
  sekali → muncul di tabel → `poweroff`; pilih ketiganya → bulk credentials mode B (password acak unik,
  CSV diunduh sekali; tombol unduh tidak tersedia lagi), bulk IP mulai `10.99.0.35` + increment
  (preview MAC → IP), hostname template `m6-bulk-{index:02}` (preview, tanpa duplikat), inject SSH key →
  satu "Simpan & Install" untuk 3 host → `start` per gelombang `max_nodes` (dicatat) → ketiganya Done ≤
  30 mnt sejak masing-masing dinyalakan; verifikasi SSH tiap node (hostname/IP sesuai preview, key
  login, sudo, password login ditolak); `limit_req /boot/` tidak menolak request installer sah (nginx
  log tanpa 429 untuk IP node).
- **AC-6.51** (kvm) Rate limit & SR-5-3 nyata (run `core`): dari host, 6 login gagal untuk username
  `bruteuser` → ke-6 429 (app atau nginx), login admin sesudahnya tetap berhasil; dari node22, 300
  `POST /boot/zz/zz/log` dalam 10 dtk → journal `pxe-dashboard` memuat ≤ 20 baris `[boot] tolak` per
  menit + baris ringkasan, sebagian request mendapat 429 dari nginx; node21 yang sedang menginstal
  tidak terdampak (progress status normal).
- **AC-6.52** (kvm) Cleanup & bukti per run (`core`, `distro`, `bulk`, juga smoke): `results.json` memuat
  status + durasi setiap AC kvm + entri `cleanup`; tidak ada VM `pxe-test-m6*-*` maupun disknya;
  `pxe-test-node01`, `ubuntu24.04`, `default`, `int` identik di `libvirt-before/after`; key sekali pakai
  dan password admin run dihapus; seluruh `.agent/runs/m6/**` lolos scan: tanpa password run, password
  admin, hash admin (`scrypt$`), token, `$6$`, private key (teks & base64).

### Dokumentasi & penutupan
- **AC-6.53** (static) `infra/README.md` memuat §"Asumsi keamanan" (LAN terisolasi, HTTP polos, cookie
  tanpa `Secure` di lab, login + rate limit + allowlist, sisa risiko SR-4-7(b)); `.env.example` memuat
  semua variabel §2.1 dengan nilai kosong/dummy (tanpa hash nyata) dan peringatan
  `PXE_INSECURE_NO_LEASE_CHECK_CONFIRM`; `git grep` di HEAD tidak menemukan string `scrypt$` selain
  fixture uji bertanda.
- **AC-6.54** (infra, setelah APR M6) Teardown: `virsh net-list --all` tidak memuat `pxe-test` dan
  `pxe-test-nat`; `default` dan `int` identik sebelum/sesudah; tidak ada domain `pxe-test-*` selain
  `pxe-test-node01` (milik user, tidak disentuh); `.agent/vms/pxe-test-server*` dan `.agent/keys/*`
  hilang; bukti `.agent/runs/m6/teardown.txt`.

Total: **54 AC**. Per jenis (AC gabungan dihitung di setiap jenisnya): unit 12 · integration 18 ·
e2e 14 · proses 2 · static 4 · unit-shell/static-shell 5 · kvm 10 (AC-6.44 dan AC-6.46 wajib gate;
seluruh AC kvm wajib untuk "E2E penuh") · infra 1 (AC-6.54, setelah approval, tidak dinilai gate M6
tetapi wajib sebelum `REPORT-final.md`).

## 5. Matriks & cakupan KVM M6

Batas resource: VM paralel = clamp((RAM bebas − 4 GB)/2 GB, 1, 3) dengan RAM server (3 GB) dikurangkan
(`kvm-run.sh`). Preflight dijalankan ulang di awal setiap run → `kvm-run-preflight.txt`; nilai
`max_nodes` menentukan paralelisme. Timeout 30 mnt/VM. IP node = `10.99.0.(10+NN)`.

| Run | Skenario (urutan) | Node (fw, OS) | AC | Paralel | Estimasi |
|---|---|---|---|---|---|
| smoke (T15) | Debian & Rocky lewat API → Done + SSH; Ubuntu `/dev/vdz` → `error-commands` | 41 UEFI Debian, 42 UEFI Rocky, 43 UEFI Ubuntu | (bukti dini, bukan AC) | ≤ `max_nodes` | ±50 mnt |
| `core` | Perimeter; node21 jalur gagal → install ulang penuh (login, Sheet, SSH, reboot); node22 destroy → Failed → install ulang → Done + SSH; uji negatif IP/CSV/config per-MAC; rate limit & SR-5-3 | 21 UEFI Ubuntu, 22 BIOS Ubuntu | 6.43–6.47, 6.51, 6.52 | 2 bila `max_nodes ≥ 2`, selain itu berurutan | ±60 mnt (paralel) / ±100 mnt |
| `distro` | Debian 12 preseed; Rocky 9 kickstart; alur penuh + target bebas token | 23 UEFI Debian, 24 UEFI Rocky | 6.48, 6.49, 6.52 | 2 bila mungkin | ±45 / ±70 mnt |
| `bulk` | discover → poweroff → bulk UI (cred B, IP range, template, key) → start bergelombang | 25, 26, 27 UEFI Ubuntu | 6.50, 6.52 | gelombang `max_nodes` | ±40–60 mnt |

Matriks CLAUDE.md → bukti: BIOS Ubuntu 24.04 (node22), UEFI Ubuntu 24.04 (node21), UEFI Debian 12
preseed (node23), UEFI Rocky 9 kickstart (node24), bulk 3× UEFI Ubuntu (node25–27); Windows:
generator + unit test (AC-6.29). Uji negatif: IP bentrok UI+API (AC-6.47a), CSV MAC invalid
(AC-6.47b), `virsh destroy` → Failed → install ulang (AC-6.46), config per-MAC dari MAC/IP salah
(AC-6.47c). Media: hanya dari `.agent/media/` yang sudah ada (O11-A); node tetap di `pxe-test`
terisolasi; `pxe-test-nat` hanya untuk VM server. Bila `max_nodes = 1`, semua run tetap bisa jalan
berurutan (durasi dicatat).

## 6. Risiko

| ID | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Login memecah test E2E lama (cookie `localhost` dibagi lintas port, readiness URL) | Suite merah massal / godaan melemahkan test | `storageState` per server (O13), readiness `/login`, `test-migration.md` + hitung asersi; gate menolak bypass |
| R2 | Proxy Next 16 tidak mencakup route tertentu (matcher) | Halaman/API bolong | Penegakan di handler sebagai sumber kebenaran + test statis enumerasi + matriks integration (AC-6.7/6.8) |
| R3 | Lab HTTP: cookie tanpa `Secure`, sesi bisa disadap di LAN | Pengambilalihan sesi oleh penyadap aktif | Allowlist IP admin tetap, `SameSite=Strict`, idle 120 mnt; dokumentasi asumsi (SR-4-8); HTTPS di luar cakupan |
| R4 | Rate limit / `limit_req` terlalu ketat → installer bulk atau polling UI kena 429 | Install gagal / UI error | Nilai longgar untuk `/boot/` dan per sesi; bulk KVM memverifikasi tanpa 429 (AC-6.50); UI menangani 429 dengan mundur |
| R5 | Lockout login memblokir admin sah (penyerang di IP sama) | DoS login | Kunci per (IP, username) + per IP; jendela 15 mnt; restart menghapus; allowlist IP admin membatasi siapa yang bisa mencoba |
| R6 | Perbaikan redaksi memicu regresi (pola M5 iter2–3) | Kebocoran baru / over-redaksi / ReDoS | Mutasi wajib per butir, korpus probe reviewer M5 sebagai fixture, fixture nyata, batas performa tetap |
| R7 | Debian/Rocky gagal offline (paket kurang, versi kernel netboot ≠ DVD, `:` di URL `inst.ks`, `/proc/cmdline` di chroot) | Run `distro` gagal | Smoke dini T15; cadangan O11-C (repo tambahan dari mirror resmi); perubahan bentuk path hanya via decision |
| R8 | Resource tidak cukup untuk bulk paralel | Bulk lambat / timeout Booting | Mode gelombang; timeout Booting dari env KVM dinaikkan bila perlu (dicatat); `MemAvailable` dicatat |
| R9 | Durasi KVM total (±3 jam) × hingga 3 iterasi gate | Siklus lambat | Run terpisah; hanya run yang terdampak perubahan diulang (berdasarkan `kvm-path-diff.txt`); smoke dini; base disk server dipakai ulang sampai T16 |
| R10 | Ekstraksi token dari serial untuk uji negatif membocorkan token ke bukti | Secret di repo | Token hanya di memori; redaksi bukti + scan tetap; AC-6.52 |
| R11 | Jalur gagal `/dev/vdz` tidak memicu `error-commands` subiquity (mis. error sebelum autoinstall dimuat) | SR-5-5(c) tidak terbukti | Smoke dini; alternatif pemicu gagal yang dikendalikan dari UI (mis. layout partisi custom invalid) — dicatat sebagai temuan, bukan seam produk |
| R12 | Perubahan layout (login, footer sidebar, top bar I-5-9) menggeser margin DR-5-1 (199/200) atau regresi M5 | Gate design gagal | Audit mandiri data ekstrem; asersi DR-5-1 tetap; batas tidak dinaikkan tanpa decision |
| R13 | Hash scrypt mahal (32 MB × login paralel) dipakai untuk DoS memori | OOM VM server | Rate limit login sebelum verifikasi berat; parameter dibatasi; `limit_req` nginx login |
| R14 | Sesi menambah tulis SQLite (polling 5 dtk × tab) | `SQLITE_BUSY` | Perpanjangan maks 1×/60 dtk; CR-5-3 sweep tanpa tx; WAL + `busy_timeout` |
| R15 | Teardown network di akhir menghalangi run KVM ulang bila ada iterasi pasca-approval | Harus membuat ulang network | T16 hanya setelah APR M6; `net-up.sh` idempoten bila dibutuhkan lagi |

## 7. Trace carry-over → task/AC

| Kewajiban | Task | AC |
|---|---|---|
| **Gate M6** SR-4-1 login admin | T1, T2, T8, T11, T12, T14 | 6.2, 6.4–6.9, 6.30–6.32, 6.43, 6.44 |
| **Gate M6** SR-4-1 rate limit | T3, T7, T11, T12, T14 | 6.10, 6.11, 6.13, 6.33, 6.51 |
| **Gate M6** SR-5-3 log penolakan `/boot` | T3, T7, T10, T14 | 6.12, 6.13, 6.51 |
| **Gate M6** SR-5-4 / DEC-016 §2 | T1, T10, T11 | 6.3 |
| CR-5-30 + SR-5-19 (+ docstring `job-events.ts:106`) | T4, T10, T11 | 6.14, 6.16 |
| SR-5-18 / SR-5-20 / SR-5-13 / CR-5-21 | T4, T10, T11 | 6.15 |
| CR-5-20 (a, b, c) + SR-5-5(c) fixture nyata | T4, T14, T15 | 6.16, 6.17, 6.45 |
| SR-5-14 (opsional, direncanakan) / SR-5-15 (dokumentasi) | T4, T7, T10 | 6.16, 6.53 |
| CR-5-3, 5-4, 5-5, 5-6, 5-7, 5-8, 5-9, 5-10, 5-11 | T5, T7, T8, T9, T11, T12, T13 | 6.18–6.26 |
| SR-5-6 / SR-5-7 / SR-5-8 / SR-5-10 | T2, T5, T7, T11, T14 | 6.43 / 6.9 / 6.27 / 6.3 |
| CR-4-6 / SR-4-6 KVM Debian + Rocky + bulk | T6, T14, T15 | 6.28, 6.48, 6.49, 6.50 |
| CR-4-7 / SR-4-3 unattend Windows | T6, T10 | 6.29 |
| DR-5-10 / DR-5-11 / DR-5-14 / I-5-9 | T9, T12 | 6.34 / 6.35 / 6.35 / 6.36 |
| E2E OS Images 768–1279 + pantau DR-5-1 | T12 | 6.37 |
| I-5-6 WCAG (decision) | T9, T12 | 6.38 |
| Opsional I-5-13/14/16, CR-5-27/32/34/35/36 | T4, T9, T12 | OPT-* (bila dikerjakan) |
| Harness: entri cleanup selalu ke `results.json` (termasuk run parsial) | T7, T13, T14 | 6.40, 6.52 |
| Bukti libvirt sebelum/sesudah; resource terlindungi | T7, T14, T16 | 6.52, 6.54 |
| Hapus network `pxe-test` + `pxe-test-nat` di akhir | T16 | 6.54 |
| E2E penuh (alur dashboard + login, SSH, semua uji negatif) | T12, T14 | 6.39, 6.44–6.50 |
| Adaptasi E2E lama tanpa pelemahan | T12 | 6.39 |
| Login page mengikuti design system | T8, T12 | 6.30 |
| SR-4-8 dokumentasi LAN/HTTPS, SR-4-7 dokumentasi | T7 | 6.53 |

## 8. Kandidat decision (untuk Orchestrator)

1. **Auth (O1–O4)**: sesi server-side SQLite + cookie opak HttpOnly/SameSite=Strict; scrypt
   `node:crypto`; admin dari env (`PXE_ADMIN_USERNAME` + `PXE_ADMIN_PASSWORD_HASH`), production tanpa
   admin → tolak start; Proxy + `requireSession` di setiap handler; menambah tabel `sessions` ke model
   SPEC §5. Rekomendasi: terima.
2. **Rate limit (O5/O6)**: di aplikasi (login per IP+username & per IP, API per sesi, SSE per sesi) +
   nginx `limit_req` login & `/boot/`; throttle log penolakan 20/menit + ringkasan.
3. **SR-5-4 (O7)**: konfirmasi kedua `PXE_INSECURE_NO_LEASE_CHECK_CONFIRM=I_UNDERSTAND_CONFIG_LEAKS`
   (sesuai DEC-016 §2); alternatif lebih ketat: selalu tolak.
4. **Windows (O8)**: tetap tidak dilayani; generator dikeraskan (tanpa token/URL, cleanup Panther,
   AutoLogon off, logoff); status Windows tidak didukung.
5. **Cakupan (O9)**: Offline otomatis dan registrasi OS image dari URL tetap di luar cakupan; dicatat
   sebagai deviasi SPEC §4/§1 di `REPORT-final.md`.
6. **WCAG (O10)**: AA kecuali kontras token SPEC terdaftar (`muted`/putih, `muted`/kanvas,
   `muted-soft` placeholder, `on-primary`/`primary`); tanpa mengubah SPEC; axe di E2E.
7. **KVM Debian/Rocky (O11)**: offline dari media lokal yang ada; cadangan repo tambahan dari mirror
   resmi (disetujui sebelumnya); tanpa NAT untuk node.
8. **Struktur KVM (O12)**: run `core`/`distro`/`bulk` terpisah; bulk = discover → poweroff → bulk UI →
   start bergelombang `max_nodes`; boleh menaikkan `PXE_JOB_BOOTING_TIMEOUT_MIN` di env KVM bila
   gelombang > 60 mnt.
9. **E2E (O13)**: `storageState` per server; tanpa env bypass; `test-migration.md` + hitung asersi.
10. **Redaksi (O14)**: perluasan peta-indeks + normalisasi; fixture nyata dari KVM M6.
11. **Teardown**: T16 dijalankan test-engineer setelah APR M6 dan sebelum `REPORT-final.md`; base disk
    server & key ikut dihapus, media dipertahankan.
