# M6 — migrasi test lama (backend-dev, T1–T3, T5)

Alasan umum: sejak M6 semua `/api/**` (kecuali `POST /api/auth/login`) butuh sesi admin (DEC-017 §4).
Test lama yang memanggil handler API kini membawa **sesi sungguhan**: admin test (username
`testadmin`, password acak per worker, hash scrypt dihitung saat runtime — tidak ada hash/password di
repo) dipasang oleh `isolateEnv`, dan cookie dibuat lewat `createSession` di DB lalu divalidasi oleh
guard produksi. **Tidak ada env/flag bypass auth**; guard tidak punya jalur khusus test.

Penegakan sesi diletakkan SETELAH pemeriksaan Host/Origin/Content-Type, sehingga test lama yang
mengasersi 403/415 tanpa cookie tidak perlu diubah dan tetap menguji perilaku yang sama.

## Helper (bukan file test, tapi memengaruhi semua test node)

| File | Perubahan | Alasan |
|---|---|---|
| `dashboard/src/test/auth.ts` (baru) | `TEST_ADMIN_*`, `testAdminHash()`, `sessionCookie()`, `authHeaders()` | sesi sungguhan untuk test |
| `dashboard/src/test/env.ts` | `isolateEnv` memasang env admin test sebagai default (dapat ditimpa `defaults`), reset rate limiter, throttle log `/boot`, penghitung SSE per test | state in-memory per proses tidak bocor antar test; env admin wajib untuk sesi |
| `dashboard/src/test/route.ts` | `getReq`/`jsonReq` menyertakan cookie sesi sungguhan (kecuali header `cookie` diberikan); `anonGetReq`/`anonJsonReq` baru untuk request tanpa sesi | semua route API butuh sesi |
| `dashboard/src/lib/server/db/reset.ts` (kode) | `resetDb` juga mengosongkan `sessions` | isolasi antar test |

## File test lama yang berubah

Hitungan asersi = jumlah `expect(` + `expectTypeOf(` (HEAD `31c506e` → working tree).
Perintah: `git show HEAD:<f> | grep -o 'expect(\|expectTypeOf(' | wc -l` vs file kerja.

| File | Sebelum | Sesudah | Perubahan & alasan |
|---|---:|---:|---|
| `src/app/api/iter2-routes.test.ts` | 75 | 75 | helper `rawReq` + request stream 1 MB menyertakan `authHeaders()` (sesi) — pemeriksaan 413/415/422 sesudah guard tetap teruji |
| `src/app/api/m4-api-routes.test.ts` | 74 | 75 | ekspektasi `toEqual` respons `/api/settings` ditambah `insecureConfirmed` + blok `auth` (AC-6.1); asersi baru: respons tidak memuat hash admin |
| `src/app/api/m5-jobs-api.test.ts` | 44 | 45 | (a) CR-5-6 / AC-6.21 (perubahan perilaku yang diputuskan plan §2.6): resume `Last-Event-ID: 1` kini mengirim ulang event 1 **tepat sekali** sebagai frame pertama; asersi lama `not.toContain("id: 1\n")` diganti `match(/\nid: 1\n/g)` panjang 1 + urutan sebelum id 2 (lebih ketat); (b) request SSE mentah + `authHeaders()` |
| `src/app/api/m5-te-api.test.ts` | 140 | 140 | request mentah (`new Request`) + `authHeaders()`; data frame SSE yang dibandingkan `toEqual` ditambah `lastAt` (CR-5-7, field kontrak baru); test resume `Last-Event-ID: 3` kini mengharapkan `[3, 4, …]` (CR-5-6) — nama test disesuaikan |
| `src/app/boot/boot-routes.test.ts` | 182 | 182 | test "log server tidak memuat token": `hostDELETE` + sesi; **bug test lama diperbaiki**: `vi.stubEnv("VITEST","")` membuat `PXE_DB_PATH` kosong jatuh ke file `./data/pxe.db` yang persisten antar run (test lulus hanya bila file belum ada) → dikunci `PXE_DB_PATH=:memory:` (DB yang sama yang di-reset `withDb`) |
| `src/components/jobs/jobs-components.test.tsx` | 19 | 19 | fixture `JobLogEvent` + `lastAt` (tipe wajib, CR-5-7/CR-5-9); asersi tidak berubah |
| `src/hooks/m4-hooks.test.ts` | 39 | 39 | fixture `OsImageInfo` + field M5 wajib (CR-5-9: tipe klien = tipe server, field tidak lagi opsional); asersi tidak berubah |
| `src/hooks/m5-jobs-hooks.test.ts` | 55 | 55 | fixture `ev()` + `lastAt` (= `at`); asersi tidak berubah |
| `src/lib/jobs.test.ts` | 49 | 49 | fixture `ev()` + `lastAt`; ekspektasi normalisasi `parseLogEvent` ditambah `lastAt` default = `at` |
| `src/lib/server/db/db.test.ts` | 152 | 152 | daftar tabel + `sessions`, indeks + `sessions_expires`, `schema_migrations` + versi 3 (migrasi 3 hanya menambah) |
| `src/lib/server/db/m5-jobs-repo.test.ts` | 43 | 47 | (a) test migrasi 2 membatasi `runMigrations` ke versi ≤ 2 (tetap menguji transisi v1→v2 persis); (b) CR-5-7 / AC-6.22 (perubahan perilaku dari plan): jendela gabung dihitung dari kemunculan **terakhir** — event `at(63)` kini digabung (repeat 3), event baru di `at(124)`; asersi baru untuk `lastAt` |
| `src/lib/server/db/m5-te-migration.test.ts` | 16 | 16 | `runMigrations` dibatasi ≤ v2 (test khusus transisi v1→v2); asersi identik |
| `src/lib/server/http.test.ts` | 44 | 44 | request `guardMutation` yang diharapkan `null` (lolos) kini membawa sesi |
| `src/lib/server/m5-settings.test.ts` | 29 | 29 | request `guardRead` yang diharapkan `null` membawa sesi |
| `src/lib/server/m5-te-unit.test.ts` | 58 | 60 | `infra/server/dashboard.env` kini memuat placeholder `@PXE_ADMIN_PASSWORD_HASH@` (hash disisipkan saat deploy, AC-6.53): asersi baru bahwa placeholder apa adanya DITOLAK settings; validasi nilai KVM lain memakai hash runtime |
| `src/lib/server/settings.test.ts` | 32 | 32 | ekspektasi `toEqual` respons settings + `insecureConfirmed` dan blok `auth` (admin tidak dikonfigurasi pada objek env itu) |

Tidak ada test yang dihapus, di-skip, atau dilonggarkan; `grep -n "\.skip\|\.only\|fixme"` pada file di
atas = 0. Test baru M6 (bukan migrasi): `src/lib/server/auth/{password,session,rate-limit}.test.ts`,
`src/app/api/auth/auth-routes.test.ts`, `src/app/api/m6-auth-matrix.test.ts`,
`src/app/api/m6-carryover-api.test.ts`, `src/lib/server/m6-backend.test.ts`, `src/lib/auth-next.test.ts`.

## Mutasi mandiri (revert → merah → dipulihkan, sha256 identik; skrip di scratchpad dev)

| Mutasi | Test yang merah |
|---|---|
| `sweepJobs` tanpa pra-cek (selalu `BEGIN IMMEDIATE`, CR-5-3) | `m6-carryover-api` CR-5-3 |
| percobaan login tidak dicatat sebelum verifikasi | `auth-routes` (lockout + race paralel) |
| sanitizer `next` tanpa lookahead `(?![/\\])` | `auth-next` |
| `guardMutation` membalik pengecualian `session:false` | `m6-auth-matrix` |
| SSE resume memakai `repeat` DB (perilaku lama, CR-5-6) | `m6-carryover-api` CR-5-6 |
| `installHosts` tanpa `sweepJobs` (CR-5-8) | `m6-carryover-api` CR-5-8 |
| sesi tanpa pemeriksaan sidik kredensial | `session.test` |
| SR-5-8 hanya menolak `\p{Cc}` | `m6-carryover-api` SR-5-8 |
| `logBootDenied` tanpa throttle (SR-5-3) | `m6-backend` SR-5-3 |

## T4 — redaksi (backend-dev)

Kode: `dashboard/src/lib/server/redact.ts` (pipeline pembersihan + redaksi dipindah dari
`db/repos/job-events.ts`, yang kini hanya mengekspor ulang `stripControl`/`stripAnsi`/`cleanAndRedact`).
Test baru: `dashboard/src/lib/server/m6-redact.test.ts` (AC-6.14..6.17), harness
`dashboard/src/test/installer-logs.ts`, fixture template sintetis
`dashboard/src/test/installer-logs/synthetic/*.log`. Mutasi: `.agent/runs/m6/mutation-dev-T4.txt`.

### Perubahan test lama (semuanya pengetatan atau mengikuti perilaku yang diwajibkan plan §2.5)
| File › test | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `m5-iter2-redact-timeout.test.ts` › "negatif: segmen 44 karakter, …, `token=` pendek …" | `"token=terlalu-pendek"` (17) diharapkan identik | `"token=pendek7"` (7) diharapkan identik; `"token=terlalu-pendek"` → `token=[REDACTED]` diasersikan di `m6-redact.test.ts` | Plan §2.5 butir 1 / AC-6.15: `TOKEN_KV_RE` parsial `{8,43}` (CR-5-21/CR-5-30). Batas negatif kini tepat di bawah ambang 8. |
| `m5-te-unit.test.ts` › AC-5.14 "teks tanpa secret identik" | `"token=terlalu-pendek"` | `"token=pendek7"` | Sama seperti baris di atas. |
| `m5-iter2-redact-timeout.test.ts` › SR-5-1 "cleanEventMessage: …" (7 kasus) | kontrol: `sanitizeMessage(redactSecrets(input))` ≠ hasil benar ("urutan lama bocor") | kontrol: `sanitizeMessage(<deteksi pola mentah secretMarks>)` ≠ hasil benar, ditambah `redactSecrets(input)` tidak memuat potongan token | `redactSecrets` sendiri kini membuang kontrol C0/C1 di salinan pencocokannya (SR-5-18), jadi tidak lagi bocor. Kontrolnya dipindah ke deteksi pola mentah agar tetap membuktikan urutan sanitasi; ekspektasi utama (`cleanEventMessage` = hasil benar) tidak berubah. |
| `m5-iter3-redact.test.ts` › "stripAnsi: … OSC tanpa terminator …" | `stripAnsi("a ESC]0;tanpa-akhir\nbaris2")` = `"a0;tanpa-akhir\nbaris2"` | `stripAnsi(...)` = masukan apa adanya; `stripControl(stripAnsi(...), true)` = `"a]0;tanpa-akhir\nbaris2"` | Plan §2.5 butir 1 / gate M5: alternatif ke-4 `ANSI_RE` wajib ber-intermediate (`\x1b[ -/]+[0-~]`), sehingga `ESC]` tanpa terminator tidak lagi menelan `]`. Asersi inti (baris berikutnya utuh) tetap. |

Tidak ada test yang dihapus, di-skip, atau dilonggarkan batasnya. Ekspektasi AC-5.13 (`dua[31m merah\tkolom`)
tidak berubah. Batas performa SR-5-11 (≤ 20 ms / ≤ 50 ms, terbaik dari 5) tidak diubah; kasus 16 KB baru
(persen, backslash, `$`, ESC+SGR, karakter tak terlihat, isi key, footer berulang) ditambahkan dengan batas
yang sama.

### Perilaku yang berubah (bukan test)
- `cleanAndRedact`: empat salinan tampilan (`plain`, `bare`, `sgr`, `greedy`) + salinan pencocokan
  ternormalisasi untuk masing-masing; tanda digabung per karakter mentah. Render dari `bare` → `sgr` →
  `greedy` → `plain` (yang pertama memuat secret).
- `greedy` (pola ANSI M5) ditambahkan karena pembatasan alternatif ke-4 (wajib plan) membuat `ESC7`/`ESCc`
  di tengah token menyisakan satu karakter di semua salinan lain → token 44 karakter tidak dikenali. Probe
  "ESC7 (tanpa intermediate) di token" menangkapnya (mutasi T4-M4: 6 merah).
- `redactSecrets` = render dari tanda salinan mentah + salinan pencocokan (dulu: penggantian regex
  berantai). Keluaran untuk semua kasus M5 identik (test M5 lulus tanpa perubahan ekspektasi selain di tabel).

### Fixture log installer (AC-6.17)
- Sekarang: template SINTETIS (`subiquity-server-debug`, `curtin-install`, `anaconda`, `program`,
  `di-syslog`) dengan placeholder `{{TOKEN}}`/`{{HASH}}`/`{{KEY}}`/`{{KEY_BODY}}`/`{{MAC}}`/`{{ESC}}`. File
  tidak memuat secret apa pun; secret sintetis diisi saat test.
- **Menunggu fixture nyata** (T14, run KVM M6): ambil log dari run setelah `redact-evidence.sh`, ganti
  token/hash/key yang sudah tersamar dengan placeholder yang sama, simpan ke direktori lain lalu tambahkan ke
  `listFixtures(...)` di `m6-redact.test.ts` (harness `checkStored` sama).
- Mode "potongan 7 baris" memisahkan baris akhir isi key (< 16 karakter) ke request berikutnya. Itu sisa
  risiko yang terdokumentasi, sehingga `checkStored` mengizinkannya maksimal 1 kali, hanya untuk mode itu
  dan hanya untuk fixture yang memuat `{{KEY_BODY}}`. Harness punya kontrol positif yang memastikan tanpa
  izin itu kasus yang sama dianggap gagal.

### Sisa risiko (terdokumentasi di header `redact.ts`, diuji sebagai "perilaku terdokumentasi")
- Token/hash ter-wrap ke baris berikutnya; prefiks token 1–7 karakter; `<token>X` (rangkaian ≥ 44, sengaja
  bukan token sejak AC-5.14).
- Isi key yang hanya satu baris per request tanpa BEGIN/END (rangkaian < 2); baris akhir pendek isi key
  yang terpisah ke request berikutnya.
- Prefiks log di luar `LOG_PREFIX_RE`; homoglyph; encoding selain persen/JSON/backslash (base32, hex, HTML
  entity).
- Over-redaksi yang diterima: `awk '{print $6$7}'`, BEGIN tanpa footer, footer yatim, path BLS machine-id,
  `token=<8+ karakter>` non-token, isi sertifikat PEM tanpa header (≥ 2 baris 64 kolom), emoji ber-ZWJ.

## T6 — generator (backend-dev)

| File › test | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `installers/installers.test.ts` › B-5 "Ubuntu/Debian/Rocky: token tidak muncul …" | kontrol positif: `containsSecret(windowsUnattend(ctx()), TOKEN)` = **true** | `= false`, ditambah kontrol positif sintetis: `-EncodedCommand` UTF-16LE berisi URL ber-token → `true` | DEC-017 §8 / O8: unattend tidak lagi memuat URL/token. Kontrol positif pemindai dipertahankan dengan input sintetis (pengetatan). |
| `installers/installers.test.ts` › AC-4.21 "FirstLogonCommands: …" | perintah terakhir memuat `-Body 'stage=done' -Uri '<CALLBACK>'` | empat perintah terakhir = hapus Panther/Sysprep, `AutoAdminLogon '0'`, `Set-LocalUser 'pxeadmin'`, `logoff`; seluruh perintah tidak memuat CALLBACK | Sama (CR-4-7/SR-4-3). |
| `installers/installers.test.ts` helper `psDecode` | `exec(...)!` (crash untuk perintah polos) | perintah tanpa `-EncodedCommand` (`logoff`) dikembalikan apa adanya | Perintah `logoff` bukan PowerShell ter-encode. |
| `test/golden/installers/windows-unattend.xml` | 5 SynchronousCommand (terakhir callback) | 8 (callback dihapus; + 3 pembersihan ter-encode + `logoff`) | Golden diperbarui (plan §2.7). |
| `boot-script.test.ts` › "Debian: netboot + preseed/url" | baris kernel tanpa ` ---` | diakhiri ` ---` | SR-4-6 (AC-6.28). |
| `app/boot/boot-routes.test.ts` › AC-4.16 snapshot Debian | baris kernel tanpa ` ---` | diakhiri ` ---` | SR-4-6. Satu baris snapshot di file bersama; hunk lain di file itu milik agent auth. |

Test baru: `installers/m6-generator.test.ts` (AC-6.28, AC-6.29; termasuk regresi `installHosts` Windows →
gagal "hanya generator", tanpa job; `newOsImagePayload` unattend `bootable:true` ditolak).

## T8/T9 — UI login, sesi habis, carry-over UI (frontend-dev)

| File › test | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `components/status-pill.test.tsx` › "offline memakai kelas netral (tanpa pastel stage)" | `toMatch(/\btext-muted-foreground\b/)` | `toMatch(/\btext-body\b/)` + `not.toMatch(/\btext-muted-foreground\b/)` (asersi `bg-secondary` dan `not stage-` tetap) | DEC-017 §9: label status tidak boleh `muted` (muted di atas surface-strong 3,26:1, ditemukan axe). Asersi diganti setara/lebih ketat, jumlah asersi naik 3 → 4. |

Tidak ada test lama lain yang diubah. Perubahan perilaku yang berdampak pada E2E lama (untuk adaptasi T12):
- Footer sidebar: caption statis "Ubuntu 24.04.5 · dnsmasq" diganti username admin (`data-testid="sidebar-username"`, mono) + tombol "Keluar" (`data-testid="logout"`). Tidak ada E2E lama yang mengasersi caption itu.
- Top bar: tombol pencarian global kini `data-testid="global-search"`, nama aksesibel dari teks (tanpa `aria-label`), lebar `md:w-9` (ikon) / `lg:w-48` / `xl:w-64`, Kbd hanya di `xl`. Regex lama `/Cari MAC, hostname, IP/` (m1-layout) tetap cocok.
- SSH Keys < 1024 px dirender sebagai kartu (`table` `display:block`); ≥ 1024 tetap tabel (DR-5-2 1280/1440 tidak berubah).
- OS Images: alasan "tidak tersedia" dirender `ReasonText` (`data-testid="img-reason"`, path `[data-slot=path-text]` mono, id `[data-slot=data-token]`); kolom `xl:w-[24ch]`. `textContent` alasan identik dengan `reason` server.
- Log job: status baru `data-state="not-found"` ("Job tidak ditemukan") dan `"session"`; event gabungan menampilkan `· terakhir HH:MM:SS` (`data-testid="log-last-at"`) bila `lastAt ≠ at`.
- Daftar Jobs: polling 5 dtk hanya meminta halaman pertama (`/api/jobs?…limit=50` tanpa `before`), halaman lama tidak di-refetch.
- Toggle password login: aria-label "Tampilkan kata sandi"/"Sembunyikan kata sandi" (bukan "password") agar `getByLabel("Password")` tidak ambigu.

Test baru: `src/lib/m6-api-client.test.ts`, `src/lib/m6-jobs-head.test.ts`, `src/hooks/m6-hooks.test.ts`,
`src/components/m6-components.test.tsx`. Audit mandiri lebar layar: `.agent/runs/m6/dev-audit/`.

## T6b — perbaikan smoke (backend-dev; BUG-M6-3, BUG-M6-4/DEC-020, BUG-M6-5)

| File › test | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `boot-script.test.ts` › "Rocky: …" (judul jadi "inst.stage2 NFS (DEC-020) + inst.ks + inst.cmdline") | `inst.repo=http://10.99.0.2/media/rocky-9 … inst.text` | `inst.stage2=nfs:10.99.0.2:/srv/pxe/media/rocky-9 … inst.cmdline` | DEC-020 (stage2 NFS, node 2 GB) + BUG-M6-5 (non-interaktif). Ekspektasi tetap persis (`toBe`). |
| `app/boot/boot-routes.test.ts` › AC-4.16 snapshot Rocky | idem | idem (`<media-root>`) | Sama. |
| `installers/installers.test.ts` › AC-4.20 "text, url, …" | `toContain("text")` | `toContain("cmdline")` + `not.toContain("text")` | BUG-M6-5. |
| `installers/installers.test.ts` KCMD.kickstart (cmdline palsu turunan) | `inst.repo=http… inst.text` | `inst.stage2=nfs:… inst.cmdline` | Diselaraskan dengan installerScript; AC-5.20 (m5-te-hooks) tetap menurunkan cmdline dari script nyata dan lulus. |
| `installers/m6-generator.test.ts` › Rocky tanpa `---` | diakhiri `inst.text console=…` | diakhiri `inst.cmdline console=…` | Sama. |
| golden `debian-preseed.cfg`, `debian-late.sh`, `rocky-ks.cfg` | — | + country/locale `.UTF-8`/supported-locales/layoutcode/hw-detect/mirror protocol; late: hostname; ks: `cmdline`, tanpa `repo AppStream`, + `openssh-server`, `sudo` | Diperbarui (`-u`) setelah perubahan generator; isi ditinjau baris per baris. |

Test baru: `installers/m6-smoke-fixes.test.ts` (12), `infra/test/m6-nfs.sh` (3, di-source `run.sh`).
Mutasi: `.agent/runs/m6/mutation-dev-T6b.txt` (14 mutan, semua merah).

## T10–T13 — test-engineer (unit/integration/proses, migrasi E2E ke storageState, infra)

Hitungan asersi file test LAMA (ada di `1a7be29`) yang berubah, `1a7be29` → working tree, dihasilkan oleh
`.agent/runs/m6/count-assertions.py` (metrik TS: `expect(`/`expectTypeOf(`/`expect.poll|soft(`; shell:
`assert_*` + `_fail`) → `.agent/runs/m6/assertion-counts.txt`. Tidak ada file yang turun; grep
`skip|only|fixme|todo` = 0.

### E2E (M6-T12, DEC-018 §3 / plan §2.10)
| File | Perubahan | Alasan |
|---|---|---|
| `dashboard/playwright.config.ts` | (a) admin E2E: password acak per run (env proses `E2E_ADMIN_PASSWORD`, diwariskan ke worker; tidak pernah ke file/log) + hash scrypt runtime ke env SETIAP webServer; (b) readiness webServer `/hosts`/`/design` → `/login` (halaman lain mengalihkan tanpa sesi); (c) satu project `setup-<server>` per server (login lewat UI `/login`, simpan `storageState` di `.e2e-data/run-*/state/`), project spec lama `dependencies` + `use.storageState`; (d) server baru `m6-auth` (3114), `m6-session` (3115, `PXE_SESSION_IDLE_MIN=1`), `m6-ui` (3116, subnet KVM + `PXE_SERVER_IP`, 60 job sintetis). `forbidOnly`, `retries: 0`, `workers: 1`, `assertEverySpecCollected` tidak berubah. | Semua halaman/API butuh sesi (DEC-017 §4); tanpa env bypass auth. |
| `dashboard/e2e/support/e2e-env.ts` | `e2eDb({ extra })`: callback opsional menulis data tambahan ke file DB sebelum server start (sekali per run). | Data stres server `m6-ui` (pola seed DB DEC-005/007, bukan seam produk). |
| `dashboard/e2e/helpers.ts` | tipe `SHOTS(m)` menerima `6`. | Screenshot M6 ke `.agent/runs/m6/screenshots/`. |
| `dashboard/e2e/m4-settings.spec.ts` › AC-4.6 | `toEqual` respons `/api/settings` ditambah `insecureConfirmed: false` + blok `auth` (admin E2E `e2eadmin`, default 120/12/5/15/600); asersi baru: respons tanpa `scrypt`/`PXE_ADMIN_PASSWORD_HASH`. 25 → 26. | Kontrak AC-6.1 (sama dengan migrasi unit `m4-api-routes`). Ekspektasi lama tidak dilonggarkan (`toEqual` tetap persis). |
| `dashboard/e2e/m1-design-system.spec.ts` › AC-1.2 (`/hosts`,`/design`), AC-1.3 `/design`, AC-1.4, "oranye hanya pada tombol primary" | tambah `await expect(page.locator("header h1")).toBeVisible()` setelah `goto` sebelum mengukur (dua tempat juga `toHaveText("Design tokens")`; AC-1.4 juga ditambah). 36 → 42. | Shell dashboard kini di dalam Suspense `SessionGate` dan di-reveal ±300 ms SETELAH event `load` (OBS-M6-L1). Tanpa sinkronisasi, test mengukur halaman kosong: AC-1.4 merah (tinggi tombol 0) dan "oranye" merah secara intermiten, sedangkan AC-1.3 `/design` (tanpa drop shadow) LULUS HAMPA. Sinkronisasi menambah asersi; tidak ada asersi yang diubah. |

`e2e/m6-auth.spec.ts` › "cookie berbentuk valid tapi palsu" juga memeriksa respons HTTP mentah tanpa shell dashboard (mutasi ME2: tanpa `SessionGate` → merah).

Spec baru (bukan migrasi): `e2e/auth.setup.ts`, `e2e/m6-auth.spec.ts`, `e2e/m6-session.spec.ts`,
`e2e/m6-ui.spec.ts`, helper `e2e/support/{e2e-auth,axe,m6-seed}.ts`. devDependency baru
`@axe-core/playwright` (registry npm).

**Filter axe (DEC-019 §3).** Fungsi bernama `classifyContrastFinding` (`e2e/support/axe.ts`) hanya
menyaring node temuan `color-contrast`: (1) pasangan token terdaftar DEC-017 §9 + DEC-019 §2 berdasarkan warna
TERHITUNG (bukan selector) di mana pun; (2) `verified-pass` hanya di dalam Sheet bila kontras terhitung
≥ 4,5:1 (≥ 3:1 teks besar). Warna yang tidak bisa dihitung pasti (opacity leluhur < 1, latar gambar,
format tak dikenal) → tetap pelanggaran. Tidak ada aturan axe yang dimatikan. Test sendiri: "filter
`classifyContrastFinding`: kontrol positif & negatif (halaman sintetis)" (13 kasus + axe ujung-ke-ujung).
Jumlah node yang difilter per kategori dicatat di `.agent/runs/m6/axe-results.json` (`filteredCount`).
Audit "/hosts dengan Sheet terbuka" memakai konteks axe `include('[data-slot="sheet-content"]')`: konten
di belakang overlay modal inert (Radix `aria-hidden` + `pointer-events:none`) dan tertutup overlay; halaman
`/hosts` yang sama diaudit utuh tanpa modal di test "/hosts 1440 & 375". Semua aturan tetap aktif di Sheet.

### Unit/integration/proses (M6-T10/T11) — semua file baru
`src/app/boot/m6-te-boot.test.ts` (AC-6.7 /boot tanpa cookie, AC-6.12 lewat route, AC-6.22),
`src/lib/server/m6-te-static.test.ts` (AC-6.53), `src/lib/server/m6-te-limits.test.ts` (nilai DEC dikunci
literal; temuan mutasi MU6), `src/lib/server/auth/m6-te-session.test.ts` (idle 1/2/120 + polling; BUG-M6-L1),
`test/process/start-guard.test.ts` + `test/process/global-setup.ts` + `vitest.process.config.mts` + script
`npm run test:process` (SR-5-10/SR-5-4/O3 level proses atas build standalone). Config proses terpisah dari
`vitest.config.mts` (DEC-004 tidak diubah).

### Infra (M6-T13)
| File › test | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `infra/test/run.sh` › `test_deploy_dry_run_no_secrets` | `grep -Eiq 'password\|secret\|\$6\$\|PRIVATE KEY' dashboard.env` (merah: baris placeholder `PXE_ADMIN_PASSWORD_HASH=@PXE_ADMIN_PASSWORD_HASH@` memuat kata PASSWORD) | (a) baris placeholder PERSIS harus ada tepat 1×; (b) tepat satu baris `PXE_ADMIN_PASSWORD_HASH=`; (c) semua baris SELAIN baris placeholder persis itu tetap ditolak bila memuat `password`, `secret`, `scrypt$` (baru), `$6$`, `PRIVATE KEY`. 252 → 254 asersi. | Placeholder hash disisipkan saat deploy lewat stdin (AC-6.42/6.53). Mutasi (`mutation-test.txt` MI1–MI4): placeholder diganti hash `scrypt$…`, placeholder + sufiks, placeholder ganda, komentar `$6$` → keempatnya merah. |

## T6c — perbaikan smoke ulang (backend-dev; BUG-M6-6, BUG-M6-7)

| File › test | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `installers/installers.test.ts` › AC-4.19 "hash, root-login …" | `d-i partman-auto/disk string /dev/vda` ada | tidak ada baris statis; `partman/early_command` memuat `d='/dev/vda'; ` | BUG-M6-6: disk dipilih/divalidasi saat runtime (`debconf-set`). |
| `installers/installers.test.ts` › AC-4.19 "variasi …" | disk kosong → `not.toContain("partman-auto/disk")` | `not.toContain("d-i partman-auto/disk")` + early_command `d=''` | Teks `partman-auto/disk` kini muncul di argumen `debconf-set`; yang dilarang tetap baris statis. |
| `installers/installers.test.ts` › AC-4.20 "sudo=false … partisi plain tanpa disk" | `clearpart --all --initlabel` tanpa `--drives`, tanpa `ignoredisk` | `%include /tmp/pxe-disk.ks`; tidak ada baris `clearpart`/`ignoredisk` statis | BUG-M6-7: %pre memilih SATU disk (sebelumnya `clearpart --all` menghapus semua disk). |
| `m5-hooks.test.ts`, `m5-te-hooks.test.ts` (3 tempat) | `ks.indexOf("%pre")` | `ks.indexOf("%pre --erroronfail")` | Header %pre berubah; asersi (baris pertama = log mulai, dijalankan sh) tetap. |
| `m6-generator.test.ts`, `app/boot/boot-routes.test.ts` snapshot Rocky | `… inst.cmdline console=ttyS0,115200n8 console=tty0` | `… inst.cmdline console=tty0 console=ttyS0,115200n8` | BUG-M6-7: console serial terakhir (= /dev/console) hanya untuk Rocky; Ubuntu/Debian tidak berubah (diuji). |
| golden `debian-preseed.cfg`, `rocky-ks.cfg` | — | + `partman/early_command`, label gpt, purge LVM, vg name, no_swap; ks: `%pre --erroronfail` + validasi disk | Diperbarui (`-u`), ditinjau. |
| golden BARU `debian-preseed-auto-disk.cfg`, `rocky-ks-auto-disk.cfg` | — | disk otomatis | Diminta Orchestrator: golden disk otomatis DAN eksplisit. |

Test baru di `installers/m6-smoke-fixes.test.ts` (+11): early_command/%pre dijalankan `sh` dengan stub
`list-devices`/`lsblk`/`debconf-set`/`curl`/`wget` (seam: `[ -b` → `[ -e`, root palsu). Mutasi:
`.agent/runs/m6/mutation-dev-T6c.txt` (14/14 merah).

## T6d — BUG-M6-8 (backend-dev): driver disk virtio untuk d-i netboot

Diagnosis (bukti, bukan dugaan): initrd netboot Debian 12 (`.agent/media/debian-netboot/initrd.gz`,
kernel 6.1.0-50) tidak memuat `virtio_blk.ko`/`virtio_scsi.ko`; d-i biasanya mengambilnya sebagai udeb
`*-modules-6.1.0-50-amd64-di` dari mirror, tetapi pool DVD-1 12.15 (`dists/bookworm/main/debian-installer/
binary-amd64/Packages.gz`) tidak memuat udeb disk (scsi-core/sata/virtio…), karena driver itu tertanam di
initrd CD `install.amd/initrd.gz` (yang memuat `drivers/block/virtio_blk.ko`). Akibatnya d-i tidak pernah
melihat `/dev/vda` (attempt5: "No root file system"; attempt7–9: `[ -b /dev/vda ]` gagal). String preseed
tidak rusak oleh debconf: console attempt9 baris 1261 menampilkan perintah utuh, dan callback `failed` di
ujung perintah (memakai sed yang sama) berhasil. `debconf-set-selections` d-i adalah skrip sh tanpa batas
panjang baris.

| File › test | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `installers/m5-te-hooks.test.ts` › "Debian early_command + late" | early_command hanya 1 panggilan (log mulai) | panggilan pertama = log mulai; sisanya hanya `wget …/media/debian-netboot/modules/<kver>/virtio_*.ko` (tanpa token) atau log "modul disk virtio dimuat" | early_command kini memuat driver disk. Asersi log mulai tidak berubah. |
| `installers/installers.test.ts` › AC-4.19 "variasi …" | `partman/early_command string d=''; ` di awal | regex `partman/early_command string .*; d=''; ` | Pemuatan driver kini mendahului pemilihan disk. |
| golden `debian-preseed.cfg`, `debian-preseed-auto-disk.cfg` | — | early_command (preseed & partman) + modprobe/insmod driver + diagnosis | Diperbarui (`-u`), ditinjau. |
| `infra/test/harness.sh` SAFE_TOOLS | — | + `bsdtar gzip zcat install` | Dibutuhkan `debian-disk-modules.sh` di sandbox test (alat lokal, bukan jaringan/privilese). |

Test baru: `installers/m6-smoke-fixes.test.ts` (+6: repro BUG-M6-8 di sandbox sh — disk baru muncul setelah
`insmod virtio_blk`, eksplisit & otomatis; driver tidak tersedia → ERROR + diagnosis (`ls /sys/block`,
`list-devices disk`, `ls -l /dev/vd*…`, `lsmod`, `/proc/partitions`, tanpa token) + `failed`; preseed
satu baris tanpa backslash akhir + `sh -n`), `infra/test/m6-debian-modules.sh` (3: ISO/initrd palsu
bsdtar). Mutasi: `.agent/runs/m6/mutation-dev-T6d.txt` (14/14 merah).

## T6e — BUG-M6-9 / DEC-021 (backend-dev): sumber apt media lokal Debian

Mekanisme (dibaca dari udeb DVD 12.15 `apt-setup-udeb`/`apt-mirror-setup` 0.182 dan `bootstrap-base`
1.213): `50mirror` selalu menulis `deb http://<mirror> …` lalu `apt-setup-verify` (`apt-get update`) →
gagal untuk `Release` tanpa tanda tangan; `apt-setup/mirror/error` di-`db_set Retry` sebelum ditanya
sehingga tidak bisa dipreseed. Maka `preseed/early_command` membuat hook `/usr/lib/post-base-installer.d/
05pxe-local-media` (dijalankan base-installer setelah base + sebelum kernel/apt-setup; kernel tetap dari
sumber base-installer) yang `chmod a-x` `50mirror`; satu-satunya sumber ditulis `60local` dari
`apt-setup/local0/repository = [trusted=yes by-hash=no] <media> bookworm main`. `late_command`
mengomentari baris itu (tanpa `trusted=yes`) dan menghapus `00AllowUnauthenticated`. `mediaSigned: true`
(mirror bertanda tangan) → tidak ada trusted/hook/untrust.

| File › test | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `installers/m6-smoke-fixes.test.ts` › "preseed/early_command juga memuat driver" | seam `/sys/module/`, `/tmp/` | + seam `/usr/lib/` | early_command kini juga menulis hook di `/usr/lib/post-base-installer.d` (test milik T6d). |
| golden `debian-preseed.cfg`, `debian-preseed-auto-disk.cfg`, `debian-late.sh` (via late b64) | `tasksel/first standard, ssh-server` | `ssh-server`; + apt-setup non-free/contrib/deb-src false, local0, pkgsel/update-policy, grub with_other_os/force-efi-extra-removable; early_command + hook; late + untrust | Diperbarui (`-u`), ditinjau. |

Test baru (+5) di `installers/m6-smoke-fixes.test.ts`. Mutasi: `.agent/runs/m6/mutation-dev-T6e.txt` (12/12 merah).

## BUG-M6-L4 — direktori bukti screenshot E2E (test-engineer)

Hanya helper E2E yang berubah; tidak ada file spec yang diubah, jumlah asersi tidak berubah
(`m6-session.spec.ts` 0 baris diff).

| File | Perubahan | Alasan |
|---|---|---|
| `dashboard/e2e/helpers.ts` | `SHOTS(m, name)`: screenshot milestone aktif (`EVIDENCE_MILESTONE = 6`, dipakai semua spec `m6-*`) selalu ditulis ke `.agent/runs/m6/screenshots/<name>.png` apa pun nilai `PXE_E2E_MILESTONE`; default `PXE_E2E_MILESTONE` 4 → 6 sehingga screenshot regresi `m1`–`m5` (awalan `m<n>-`) tanpa env juga masuk ke `m6`, bukan ke direktori M4 yang sudah di-approve | tanpa env, `SHOTS(6, …)` menulis `.agent/runs/m4/screenshots/m6-*.png` (BUG-M6-L4) |

Verifikasi: `.agent/runs/m6/bug-l4.log` (tsc + eslint bersih; `m6-session` 3/3 lulus tanpa env;
PNG baru hanya di `.agent/runs/m6/screenshots/`; `git status -- .agent/runs/m4` kosong).

## R6 / CR-6-4 — asersi early_command Debian kembali `toEqual` persis (test-engineer, iter2)

Hitungan asersi `m5-te-hooks.test.ts`: 66 → 67 (`grep -o 'expect(\|expectTypeOf(' | wc -l`). Tidak ada
test yang dihapus/di-skip; jumlah test di file tetap 28.

| File › test | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `installers/m5-te-hooks.test.ts` › helper `runSh` | stub hanya `curl`/`wget`; `modprobe`/`insmod`/`udevadm`/`uname` asli dari `/usr/bin` host; `/sys/module`, `/tmp`, `/usr/lib` asli | `modprobe`/`insmod`/`udevadm`/`uname` selalu distub (tidak ada perintah kernel/udev host); `uname -r` → `6.1.0-50-amd64`; urutan semua stub dicatat (`seq`); opsi `sandbox` mengalihkan `/sys/module/`, `/tmp/`, `/usr/lib/` ke root palsu (seam sama dengan `m6-smoke-fixes.test.ts`); `wget -O <berkas sandbox>` menulis berkas, `insmod` gagal bila berkas tidak ada dan menandai `<d>/sys/module/<m>` | CR-6-4: hasil bergantung `/sys/module` host, `udevadm settle` hingga 15 s, risiko `modprobe`/`insmod` host bila dijalankan root; early_command juga menulis hook ke `/usr/lib/post-base-installer.d` host |
| `installers/m5-te-hooks.test.ts` › "Debian early_command + late …" | panggilan pertama `toEqual` + loop atas sisa panggilan (lulus dengan 0 panggilan) — 3 `expect` | `code` 0; `toEqual` persis `[curl log mulai, wget virtio_blk.ko, wget virtio_scsi.ko, curl log modul]` (prog, URL, stdin); `toEqual` persis urutan penuh 13 stub (`curl`, `modprobe virtio/virtio_ring/virtio_pci/scsi_mod`, `uname -r`, `wget`, `insmod virtio_blk`, `uname -r`, `wget`, `insmod virtio_scsi`, `udevadm settle --timeout=15`, `curl`); hook apt DEC-021 dibuat di sandbox dengan mode 0755 — 4 `expect` | ekspektasi diturunkan dari `debianModulesCmd`/`debianAptHookCmd` di `installers/debian.ts` (sha256 `ddc360e5…fab6`), bukan dari test lama |

Mutasi generator (in-place, dipulihkan, sha256 identik): `.agent/runs/m6/mutation-te-iter2.txt` — 4/4 merah
(hapus `virtio_scsi`, tukar urutan modul, `udevadm settle` dipindah sebelum unduhan, `insmod` dihapus).

## DEC-022 §1 (gate M6 R3 / DR-6-3) — warna alasan "tidak tersedia" `muted` → `body` (frontend-dev, c67d438; dicatat test-engineer, iter2)

Perubahan ekspektasi oleh frontend-dev di commit `c67d438`, diperiksa ulang test-engineer (diff `2b90cf5..9f07836`).
Jumlah asersi tidak berubah: `m5-library.spec.ts` `expect(` 185 → 185 (token `expect(`+`toHave*(` 220 → 220);
`m5-ui-fixes.spec.ts` 44 → 44 (55 → 55). Tidak ada test yang dihapus/di-skip; asersi "bukan merah"
(`not.toBe(HEX.failed)`) tetap ada di kedua test.

| File › test | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `e2e/m5-library.spec.ts` › "AC-5.27/5.32 OS Images: … tidak tersedia …" | `img-available` ubuntu-22.04 `toHaveCSS("color", HEX.muted)`; judul/komentar "muted" | `toHaveCSS("color", HEX.body)`; judul/komentar "body (DEC-022 §1)"; `not.toBe(HEX.failed)` tetap | DEC-022 §1: informasi penting tidak `muted` (DEC-017 §9); DR-4-5 tetap berarti "bukan error" (tidak merah) |
| `e2e/m5-ui-fixes.spec.ts` › "AC-5.31 DR-4-5 'tidak tersedia' …" | catatan `os-ubuntu-22.04-note` `toHaveCSS("color", HEX.muted)` (#807d72) | `toHaveCSS("color", HEX.body)` (#5a5852); judul diperbarui; `not.toBe(HEX.failed)` tetap | sama |

Catatan: nama berkas screenshot `ac-5.31-os-unavailable-muted` tidak diganti (hanya nama bukti).

## DEC-021 §2 / DEC-022 §2 — pemeriksaan `/etc/apt` target di suite KVM `m6-distro` dibuat fail-closed (test-engineer, iter2)

| File | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `e2e-kvm/m6-distro.spec.ts` | `n=$(sudo -n grep -rl 'trusted=yes' /etc/apt 2>/dev/null \| wc -l)` → `trusted_files=0`; `if sudo -n test -e …00AllowUnauthenticated; … else allow_unauth=tidak-ada` (hanya Debian) | `e2e-kvm/apt-trust.ts`: penanda eksplisit `trusted_rc=1` (grep tanpa kecocokan), `allow_file=TIDAK`, `allow_grep_rc=1` untuk `grep -ril AllowUnauthenticated /etc/apt` (baru); Debian wajib `/etc/apt` ada; Rocky: tidak relevan bila `/etc/apt` tidak ada, wajib bersih bila ada | versi lama hampa bila `sudo`/grep gagal (0 berkas / "tidak-ada"); gate-iter1 meminta bukti `/etc/apt` tanpa `trusted=yes`/`AllowUnauthenticated` |

Test unit baru `src/lib/server/m6-kvm-apt-trust.test.ts` (7 test) menjalankan script yang sama terhadap root palsu:
bersih → lulus; `trusted=yes`, `00AllowUnauthenticated`, `allowunauthenticated` (huruf kecil) di berkas lain,
`sudo` gagal, `/etc/apt` tidak ada (Debian), keluaran kosong → semuanya gagal. Mutasi: `.agent/runs/m6/mutation-te-T14.txt`.

## CR-6-10 — `m6-smoke-fixes.test.ts` (DEC-021 → DEC-022 §2, backend-dev `e273c67`; dicatat test-engineer iter2)

| File › test | Sebelum (`105727e`) | Sesudah (`18913b5`) | Alasan |
|---|---|---|---|
| `src/lib/server/installers/m6-smoke-fixes.test.ts:470-488` › "BUG-M6-9 / DEC-021 … media lokal (default) …" | `expect(late.split("\n").at(-3)).toContain("rm -f /etc/apt/apt.conf.d/00AllowUnauthenticated")` (1 expect, posisi tetap dari akhir) | indeks baris untrust dan baris firstboot (`mkdir -p /etc/pxe-callback`): `expect(untrust).toBeGreaterThan(0)` + `expect(firstboot).toBeGreaterThan(untrust)` (2 expect) | SR-6-6 (DEC-022 §2): pembersihan dipindah SEBELUM unit firstboot, sehingga `at(-3)` tidak lagi benar; urutan relatif lebih kuat daripada posisi absolut |
| idem › "mirror bertanda tangan (mediaSigned): TIDAK ada trusted=yes, by-hash override, hook, maupun untrust" | 8 expect (`not.toContain` trusted=yes/by-hash/post-base-installer/50mirror, `diValue(local0)` null, late tanpa trusted=yes) untuk `ctx({ mediaSigned: true })` | diganti "DEC-022 §2 media eksternal (host ≠ PXE_SERVER_IP): generator menolak, tanpa trusted=yes/allow_unauthenticated": 2 expect (`debianPreseed` dan `debianLateScript` `toThrow(/bukan server PXE lokal/)`) × 3 URL eksternal | DEC-022 §2 / CR-6-3 / SR-6-1: opsi `mediaSigned` dihapus (kode mati); media non-lokal kini fail-closed (generator melempar), jadi tidak ada keluaran preseed untuk diperiksa. Cakupan "tidak ada trusted=yes ke host lain" kini lebih ketat dan diperluas di `m6-iter2-debian.test.ts` (4 URL eksternal + serverIp beda) |

Jumlah statik `expect(` file ini: 113 → 110 (−3; `.agent/runs/m6/final-iter2/skip-weakening.txt` bagian (c)). Terhadap
`main` file ini file baru M6 (bukan test lama), jadi kriteria "asersi test lama tidak turun" tidak terpengaruh. Penurunan
statik bukan pelemahan: 8 asersi atas jalur yang dihapus diganti 6 asersi runtime (2 × 3 URL) yang menolak jalur itu, dan
mutasi `requireLocalMedia` no-op membuat test pengganti merah (`.agent/runs/m6/final-iter2/mutation.txt` R4a; urutan
SR-6-6: R4c).
