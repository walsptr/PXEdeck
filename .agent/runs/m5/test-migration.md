# M5 — migrasi test lama (backend-dev)

Setiap perubahan pada test/fixture yang sudah ada akibat perubahan perilaku yang disengaja di M5.
Tidak ada asersi yang dihapus, di-skip, atau dilonggarkan. Perubahan semantik (bila ada) ditandai
**[semantik → test-engineer]** untuk ditinjau test-engineer.

| # | File | Perubahan | Dasar | Jenis |
|---|---|---|---|---|
| 1 | `src/app/api/{config-routes,iter2-routes,m4-api-routes}.test.ts`, `src/app/api/hosts/hosts-routes.test.ts`, `src/app/boot/boot-routes.test.ts` | Pemanggilan handler GET tanpa argumen (`hostsGET()`, `settingsGET()`, …) kini memberi `getReq("/api/…")` (helper baru di `src/test/route.ts`, Host `localhost` = diizinkan default). | DEC-015 §1 / plan §2.6: setiap GET `/api/**` memeriksa allowlist Host → handler menerima `Request`. | Mekanis (signature) |
| 2 | `src/app/boot/boot-routes.test.ts` (`KVM_ENV`) | + `PXE_INSECURE_NO_LEASE_CHECK: "1"`. Test yang menguji verifikasi lease tetap memakai `writeLeases()` (fixture lease aktif mengalahkan flag). | DEC-013: `PXE_TRUST_PROXY=1` tanpa `PXE_DNSMASQ_LEASES` → server menolak start kecuali flag dev; Konsekuensi DEC-013 mengizinkan "menyetel fixture lease atau flag secara eksplisit". | Fixture |
| 3 | `src/lib/server/boot-script.test.ts` (`requestIp membaca PXE_TRUST_PROXY`) | + `PXE_DNSMASQ_LEASES` saat `PXE_TRUST_PROXY=1`. | DEC-013 (fail-closed). | Fixture |
| 4 | `src/app/api/iter2-routes.test.ts` (2 test: "Origin sama (Host / X-Forwarded-Host)…", "PXE_ALLOWED_HOSTS: entri tanpa port…") | + `PXE_TRUST_PROXY=1` dan `PXE_DNSMASQ_LEASES` sebelum request yang mengandalkan `X-Forwarded-Host`. Asersi (501/200/403) tidak berubah. | CR-4-15/SR-4-9 (carry-over gate M4, plan §2.6): `X-Forwarded-Host` hanya dibaca bila proxy dipercaya. Tanpa fixture ini header diabaikan (perilaku baru yang benar). | Fixture |
| 5 | `src/lib/server/settings.test.ts` ("variasi valid…") | `PXE_TOKEN_TTL_MIN: "5"` kini disertai timeout tahap 1/2/1 menit. | DEC-014 §2: TTL token ≥ jumlah timeout tahap (default 240 mnt). | Fixture |
| 6 | `src/lib/server/settings.test.ts`, `src/app/api/m4-api-routes.test.ts` (bentuk `toSettingsResponse` / `GET /api/settings`, `toEqual`) | Objek harapan + `jobTimeouts`, `maxInstallerBoots`, `insecureNoLeaseCheck`. Pemeriksaan "tanpa path DB/rahasia" tetap. | AC-5.1: respons wajib memuat ketiga kunci itu. **[semantik → test-engineer]** (perluasan kontrak) | Ekspektasi diperluas |
| 7 | `dashboard/playwright.config.ts` server `m4-settings` | + `PXE_DNSMASQ_LEASES: e2eLeaseFile("m4-settings")` (file lease kosong). | DEC-013: server dengan `PXE_TRUST_PROXY=1` tanpa lease tidak start. Spec `m4-settings` tidak bergantung pada installer. | Fixture E2E |
| 8 | `src/lib/server/db/db.test.ts` (AC-4.1) | `TABLES` + `job_events`; versi `schema_migrations` harapan `[1 init, 2 job-events]`; migrasi rusak uji rollback memakai versi 99 (versi 2 kini dipakai) dan versi tercatat harapan `[1, 2]`; fixture `job()` + `failureReason/installerBoots/eventSeq` (tipe `Job` baru). Asersi rollback/idempotensi tetap. | DEC-014 §3 (migrasi 2 `job_events`), plan §2.2. | Fixture/ekspektasi skema |
| 9 | `src/app/boot/boot-routes.test.ts` (AC-4.23 "setiap penolakan → 404 body identik") | Asersi "host tetap `booting`" dipindah ke SEBELUM lompatan jam +361 mnt; setelah lompatan kini diasersikan host `failed` + job `timeout-booting` + token dicabut (lebih ketat). Penolakan "token expired" tetap diasersikan 404 identik. | DEC-014 §2: TTL token ≥ jumlah timeout tahap, sehingga saat token kedaluwarsa watchdog pasti sudah menandai job gagal (sapuan lazy di `/boot`). Asersi lama ("tetap booting" setelah 361 mnt) bertentangan langsung dengan decision. **[semantik → test-engineer]** | Ekspektasi diubah (decision) |
| 10 | `src/app/boot/boot-routes.test.ts` (AC-4.14 wait), `src/lib/server/boot-script.test.ts` (wait) | Harapan `chain --autofree …&wait=N || exit 1` → `chain --replace --autofree …`. | CR-4-5 / AC-5.21 (carry-over gate M4): `waitScript` wajib `--replace`. | Ekspektasi diubah (carry-over) |
| 11 | `src/lib/server/installers/installers.test.ts` (AC-4.18–4.20) dan `src/app/boot/boot-routes.test.ts` (AC-4.23) | Asersi posisi: Ubuntu `late[0]` → `late[1]` untuk callback `configuring` (late[0] kini log "late-commands mulai", diasersikan); `error-commands` = `[logTailCmd, callbackCmd failed]`; Debian late baris `[2]` → `[3]`; Rocky section `["%pre","%packages","%post","%onerror"]`, `%onerror` +1 → +2 (baris +1 = logTailCmd, diasersikan), `%post` baris `[1]` → `[2]`. Semua asersi callback/URL (`evalCallbackUrl`) tetap. | DEC-014 §4 + plan §2.5 / AC-5.19 (log sebelum callback `configuring`, tail lalu `failed`, `%pre`). **[semantik → test-engineer]** | Ekspektasi struktur diubah (decision) |
| 12 | `src/test/golden/installers/*` (5 file) | Golden diperbarui (`vitest -u`, hanya test "golden file"): baris hook log baru (`b=$(…/proc/cmdline…)`, penanda konstan), `preseed/early_command`, `%pre`, tail `%onerror`/`error-commands`, payload base64 late/%post/first-boot berubah. Tidak memuat token (dicek `containsSecret` di test lama). | Plan §2.5: "Golden file diperbarui". | Golden |
| 13 | `src/app/api/hosts/hosts-routes.test.ts` (AC-2.5 `HostSchema` strict) | Skema strict + `lastJob: {id, status, failureReason, createdAt} | null` (wajib ada). GET `/api/hosts/:id` juga kini memuat `lastJob` (konsisten). | AC-5.16 / plan §2.6: `GET /api/hosts` memuat `lastJob` per host. **[semantik → test-engineer]** (perluasan kontrak) | Ekspektasi skema diperluas |

## Migrasi oleh frontend-dev (M5-T8..T10)

| # | File | Perubahan | Dasar | Jenis |
|---|---|---|---|---|
| 14 | `dashboard/e2e/m1-layout.spec.ts` (test "placeholder /jobs menampilkan judul + deskripsi") | Entri `/jobs` dikeluarkan dari daftar `PLACEHOLDERS` dan diganti test `"/jobs: konten nyata (bukan placeholder)"`: penanda halaman `[data-testid="jobs-page"]` terlihat di konten, konten tidak memuat "dibangun di tahap", tidak ada judul empty state "dibangun…". Header `h1` = "Provisioning Jobs" tetap diuji test navigasi yang ada. | DR-4-7 (carry-over gate M4) + AC-5.32 + plan §2.8: halaman Jobs dibangun di M5, placeholder dihapus. Asersi lama (judul "… — dibangun di tahap 5") bertentangan langsung dengan AC-5.32. **[semantik → test-engineer]** (AC-5.22/5.32 penuh tetap tugas T13) | Ekspektasi diubah (UI disengaja) |
| 15 | `dashboard/e2e/m1-layout.spec.ts` (test "placeholder /os-images …" dan "placeholder /ssh-keys …") | Daftar `PLACEHOLDERS` dihapus seluruhnya; `/os-images` dan `/ssh-keys` masuk daftar `BUILT_PAGES` (lihat #14) dengan penanda `[data-testid="os-images-page"]` / `[data-testid="ssh-keys-page"]`, tanpa "dibangun di tahap". Komponen `PagePlaceholder` dihapus karena tidak dipakai lagi. | DR-4-7 + AC-5.32 + plan §2.8 (M5-T9: halaman OS Images & SSH Keys dibangun, placeholder hilang). **[semantik → test-engineer]** (AC-5.27/5.28 penuh = T13) | Ekspektasi diubah (UI disengaja) |
| 16 | `dashboard/e2e/m4-settings.spec.ts` (AC-4.6, `toEqual` respons `GET /api/settings`) | Objek harapan + `jobTimeouts {60,120,60}`, `maxInstallerBoots: 3`, `insecureNoLeaseCheck: false` (nilai default server E2E). Pemeriksaan "tanpa path DB/seed/allowlist" dan semua asersi halaman Settings tetap. Padanan E2E dari #6 yang terlewat: test ini merah di HEAD `3a799d2` sebelum perubahan UI M5. | AC-5.1 / DEC-014: respons wajib memuat ketiga kunci itu. **[semantik → test-engineer]** (perluasan kontrak) | Ekspektasi diperluas |

## Migrasi oleh backend-dev (perbaikan BUG-M5-1)

| # | File | Perubahan | Dasar | Jenis |
|---|---|---|---|---|
| 17 | `dashboard/e2e/m5-library.spec.ts` (AC-5.27 "Daftarkan image…", hapus terpakai → 409) | Asersi lama `/OS image dipakai \d+ host/` **tetap**; ditambah: kolom `img-used-by` baris `ubuntu-24.04` dibaca sebelum hapus (= "1 host") dan pesan 409 wajib memuat `OS image dipakai <usedBy> host/job` (angka sama). Komentar "N ≠ usedBy (BUG-M5-1)" diganti keterangan regresi. Ditambah juga test baru (tanpa mengubah asersi lama): `src/lib/server/db/db.test.ts` › "imageUsage menghitung host unik = imageHostCount/usedBy (regresi BUG-M5-1)" dan `src/app/api/m4-api-routes.test.ts` › "409 hapus: N di pesan = usedBy …". Asersi `imageUsage` lama di `db.test.ts` (base = jumlah host demo `osAssigned`, +1 setelah job aktif host lain) tetap tanpa perubahan dan tetap lulus. | BUG-M5-1 (`.agent/runs/m5/bugs.md`); plan M5 §2.8 (409 "dipakai N host"). | Pengetatan (asersi ditambah) |

## Tinjauan test-engineer (M5-T12) — butir semantik

Ditinjau terhadap `git diff main..HEAD` (bukan hanya deskripsi di atas), DEC-013/014/015, dan
M5-plan §4. Kriteria: asersi lama dihapus/dilonggarkan tanpa dasar decision = **pelemahan
(critical)**; asersi dipindah/diganti oleh perilaku yang ditetapkan decision dengan kekuatan setara
atau lebih ketat = **sah**.

| # | Kesimpulan | Alasan |
|---|---|---|
| 6 | **Sah** (perluasan kontrak) | `toEqual` tetap persis (bukan `toMatchObject`), hanya ditambah 3 kunci yang diwajibkan AC-5.1; pemeriksaan "tanpa path DB/rahasia" tidak berubah. Ditambah test baru `m5-te-api.test.ts` (AC-5.1: nilai env tercermin, default, 500 menyebut variabel, tanpa `dbPath`/`allowedHosts`/`dnsmasqLeases`/`watchdogIntervalSec`). |
| 9 | **Sah, dengan test pengganti** | Asersi "host tetap `booting`" tidak dihapus — dipindah ke sebelum lompatan jam (semua penolakan tetap tanpa efek) dan setelah lompatan kini diasersikan `failed` + `timeout-booting` + `tokenHash null` (lebih ketat). Bertentangan langsung dengan DEC-014 §2 bila dipertahankan (TTL ≥ jumlah timeout → watchdog selalu lebih dulu). Konsekuensi: 404 "token expired" di test itu kini berasal dari token yang dicabut, bukan cabang `token_expires_at`. Cabang expiry diuji ulang dengan fixture DB (job aktif, token lewat masa berlaku) untuk file/status/log di `m5-te-lifecycle-routes.test.ts` › "Token kedaluwarsa pada job yang masih aktif" dan AC-5.13 (log). |
| 11 | **Sah** | Setiap asersi callback lama (`callbackCmd` + `evalCallbackUrl(...) === CALLBACK`) tetap ada, hanya indeks bergeser karena hook log baru (DEC-014 §4, plan §2.5); setiap baris baru di posisi lama diasersikan eksplisit (`logCmd`/`logTailCmd`). `error-commands` tetap `toEqual` daftar persis. Tidak ada asersi yang dihapus. Diperkuat oleh `m5-te-hooks.test.ts` (AC-5.19/5.20: perintah dijalankan `sh` dengan cmdline dari `installerScript()` nyata). |
| 13 | **Sah** (pengetatan) | Skema `HostSchema` tetap `strict`; `lastJob` ditambahkan sebagai kunci wajib (strictObject + nullable), sehingga respons tanpa `lastJob` atau dengan kunci liar kini gagal — lebih ketat dari sebelumnya. Isi `lastJob` diuji di `m5-te-api.test.ts` (AC-5.16: = job terbaru, `null` untuk host tanpa job, konsisten `/api/hosts/:id`). |
| 14 | **Sah** | Placeholder `/jobs` ("dibangun di tahap 5") bertentangan langsung dengan AC-5.32/DR-4-7. Judul `h1` per route tetap diuji test navigasi `m1-layout.spec.ts` (`NAV` → `header h1`). Konten nyata `/jobs` diuji penuh di `m5-jobs.spec.ts` (AC-5.22: empty state berteks, judul 26 px/400, daftar, detail). |
| 15 | **Sah** | Sama dengan #14 untuk `/os-images` & `/ssh-keys`; konten nyata diuji `m5-library.spec.ts` (AC-5.27/5.28/5.32: judul 26 px, tabel, dialog, CRUD). Komponen `PagePlaceholder` dihapus; test statis `m5-te-unit.test.ts` › AC-5.32 memastikan tidak ada "dibangun di tahap" di `src/` dan halaman tidak memakai `PagePlaceholder`. |
| 16 | **Sah** (perluasan kontrak) | Padanan E2E #6: `toEqual` tetap persis + 3 kunci AC-5.1 dengan nilai default server E2E; pemeriksaan "tanpa .db/seed/allowed/PXE_DB" dan semua asersi halaman Settings tetap. |

Butir non-semantik (#1–#5, #7, #8, #10, #12) diperiksa sekilas: mekanis (signature `getReq`),
fixture lease/flag eksplisit sesuai Konsekuensi DEC-013, ekspektasi carry-over CR-4-5 (`--replace`),
skema migrasi 2, golden file (hanya test "golden file", `containsSecret` token tetap). Tidak ada
`skip`/`only`/`todo`, `retries`, atau ambang coverage yang diubah.

**Kesimpulan: tidak ditemukan pelemahan test. 7/7 butir semantik sah menurut DEC-013/014/015; #9
dilengkapi test pengganti untuk cabang token kedaluwarsa.**

## Iterasi 2 — backend-dev (SR-5-1, SR-5-2, CR-5-1 + SR-5-5a, CR-5-2/DEC-016, DR-5-4)

Tidak ada test lama yang diubah, dihapus, di-skip, atau dilonggarkan oleh backend-dev di iterasi 2.
Semua asersi lama tetap lulus tanpa perubahan:
- Teks DR-5-4 diganti tanpa menyentuh test: asersi lama memakai potongan yang tetap ada
  (`/hanya generator/`, `/Windows: hanya generator unattend\.xml/`, `/custom belum didukung/`, `/custom/`).
- CR-5-2: AC-5.8 (`m5-te-lifecycle-routes.test.ts`) menghitung `entered` dari entri tahap terakhir;
  di fixture itu install dan penyajian installer terjadi pada detik yang sama, jadi entri pertama = terakhir
  dan test tetap lulus tanpa perubahan. Semantik baru (entri pertama) dibuktikan oleh test baru di bawah.
- AC-5.13 (`dua[31m merah\tkolom`) tetap: sanitasi hanya membuang karakter kontrol, tidak membuang
  sekuens ANSI utuh (sengaja tidak diubah).

Test baru: `dashboard/src/lib/server/m5-iter2-redact-timeout.test.ts` (37 test).
| Temuan | Test |
|---|---|
| SR-5-1 | `cleanEventMessage` + `appendEvent` (DB): token 43 karakter di `token=`/JSON/path dan hash `$6$` (biasa/rounds) yang disisipi ESC/\x01, serta header private key bersisip \x01 → teredaksi; asersi kontrol bahwa urutan lama (redaksi → sanitasi) memang bocor; redaksi sebelum pemotongan 2048; `stripControl` dengan/tanpa newline |
| SR-5-2 | `redactSecrets` body utuh: blok multi-baris dengan dan tanpa footer, footer END yatim; `handleLogPost`: blok dengan/tanpa footer → tidak ada baris base64 di DB, blok terpecah dua request, batas 200 baris dihitung dari body mentah |
| CR-5-1 + SR-5-5(a) | token terpotong `cut -c1-240` di setiap panjang 8..43 (36 kasus), terpotong di tengah baris untuk 4 bentuk MAC, percent-encoded `%2F`/`%2f` (utuh & terpotong), hash `$6$` terpotong di setiap panjang (biasa & rounds), negatif (44 karakter, < 8, `token=` pendek, `$6$` tanpa salt), base64 berisi token parsial/percent-encoded, `handleLogPost` dengan baris ber-token terpotong |
| CR-5-2 | 2 dan 3 penyajian installer: timeout Booting dari entri `booting` pertama (gagal di +60 mnt, bukan +100 mnt), event penyajian tetap tercatat; Installing tetap dari entri `installing`; fallback `createdAt` |

## Iterasi 2 — frontend-dev (DR-5-1, DR-5-2, DR-5-3, DR-5-5, DR-5-6, DR-5-7, I-5-3, I-5-8)

Tidak ada test lama yang dihapus, di-skip, atau dilonggarkan. Semua perubahan bersifat **penambahan**
asersi/test; asersi lama tidak diubah. Tidak ada `skip`/`only`/`todo`/`retries`/ambang coverage yang
diubah.

| # | File | Perubahan | Alasan |
|---|---|---|---|
| F1 | `dashboard/e2e/m5-library.spec.ts` | Test baru "DR-5-1 OS Images 375×812": setiap kartu image ≤ 200 px, kartu dalam viewport, setiap path Sumber ≤ 2 baris visual, `scrollWidth` halaman ≤ 375, tabel tanpa overflow horizontal, `scrollHeight` halaman ≤ 300 + 200 × jumlah image, id/URL tetap mono | Regresi DR-5-1 (iter1: baris 751 px, halaman 4.032 px) |
| F2 | `dashboard/e2e/m5-library.spec.ts` | Test baru "DR-5-1 OS Images 1440×900": path Sumber ≤ 2 baris, kernel Ubuntu 1 baris, tabel tanpa overflow horizontal, tombol Hapus di viewport | Regresi DR-5-1 desktop (path terpotong di tengah kata) |
| F3 | `dashboard/e2e/m5-library.spec.ts` | Test baru "DR-5-5/DR-5-6": submit terlihat penuh di 1440×900, footer `position: sticky` dan rata bawah dialog (sebelum & sesudah error), field kosong → "Wajib diisi" (bukan pesan zod Inggris), hint ID hilang saat ID invalid | Regresi DR-5-5, DR-5-6 |
| F4 | `dashboard/e2e/m5-library.spec.ts` | Test baru "DR-5-2 SSH Keys 1280/1440" (di akhir file, setelah test AC-5.28): menambah key bernama panjang lewat API, lalu memastikan tabel tanpa overflow horizontal, kolom Dipakai + tombol Hapus setiap baris di dalam container, nama panjang punya `title` | Regresi DR-5-2 |
| F5 | `dashboard/e2e/m5-ui-fixes.spec.ts` | Asersi tambahan di 2 test AC-5.30 (single & bulk): item `install-error-item` berisi label host tepat sekali | Regresi DR-5-3 |
| F6 | `dashboard/e2e/m5-jobs.spec.ts` | Asersi tambahan di test AC-5.25: baris terpilih `rgb(250, 250, 247)`, border kiri 2 px `rgb(38, 37, 30)`, semua teks di luar pill kontras ≥ 4,5:1 terhadap latar baris, `job-row-os` punya `title` = teks | Regresi DR-5-7, I-5-8 |
| F7 | `dashboard/src/hooks/m5-library-hooks.test.ts` | Test unit baru: `osImageFieldErrors` menerjemahkan pesan zod (Too small/Too big/Invalid option) per field; `localizeValidationMessage` membiarkan pesan kustom Indonesia | DR-5-5. Test lama `osImageFieldErrors` (pesan kustom Indonesia) tetap persis sama dan lulus |
| F8 | `dashboard/src/lib/install-errors.test.ts` (baru) | 4 test unit `stripHostPrefix`: prefix hostname, prefix MAC, hanya prefix di awal sekali, pesan tanpa prefix utuh | DR-5-3 |

Catatan kompatibilitas asersi lama:
- `img-used-by` di desktop tetap `innerText` = `"<n> host"` (label "Dipakai" mobile `md:hidden`), regex
  `/^(\d+) host$/` di AC-5.27 tetap lulus tanpa perubahan.
- `img-repo-url` `toHaveText` tetap: path dipecah per segmen dengan `<span>` tanpa mengubah textContent.
- `key-name` `toHaveText` tetap (hanya `truncate` + `title`).

## Iterasi 2 — tinjauan test-engineer (diff `d19b44c..16d390d` + perubahan test `fb8077e`)

Metode: membaca diff test dan produk, lalu **mutasi**. Setiap perbaikan produk di-revert sementara
(file ke `d19b44c` atau satu baris dihapus), test terkait dijalankan, lalu file dikembalikan dengan
`git checkout HEAD -- <file>` (worktree diverifikasi bersih). Test sah bila merah saat perbaikannya
di-revert.

| Temuan | Mutasi (revert sementara) | Hasil test | Kesimpulan |
|---|---|---|---|
| CR-5-2 / DEC-016 | `job-lifecycle.ts` ke `d19b44c` (`stageEnteredAt` = entri terakhir) | `m5-iter2-redact-timeout` 2 gagal (2 test CR-5-2). Sebelum `fb8077e`, `m5-te-lifecycle-routes` AC-5.8 **tetap hijau**, sesuai catatan backend-dev | Sah; AC-5.8 diperketat (lihat T1) |
| SR-5-1 | `cleanEventMessage` = `sanitizeMessage(redactSecrets(raw))` (urutan lama) | 14/37 gagal (14 test SR-5-1 cleanEventMessage + appendEvent) | Sah. Test juga mengasersikan bahwa urutan lama memang bocor (kontrol negatif) |
| SR-5-2 | `handleLogPost` tanpa redaksi body utuh (`splitLogLines(input.text)`) | 3 gagal (blok dengan footer, tanpa footer, terpecah 2 request) | Sah |
| SR-5-2 | `redactSecrets` tanpa `redactOrphanKeyTail` | 2 gagal (footer yatim, terpecah 2 request) | Sah |
| CR-5-1 | hapus `.replace(TOKEN_PATH_PARTIAL_RE…)` | 3 gagal | Sah |
| SR-5-5(a) | hapus `.replace(TOKEN_PATH_PCT_RE…)` | 4 gagal | Sah |
| CR-5-1 (hash) | hapus `.replace(HASH_PARTIAL_RE…)` | 2 gagal | Sah |
| SR-5-1/2, CR-5-1 | `redact.ts` utuh ke `d19b44c` | 11/37 gagal | Sah |
| DR-5-1 (375) | `os-images-view.tsx` ke `d19b44c`, `playwright --project=m5-library -g DR-5-1` | merah: `tinggi kartu debian-12` Expected ≤ 200, Received **751** (angka iter1) | Sah. Testid sama di versi lama, jadi kegagalan berasal dari asersi dimensi |
| DR-5-1 (1440) | idem, `-g "DR-5-1 OS Images 1440"` | merah: `path "rocky-9/images/pxeboot/vmlinuz" dipecah 3 baris` (≤ 2) | Sah |

Tanpa mutasi (ditinjau dari diff saja): DR-5-2 (overflow container + tombol di dalam container
@1280/1440, `title`), DR-5-5/DR-5-6 (`Wajib diisi` per field, tidak ada teks zod Inggris, footer
sticky dan rata bawah ±1 px sebelum/sesudah error), DR-5-7/I-5-8 (warna persis + kontras ≥ 4,5:1
dihitung untuk setiap elemen teks di baris), DR-5-3 (label tepat sekali per item), F7/F8 unit. Semua
asersinya konkret: angka/warna/teks persis, bukan `toBeTruthy`. F8 (`install-errors.test.ts`) adalah
file baru untuk fungsi baru `stripHostPrefix`. Test ini otomatis merah bila fungsinya hilang, dan
mencakup kasus negatif (prefix di tengah, tanpa spasi).

Pemeriksaan pelemahan pada `git diff d19b44c..HEAD -- '*.test.ts' '*.test.tsx' 'dashboard/e2e/'`:
- baris `-` hanya dua jenis:
  1. import `m5-library.spec.ts`, yang diganti dengan versi yang menambah tipe `Locator`;
  2. empat baris `toStage` milik T1 (test-engineer). Dua `expect` di antaranya dipindah utuh ke
     dalam blok `if`. `.at(-1)` diganti nilai harapan tetap ditambah asersi entri pertama.

  Diff dev tidak menghapus atau mengubah satu pun `expect`;
- tidak ada `skip`/`only`/`todo`/`fixme`/`retries`;
- `vitest.config.ts` dan `playwright.config.ts` tidak berubah.

Catatan backend-dev soal AC-5.13 (`dua[31m merah`: ESC dibuang, sisa `[31m` tetap ada) benar.
Asersi lama tidak diubah.

### Perubahan test oleh test-engineer di iterasi 2

| # | File | Perubahan | Dasar | Jenis |
|---|---|---|---|---|
| T1 | `dashboard/src/app/boot/m5-te-lifecycle-routes.test.ts` › AC-5.8 `toStage` | Fixture kini memberi selisih waktu nyata: install di T0, installer dilayani di +10 mnt dan +25 mnt (dua penyajian, token berotasi, `installerBoots` = 2), user-data di +35 mnt, callback `configuring` di +45 mnt. Entri `booting` diasersikan `[T0, +10, +25]`. `entered` kini **konstanta yang diharapkan** per tahap (booting = T0, installing = +35, configuring = +45), tidak lagi dibaca dari `.at(-1)`. Entri **pertama** tahap itu juga diasersikan = `entered`. Seluruh asersi lama (−1 dtk tetap, +1 dtk failed, `finished_at`, token 404, satu event, sapuan kedua no-op) tidak diubah | DEC-016 §1. Diverifikasi dengan mutasi: revert `stageEnteredAt` → AC-5.8 booting merah (sebelumnya hijau) | Pengetatan |

**Kesimpulan iterasi 2: tidak ada pelemahan. Setiap perbaikan wajib (SR-5-1, SR-5-2, CR-5-1,
CR-5-2, DR-5-1) punya test yang terbukti merah bila perbaikannya di-revert.**

## Iterasi 3 — backend-dev (CR-5-18, SR-5-12, SR-5-11, CR-5-19)

Tidak ada test lama yang diubah, dihapus, di-skip, atau dilonggarkan. Semua test lama lulus tanpa
perubahan, termasuk:
- **AC-5.13** (`m5-te-lifecycle-routes.test.ts:623`, `dua[31m merah\tkolom`) — **tidak berubah**.
  Pendekatan CR-5-18: `cleanAndRedact` meredaksi salinan yang sekuens ANSI-nya dibuang utuh; salinan
  bersih itu hanya dipakai bila memuat secret. Teks tanpa secret tetap diproses seperti iterasi 2
  (hanya karakter kontrol dibuang), jadi `[31m` tetap ada. Tidak ada migrasi ekspektasi.
- `stripControl(…, true)` tetap mempertahankan `\r` (test `m5-iter2-redact-timeout.test.ts:119-121`
  tidak berubah). Normalisasi `\r` (SR-5-12) dilakukan di `handleLogPost` sebelum redaksi body,
  sama dengan `splitLogLines`, sehingga baris yang tersimpan identik dengan iterasi 2.
- Footer END yatim `\n<b64>\nEND` → `[REDACTED PRIVATE KEY]` (iterasi 2) tetap: baris kosong di awal
  teks tetap ikut tersamarkan.

Perubahan perilaku (tanpa test lama terdampak):
- CR-5-19: footer END yatim hanya menelan baris base64 ≥ 16 karakter. Baris pendek tepat di atas footer
  ikut tertelan bila tidak berbentuk kata (`^[A-Z]?[a-z]+$` / `^[A-Z]+$`). Baris kosong hanya ikut bila
  di atasnya ada baris isi key atau awal teks. ~~Sisa risiko: baris akhir key yang pendek (< 16) dan
  hanya berisi huruf kapital (mis. `AQID`, byte padding OpenSSH) tidak teredaksi. Bagian itu adalah
  padding/komentar, bukan material kunci.~~ **Koreksi (iterasi 3 lanjutan, CR-5-23/SR-5-17):
  kalimat ini keliru.** Baris pendek berbentuk kata tepat di atas footer menghentikan pemindaian
  (`break`), sehingga **seluruh** baris isi key 64/70 karakter di atasnya lolos, bukan hanya baris
  pendek itu. Diperbaiki di bagian "Iterasi 3 — backend-dev (lanjutan)" di bawah.
- SR-5-12: `CONTROL_RE`/`CONTROL_KEEP_NL_RE` kini juga membuang `\p{Cf}` (seluruh kategori, mencakup
  U+00AD, U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+FEFF), sehingga ZWJ dalam emoji juga dibuang.

Test baru: `dashboard/src/lib/server/m5-iter3-redact.test.ts` (84 test).
| Temuan | Test |
|---|---|
| CR-5-18 | `token=`, path `/boot/<mac>/<token>`, dan `$6$` yang disisipi 7 jenis sekuens (`ESC[0m`, `ESC[31;1m`, `ESC[1m`, OSC `ESC]0;…BEL`, OSC `ESC]8;;…ESC\`, CSI 8-bit `\x9b2K`, `ESC(B`). Masing-masing diuji lewat `cleanEventMessage` (dengan asersi kontrol bahwa urutan iterasi 2 bocor) **dan** lewat `handleLogPost` → DB. Juga: secret dan ANSI di baris berbeda, AC-5.13 tetap (unit + `handleLogPost`), `stripAnsi` (OSC tanpa terminator tidak menelan baris), idempoten |
| SR-5-12 | (a) `PRIV\rATE KEY` tanpa footer dan varian CRLF dengan footer, lewat `handleLogPost`; (b) token path dan `token=` dipecah `\r`, lewat `handleLogPost`; (c) 17 karakter Cf di posisi < 8 token (path, `token=`, hash) + `stripControl`, dan U+200B di posisi 3 lewat `handleLogPost`; karakter non-Cf tidak dibuang |
| SR-5-11 | 16 KB spasi + `!` + footer, spasi + `!` + spasi, tab + footer di baris yang sama: hasil diasersikan, `redactSecrets` dan `cleanEventMessage` < 20 ms (terbaik dari 5 run untuk meredam jitter CI); `handleLogPost` 16 KB < 50 ms (termasuk transaksi DB). Pola lama: 268–1072 ms (merah) |
| CR-5-19 | probe review (`Langkah\nSelesai\n\n<b64>…END`); `Done`/`OK`/`DONE`/`Selesai`/`done`/`Traceback`/kosong tepat di atas footer dan di atas baris key tetap utuh; ekor key asli (baris 64 karakter, baris kosong di antara baris key, 6 variasi baris akhir pendek) tetap teredaksi; baris pendek non-adjacent tidak tertelan; `handleLogPost` dua request |

Mutasi cepat (backend-dev, test `m5-iter3` + `m5-iter2` + `m5-te-lifecycle-routes`, 162 test):
- pola baris key lama → 3 test performa merah, 15 merah bila batas panjang juga di-revert;
- tanpa salinan ANSI-free → 41 merah;
- tanpa normalisasi `\r` → 3 merah;
- tanpa `\p{Cf}` → 18 merah.

## Iterasi 3 — backend-dev (lanjutan: SR-5-16, SR-5-17, CR-5-23, CR-5-24, CR-5-25)

### Perubahan kode
- **SR-5-16 / CR-5-24** (`job-events.ts` `cleanAndRedact`): pemilihan salah satu salinan (bersih-ANSI
  *atau* asli) diganti **gabungan deteksi per karakter**. Dua salinan dibuat dari teks mentah, masing-
  masing dengan peta indeks ke teks mentah: `plain` (kontrol dibuang, termasuk byte ESC/`\x9b` saja)
  dan `bare` (sekuens ANSI dibuang utuh, lalu kontrol). Secret dideteksi di keduanya lewat
  `secretMarks` (`redact.ts`), yaitu deteksi yang sama dengan `redactSecrets` tetapi setiap karakter
  yang disamarkan diganti satu sentinel Private Use sehingga posisi tetap. Karakter mentah yang
  ditandai di salinan **mana pun** diganti placeholder (`[REDACTED]`, `[REDACTED PRIVATE KEY]`,
  `[REDACTED-B64]`) di output. Output dirender dari `bare` bila `bare` memuat secret, dari `plain` bila
  hanya `plain`, dan tanpa secret `plain` dikembalikan apa adanya.
  - Alasan tidak memakai urutan "redaksi mentah dulu lalu `stripAnsi` → `stripControl` →
    `redactSecrets`" seperti saran laporan: pola parsial (`HASH_PARTIAL_RE`, token path `{8,43}`) di
    tahap mentah berhenti di ESC dan menyamarkan hanya potongan pertama. Potongan kedua kehilangan
    prefiks `$6$`/`/boot/` lalu lolos di tahap berikutnya (contoh: `$6$salt ESC[0m salt$hash` →
    `$6$[REDACTED]salt$hash`), sehingga CR-5-18 akan regresi. Gabungan per karakter memenuhi syarat
    "secret yang terdeteksi di bentuk mana pun teredaksi di output" tanpa urutan antar-tahap.
  - `redactSecrets` tidak berubah perilakunya; hanya placeholder kini disuntikkan (`redactWith`).
- **SR-5-17 / CR-5-23** (`redact.ts` `redactOrphanKeyTail`/`isKeyBodyLine`): baris pendek (< 16)
  berbentuk kata kini ikut ditelan bila baris non-kosong di atasnya adalah baris isi key ≥ 16
  karakter (`longKeyLineAbove`). `break` hanya bila tidak. "Adjacent" = baris non-kosong pertama di
  atas footer; baris kosong di antaranya tidak lagi memutus adjacency. CR-5-19 tetap: `Done`/`OK`/
  `Selesai` (juga `AQID`) di atas teks biasa atau di atas baris pendek tetap utuh.

### Ekspektasi lama
**Tidak ada ekspektasi lama yang berubah.** AC-5.13 (`dua[31m merah\tkolom`, unit dan
`handleLogPost`, `m5-te-lifecycle-routes.test.ts`, `m5-iter3-redact.test.ts`) tetap. Tanpa secret,
output tetap salinan `plain` seperti iterasi 2. Semua test CR-5-18, SR-5-12, SR-5-11, dan CR-5-19
lulus tanpa diubah.

### Perubahan test lama (CR-5-25, pengetatan keandalan, bukan pelemahan)
| File | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `m5-iter3-redact.test.ts` › SR-5-11 "16 KB lewat handleLogPost" | Satu pengukuran `post` < 50 ms | Terbaik dari 5 run `post` (detik berbeda, job sama; jauh di bawah `LOG_RATE_PER_MIN` = 60) < 50 ms; diasersikan tepat 5 run dan setiap run `ok: true`; asersi `REDACTED_KEY` tetap | Satu pengukuran ikut menghitung jitter transaksi SQLite/GC/fsync sehingga rawan flaky (CR-5-25). Batas 50 ms **tidak dinaikkan**. Pola lama 268–1072 ms tetap merah. Asersi linear murni tetap ditanggung test 20 ms. |

### Test baru (`m5-iter3-redact.test.ts`, +60 test, total file 144)
| Temuan | Test |
|---|---|
| SR-5-16 (1)–(4), CR-5-24 | 6 kasus × (`cleanEventMessage` + idempoten, `handleLogPost` → DB), masing-masing dengan secret kedua di body yang sama: `ESC/boot/<mac>/<43>` + hash, `\x9b/boot/…` + hash, `ESC[token=<43>` + hash, `token=<43> pw=ESC$6$…`, `token=<20>ESC<23>` + hash dipecah `ESC[0m`, path dipecah `ESC[0m` + `token=ESC<43>`. Kasus (1) `token=<43>` + `ESC-----BEGIN` tanpa footer + 6 baris key lewat `cleanAndRedact`, `cleanEventMessage`, dan `handleLogPost`. Asersi: output persis, tidak ada potongan token ≥ 8, `Q{8}`, `saltsalt`, maupun baris key di **semua** pesan DB. Kontrol: secret terpotong tanpa secret kedua tetap teredaksi. |
| SR-5-17, CR-5-23 | `AQID`, `BAUG`, `AQIDBAUG`, `Abcdef`, `AAAA`, `QUJD`, `Ab` × baris key 64/70 karakter × baris kosong 0/1/2 di atas footer (42 test); baris kosong di antara baris key dan baris pendek; CR-5-19 tetap (`Done`/`OK`/`Selesai`/`AQID` di atas teks biasa, dengan/tanpa baris kosong, dan di atas baris pendek `ABCD1234`); `handleLogPost` dua request dengan ekor `AQID` + baris kosong. |

### Mutasi (backend-dev, `m5-iter3-redact.test.ts`)
- `cleanAndRedact` di-revert ke pemilihan salah satu salinan (`0c61ed8`) → **14 merah** (seluruh
  kasus SR-5-16/CR-5-24 kecuali kontrol tanpa secret kedua).
- `isKeyBodyLine` di-revert (tanpa `longAbove`, adjacency `cursor === start`) → **44 merah**; hanya
  tanpa `longAbove` → 44 merah; hanya adjacency lama → 29 merah.

### Probe ulang (sebelum commit)
Semua kasus SR-5-16 (1)–(4) + `\x9b`, CR-5-24 (dua bentuk), CR-5-18 (`token=`, `$6$`, `BEGIN … ESC[0m
PRIVATE KEY`, OSC 8), SR-5-12 (a/b/c), SR-5-17 (`AQID`/`BAUG`/`AQIDBAUG`/`Abcdef`/`AAAA`, dengan dan
tanpa baris kosong), CR-5-19 (`Done`/`OK`/`Selesai`) menghasilkan output tanpa secret. AC-5.13 tetap.
SR-5-11: 16 KB `cleanEventMessage` terbaik dari 5 = ±1 ms. Folder probe sementara
(`dashboard/src/zz-probe-tmp/`) dihapus sebelum commit.

### Sisa risiko (diketahui)
- Over-redaksi: baris pendek berbentuk kata tepat di atas footer yatim ikut tertelan bila di atasnya
  ada baris base64 ≥ 16 karakter (mis. log yang kebetulan memuat blob base64 lalu `Done` lalu footer
  END yatim). Ini lebih aman daripada sebaliknya.
- Deteksi digabung dari dua salinan saja (`plain`, `bare`); karakter tak terlihat di luar Cf
  (SR-5-18) tetap untuk M6.

## Iterasi 3 — frontend-dev (DR-5-8, DR-5-9)

Perubahan UI di `dashboard/src/components/os-images/os-images-view.tsx`:
- DR-5-8: sel ID tidak lagi `whitespace-nowrap`. Span ID memakai `wrap-break-word` di dalam sel
  `flex-1 min-w-0`, sehingga ID panjang turun baris di selnya sendiri dan tetap terbaca utuh (tidak
  dipotong). Font tetap mono (`type-data`). Alasan "tidak tersedia" (`min-w-0 wrap-break-word`) juga
  tidak meluber bila memuat id/path panjang.
- DR-5-9: batas layout kartu dinaikkan dari `md` ke `xl`. Tabel 9 kolom tidak muat di bawah kontainer
  ~950 px: dengan data bawaan saja, tabel di 1280 sudah 1039 px di kontainer 958 px. Kolom
  Arsitektur, Metode, dan Bootable digabung menjadi satu kolom "Platform" yang bertumpuk di desktop
  dan sebaris di kartu. Nama dibungkus (wrap), dan ID diberi `min-w-[12ch]` di desktop agar ID bawaan
  tidak dipecah di "-". Hasilnya, di 1280 tabel 958 = 958 dan di 1440 1118 = 1118, dengan data panjang.

Test lama: **tidak ada yang diubah atau dilonggarkan.** DR-5-1 375 (≤ 200 px per kartu, path ≤ 2
baris, halaman ≤ 300 + 200·n, `scrollWidth` ≤ 375) dan DR-5-1 1440 tetap seperti iterasi 2 dan lulus.
Test itu berjalan sebelum image panjang didaftarkan, sehingga tetap hanya memakai data bawaan.
Kolom "Bootable" ("Ya"/"Tidak") tidak diasersikan test mana pun. Teksnya kini "bootable"/"tidak
bootable", sama dengan kartu mobile.

Test baru di `dashboard/e2e/m5-library.spec.ts`:
| Test | Isi |
|---|---|
| DR-5-8 OS Images 375/414 | Mendaftarkan lewat API `ubuntu-24.04-custom-hwe-lab-rack07-node-image-01` (48 karakter, batas API) dan `debian-12.7-bookworm-netinst-lab-cluster-a` (42), dengan nama panjang dan segmen path ±60 karakter (pola `design-shots-iter2/p4.mjs`). Di 375×812 dan 414×896, untuk **setiap** kartu: kotak konten sel ID, "Dipakai", dan tombol Hapus tidak saling tumpang-tindih (> 0,5 px); tidak ada elemen kartu di luar kotak kartu; ID utuh (textContent = id, tanpa ellipsis, `scrollWidth ≤ clientWidth`) dan mono; `scrollWidth` halaman **=** lebar viewport; tabel tanpa overflow; tanpa drop shadow; oranye hanya tombol primary. Tinggi: image bawaan tetap ≤ 200 px (batas DR-5-1), image panjang ≤ 520 px (batas terpisah); halaman ≤ 300 + 200·n_bawaan + 520·n_panjang. Data uji dihapus di `finally`, dan setelahnya diasersikan sudah hilang. |
| DR-5-9 OS Images 1280/1440 | Data panjang yang sama. Tabel tanpa overflow, `scrollWidth` halaman ≤ lebar; untuk setiap baris, sisi kanan kolom Dipakai dan tombol Hapus ≤ sisi kanan kontainer; tidak ada overlap atau luberan; ID utuh. Untuk baris panjang: setelah gulir vertikal, `scrollX` = 0, lalu Hapus dan Dipakai berada di viewport. `ubuntu-24.04` tetap satu baris. Data dihapus di `finally`. |

Batas baru (bukan pelonggaran): **520 px** untuk kartu image panjang. Ukuran terukur 466 px (48
karakter @375) dan 416 px (@414); isinya ID 3 baris, nama 2 baris, alasan 4 baris, path 3–4 baris
masing-masing. Batas 200 px tetap berlaku untuk image bawaan di dalam test yang sama.

Ukuran terukur (anotasi Playwright):
- 375: kartu bawaan 154/154/196/154/197; panjang 407 dan 466; `scrollWidth` 375; halaman 1973 px (batas 2340); overlap 0.
- 414: kartu bawaan 154/154/196/154/197; panjang 356 dan 416; `scrollWidth` 414; halaman 1872 px; overlap 0.
- 1280: tabel overflow 0 (958 = 958), `scrollWidth` 1280; baris 120–146 px untuk bawaan, 303/335 untuk panjang.
- 1440: tabel overflow 0 (1118 = 1118), `scrollWidth` 1440.

Mutasi: komponen di-revert ke `7af8d05` (hanya ditambah `data-testid="img-id"`). DR-5-8 merah dengan
"@375 debian-12.7-…: sel saling tumpang-tindih". DR-5-9 merah dengan "@1280: scroll horizontal di
dalam tabel" (773 px).

## Iterasi 3 — frontend-dev, lanjutan (DR-5-12, DR-5-13, CR-5-26, I-5-15)

Perubahan UI di `dashboard/src/components/os-images/os-images-view.tsx`:
- DR-5-12: span ID, span nama, `PathText`, dan alasan "tidak tersedia" memakai `wrap-anywhere`, bukan
  `wrap-break-word`. Hanya `overflow-wrap: anywhere` yang ikut mengecilkan lebar min-content, sehingga
  token tanpa titik pecah tidak lagi menjadi lebar minimum kolom di `table-layout: auto`.
  `xl:min-w-[12ch]` pada ID tetap ada, jadi `ubuntu-24.04` tetap satu baris.
- DR-5-13: sel kartu Nama, Sumber, dan Ketersediaan diberi `max-xl:min-w-0`.
- I-5-15: sel Hapus di kartu memakai `-mt-1.5 -mb-1` (sebelumnya `-my-1.5`), sehingga kotak tombol
  tidak lagi beririsan 1,4 px dengan baris nama. Akibatnya kartu bawaan bertambah 2 px:
  154 → 156 dan 197 → 199. Batas DR-5-1 200 px tetap dan lulus, tetapi marginnya tinggal 1 px.

Test lama yang diubah (diperketat, tidak dilonggarkan):
- CR-5-26: di DR-5-8 dan DR-5-9, `registerLongImages` kini berada **di dalam** `try`. Cleanup
  `removeImages` di `finally` kini memverifikasi lewat `GET /api/os-images` bahwa tidak ada image uji
  yang tersisa. DR-5-9 juga ditambah verifikasi UI setelah `finally` (baris hilang), sama seperti DR-5-8.
- `rowGeometry.spill` kini juga memeriksa kotak **setiap node teks**. Teks yang meluber dari span
  `max-w-full` tidak mengubah kotak elemennya, sehingga sebelumnya lolos. Field baru `rowLeft`,
  `rowRight`, dan `containerLeft` diasersikan di test baru.
- Asersi, batas, dan data DR-5-1, DR-5-8, serta DR-5-9 lainnya tidak berubah.

Test baru di `dashboard/e2e/m5-library.spec.ts`:
- `EXTREME_IMAGES`:
  - `rocky9customlabimagebuildnumber00000000000000001` (48 karakter, tanpa "-")
  - nama `Ubuntu_Server_24_04_Custom_HWE_Lab_Rack07` (41 karakter, underscore, tanpa spasi)
  - nama 60 karakter tanpa spasi, "_", atau "-"
  - segmen path 110 karakter tanpa `/ . _ -`

  Bentuk data ini diasersikan di `registerExtremeImages`. Data didaftarkan bersama `LONG_IMAGES`.

| Test | Isi |
|---|---|
| DR-5-12 OS Images 1280/1440 | Tabel tanpa overflow; `scrollWidth` halaman ≤ lebar. Setiap baris: sisi kanan baris, Dipakai, dan Hapus ≤ sisi kanan kontainer; overlap 0; elemen/teks meluber 0; ID utuh. Untuk setiap image stres: `scrollX` = 0 setelah gulir vertikal; Hapus dan Dipakai di viewport; teks ID dan nama utuh. `ubuntu-24.04` satu baris; ID mono; tanpa drop shadow; oranye hanya CTA. Pendaftaran di dalam `try`; `finally` menghapus dan memverifikasi lewat API, lalu UI. |
| DR-5-13 OS Images 375/414 | Setiap kartu: overlap 0, elemen/teks meluber 0, ID utuh, kartu di dalam kontainer (kiri dan kanan), Hapus di dalam. `scrollWidth` kontainer **=** `clientWidth`; `scrollWidth` halaman **=** lebar viewport; nama utuh; tanpa drop shadow; oranye hanya CTA. Cleanup sama dengan DR-5-12. |

Ukuran terukur (anotasi Playwright):
- 1280: tabel 958 di kontainer 958, overflow 0. Sebelum perbaikan: 1037 px, overflow 79.
- 1440: tabel 1118 = 1118.
- 375: kontainer 325/325, halaman 375. Kartu stres 327/330/522/330 px.
- 414: kontainer 364/364. Kartu 314/296/389/276 px.

Mutasi:
1. Komponen di-revert ke `HEAD` `0c61ed8`:
   - DR-5-12 merah: "@1280: scroll horizontal di dalam tabel (tabel 1037 px)", overflow 79.
   - DR-5-13 merah: "@375 rocky9customlab…: elemen/teks meluber keluar kartu".
   - DR-5-8 dan DR-5-9 tetap hijau, seperti yang diharapkan.
2. Hanya `wrap-anywhere` → `wrap-break-word`: DR-5-12 merah (1037 px).
3. Hanya `max-xl:min-w-0` dihapus: DR-5-13 **tetap hijau**. `wrap-anywhere` sudah cukup untuk
   mengecilkan min-content item flex. `min-w-0` adalah pengaman tambahan, bukan satu-satunya perbaikan.
