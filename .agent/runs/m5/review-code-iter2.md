# Code review M5, iterasi 2

- Reviewer: code-reviewer, 2026-11-06.
- Worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `9328f65`.
- Lingkup: `git diff d19b44c..9328f65`, yaitu perbaikan iterasi 2 beserta bukti. Acuan: `gate-iter1.md`, `review-code-iter1.md`, `review-security-iter1.md`, DEC-016.
- Laporan ini bukan approval. Keputusan ada di gatekeeper.

## Verifikasi yang dijalankan (read-only)
| Perintah / cek | Hasil |
|---|---|
| `npx tsc --noEmit` @ `9328f65` | rc 0 |
| `npm run lint` @ `9328f65` | rc 0 |
| `npx vitest run` @ `9328f65` | 47 file, **1122/1122 lulus**. Angka ini sama dengan `unit.log` @ `fb8077e` |
| `git diff --stat fb8077e..9328f65 -- dashboard infra configs scripts` | **kosong**. Setelah `fb8077e` hanya ada perubahan di `.agent/runs/m5/**` (screenshot, `secret-scan.txt`, `test-migration.md`, `typecheck.log`, `unit.log`) |
| `git diff --stat 16d390d..fb8077e` | hanya `m5-te-lifecycle-routes.test.ts`, yaitu pengetatan T1 |
| `git diff --stat a668a88..9328f65` | hanya `secret-scan.txt` |
| Header log `typecheck/lint/unit/e2e/infra-test.log`, `coverage-m5-new-code.txt`, `ac-trace.md` | semuanya `fb8077e`. E2E 86 lulus, infra 47/47, coverage kode baru lines 98.34% / branches 95.72% |
| grep `.skip/.only/.todo/.fixme/xit/xdescribe/skipIf/runIf/test.fail` di `dashboard/src`, `dashboard/e2e`, `dashboard/e2e-kvm`, `infra/test` | 0 hit |
| Baris `-` di file test (`d19b44c..9328f65`) | Ada dua jenis: (1) import `m5-library.spec.ts` yang ditambah `Locator`; (2) fixture `toStage` AC-5.8 yang **diperketat**. `.at(-1)` diganti nilai harapan tetap, ditambah asersi entri `booting` `[T0,+10,+25]` dan `installerBoots` = 2. Tidak ada pelemahan. Ini cocok dengan `test-migration.md` T1/F1–F8 |
| `mutation-iter2.txt` / `test-migration.md` §Iterasi 2 | Setiap perbaikan (SR-5-1, SR-5-2 body/orphan, TOKEN_PATH_PARTIAL, PCT, HASH_PARTIAL, CR-5-2, DR-5-1 375/1440) terbukti merah bila di-revert |
| Probe redaksi manual (skrip di scratchpad, memanggil `redact.ts`) | lihat CR-5-18..CR-5-21 |

## Status temuan wajib dari iterasi 1
| ID | Status | Catatan |
|---|---|---|
| **CR-5-1** (+ SR-5-5 a) | **Closed** | `redact.ts:15` `TOKEN_PATH_PARTIAL_RE` `{8,43}`, `redact.ts:17` `TOKEN_PATH_PCT_RE` (`%2F`/`%2f`, MAC `%3A`), dan `redact.ts:23` `HASH_PARTIAL_RE`. `SECRET_IN_DECODED_RE` juga memakai `{8}` serta bentuk pct sehingga base64 berisi token parsial ikut tertangkap. Urutan replace sudah benar: hash utuh lebih dulu, lalu parsial; `$6$[REDACTED]` tidak cocok lagi, jadi hasilnya idempoten. Test mencakup setiap panjang 8..43 di batas `cut -c1-240`, 4 bentuk MAC, hash terpotong di setiap panjang (biasa dan rounds), kasus negatif, dan `handleLogPost` end-to-end. Celah sisa yang kecil ada di CR-5-21 (info) |
| **CR-5-2** | **Closed** (DEC-016 §1) | `job-lifecycle.ts:69-72` memakai entri **pertama** tahap aktif dengan fallback `createdAt`. Semantik ini benar karena mesin status hanya maju: selain `booting`, setiap status punya tepat satu entri (`provisioning.ts:131,208`, `discovery.ts:180`). Konsumen lain `stageEnteredAt` atau penghitung deadline di UI tidak ada (sudah di-grep). Test ≥ 2 penyajian ada di `m5-iter2-redact-timeout.test.ts:281-312` dan AC-5.8 route (T1); keduanya merah saat di-revert |
| **CR-5-12** | **Closed** | Semua log dan coverage dibuat di `fb8077e`. `fb8077e..9328f65` terbukti hanya berisi bukti, kode produk tidak berubah. Run ulang reviewer di HEAD menghasilkan 1122/1122 dan tsc/lint rc 0, sama dengan log |
| **SR-5-1** | **Closed untuk karakter kontrol tunggal**, dengan sisa **CR-5-18** (minor) | Urutan sekarang strip → redaksi → potong (`job-events.ts:79-81`, juga body log di `provisioning.ts:313`). Test memakai ESC/\x01 di dalam token dan hash. **Sekuens** ANSI utuh (`ESC[0m`) masih memecah secret, lihat CR-5-18. Keputusan akhir ada di security-reviewer |
| **SR-5-2** | **Closed** | Redaksi seluruh body sebelum `splitLogLines` (`provisioning.ts:313`), ditambah `redactOrphanKeyTail` untuk footer yatim. Batas 413 tetap dihitung dari body mentah (ada test). Efek samping: CR-5-19 (minor, over-redaksi). Celah sisa: CR-5-20 (info) |
| **SR-5-9** | **Closed (sisi kode)** | `secret-scan.txt` @ `a668a88`. Sesudahnya hanya file scan itu sendiri yang berubah. 3 hit "di luar fixture" adalah rujukan-diri pemindai (`b64-scan.py` dengan pola `DUMMY_PASSWORD`, serta kutipan header di laporan lama). Klasifikasinya masuk akal; konfirmasi akhir ada di security-reviewer |
| **DR-5-1** (major, design) | **Test regresi ada dan sah**. Penutupan ditentukan design-reviewer | E2E `m5-library.spec.ts` DR-5-1 375 (kartu ≤ 200 px, halaman ≤ 300 + 200·n, tanpa overflow, path ≤ 2 baris) dan 1440. Mutasi ke `d19b44c` memerahkan keduanya (751 px; 3 baris). Implementasi `os-images-view.tsx` memakai satu DOM dengan `max-md:` flex-wrap dan `order`, sehingga testid tidak duplikat; `PathText` mempertahankan textContent |

## Temuan baru
| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-5-18 | minor | `dashboard/src/lib/server/db/repos/job-events.ts:79-81`, `dashboard/src/lib/server/redact.ts:15,19,23` | Perbaikan SR-5-1 hanya membuang **karakter** kontrol. Pada **sekuens** ANSI CSI/OSC, yaitu vektor yang disebut SR-5-1 sendiri (ANSI, progress bar), yang terbuang hanya ESC/BEL, sedangkan `[0m`, `]0;x` dan sejenisnya tetap ada lalu memecah secret. Hasil probe (strip → `redactSecrets`): `token=<20>ESC[0m<23>` menjadi `token=abcDEF0123456789_-ab[0mcDEF…` sehingga **token 43 karakter lolos utuh dalam dua potongan**; `/boot/<mac>/<20>ESC[1m<23>/…` menjadi `/boot/<mac>/[REDACTED][1mcDEF0123456789_-abcDEFG/…` sehingga sufiks 23 karakter lolos; `$6$salt$<18>ESC[0m<68>` menjadi `$6$[REDACTED][0mQQQ…` sehingga sisa 68 karakter hash lolos. Dampaknya kecil: di alur saat ini token hanya muncul di path, token dicabut saat `failed`, dan salt teredaksi. Meski begitu, janji AC-5.12 ("DB tanpa token plaintext") belum sepenuhnya tertutup untuk vektor yang disebut temuan aslinya. | Sebelum redaksi, buang juga sekuens ANSI utuh, misalnya `\x1b\[[0-?]*[ -/]*[@-~]` dan `\x1b\][^\x07\x1b]*(?:\x07\|\x1b\\)`. Ini mengubah ekspektasi AC-5.13 `dua[31m merah` (`m5-te-lifecycle-routes.test.ts:623`), sehingga perlu entri migrasi yang sah. Alternatif tanpa mengubah AC-5.13: jalankan `redactSecrets` atas salinan yang sekuens ANSI-nya dibuang, dan bila hasilnya berbeda, simpan salinan teredaksi itu. Tambah test dengan `ESC[0m` di dalam token (`token=`, path) dan hash |
| CR-5-19 | minor | `dashboard/src/lib/server/redact.ts:29` (`PKEY_BODY_LINE_RE`), `:65-79` (`redactOrphanKeyTail`) | Pola "baris isi key" `^[ \t]*[A-Za-z0-9+/=]*[ \t]*\r?$` juga cocok dengan **baris kosong dan baris satu kata** (`Selesai`, `done`, `OK`, `Traceback`). Akibatnya footer END yatim ikut menelan baris diagnostik yang berurutan di atas isi key. Probe: `"Langkah\nSelesai\n\n<b64>\n<b64>\n-----END …-----\nafter"` menjadi `"[REDACTED PRIVATE KEY]\nafter"`, sehingga baris `Langkah` dan `Selesai` hilang dari log job. Sifatnya over-redaksi (aman dari sisi secret), tetapi mengurangi nilai diagnostik di jalur gagal, padahal jalur ini justru ada untuk diagnostik. Test yang ada (`"installer: langkah 3"`) kebetulan memuat spasi dan `:`, jadi kasus ini tidak teruji | Batasi baris isi, misalnya base64 dengan panjang ≥ 16 karakter (baris key OpenSSH/PEM 64/70 karakter), dan izinkan baris kosong hanya bila diapit baris base64. Bisa juga berhenti di baris kosong pertama. Tambah test: kata tunggal dan baris kosong di atas ekor key tetap utuh |
| CR-5-20 | info | `dashboard/src/lib/server/redact.ts:65-79`, `provisioning.ts:313` | Ada tiga celah sisa redaksi key lintas-request. (a) Ekor key yang barisnya berprefiks, misalnya timestamp `[  1.2] MIIE…`, tidak dikenali sebagai isi sehingga hanya footer yang tersamar (terbukti dengan probe). (b) Request yang hanya berisi baris isi tanpa BEGIN maupun END tidak tersamar sama sekali. (c) `guard < 64`: footer yatim ke-65 dan seterusnya dalam satu body tidak diproses, dan redaksi per baris di `appendEvent` hanya menyamarkan baris footer. Kecil kemungkinan muncul dari installer jujur; pemegang token bisa memicunya, tetapi pemegang token memang sudah memegang secret-nya | Catat sebagai sisa risiko. Uji dengan fixture log installer nyata saat SR-5-5(c) di M6 |
| CR-5-21 | info | `dashboard/src/lib/server/redact.ts:15-23` | Celah kecil yang tersisa di luar lingkup permintaan gate: prefiks token 1–7 karakter (sesuai `{8,43}` yang diminta); `token=` parsial (< 43; saat ini token tidak pernah dikirim dalam bentuk `token=`); double-encoding `%252F`; campuran `/boot%2F…`. Sebaliknya, `HASH_PARTIAL_RE` meredaksi teks non-hash seperti `awk '{print $6$7}'` menjadi `$6$[REDACTED]`. Ini over-redaksi yang tidak berbahaya | Tidak perlu tindakan di M5. Pertimbangkan di M6 bersama SR-5-5(b, c) |
| CR-5-22 | info | `.agent/runs/m5/kvm-path-diff.txt:49` | Alasan "pada alur KVM normal installer dilayani sekali, sehingga entri `booting` pertama dan terakhir praktis sama" kurang tepat. Entri `booting` pertama dibuat saat **Install diklik** (`source: "install"`, `install-service.ts:89`), bukan saat installer dilayani. Di bawah DEC-016, timer Booting kini juga mencakup waktu tunggu antara klik dan PXE boot. Kesimpulan bahwa bukti KVM tetap berlaku masih benar, karena run KVM mencapai Installing jauh di bawah 60 menit dan node11 (destroy) berada di tahap Installing | Perbaiki redaksi kalimat di bukti berikutnya bila disentuh. Tidak memengaruhi gate |

## Catatan kualitas (tanpa temuan)
- `cleanEventMessage` meredaksi sebelum memotong 2048 karakter, sehingga pemotongan tidak menghasilkan token parsial baru (ada test di `m5-iter2-redact-timeout.test.ts:113`).
- `stripControl(…, true)` mempertahankan `\r`, yang tetap dikenali `PKEY_BODY_LINE_RE` (`\r?$`) dan dibuang `splitLogLines`. Konsisten.
- `TOKEN_PATH_PCT_RE` memakai kuantor lazy terbatas `{12,60}?` dan berhenti di `%2F` pertama setelah MAC. Tidak ada risiko backtracking yang berarti; seluruh regex baru terbatas panjangnya.
- Frontend: `stripHostPrefix` aman karena hanya membuang prefiks persis `"<label>: "` di awal, sekali, dan diuji negatif. `localizeValidationMessage` hanya memetakan pola zod yang dikenal, sedangkan pesan kustom dikembalikan utuh. `withRequired` memakai `form` saat submit; bila user mengetik selama request berjalan, pesan "Wajib diisi" bisa sedikit basi, tetapi hal ini sepele. Pola `deleteOpen`/`toDelete` (I-5-3) benar: aksi hapus tetap memakai `toDelete` yang dipertahankan, dan dialog dibuka ulang lewat `setToDelete` + `setDeleteOpen(true)`. `import { cn } from "cn"` mengikuti pola komponen yang sudah ada sejak baseline.
- Pesan pengguna DR-5-4 diganti tanpa mengubah asersi lama; potongan teks yang diasersikan tetap ada.

## Ringkasan
| Severity | Jumlah | ID |
|---|---|---|
| critical | 0 | — |
| major | 0 | — |
| minor | 2 | CR-5-18, CR-5-19 |
| info | 3 | CR-5-20, CR-5-21, CR-5-22 |

Temuan wajib dari sisi kode sudah tertutup: CR-5-1, CR-5-2, CR-5-12, SR-5-2, dan SR-5-9. SR-5-1 tertutup untuk karakter kontrol tunggal. Sisa vektor sekuens ANSI dicatat sebagai CR-5-18 (minor), dan penilaian akhirnya diserahkan ke security-reviewer. Untuk DR-5-1, test regresinya sah (terbukti dengan mutasi), sedangkan penutupannya ditentukan design-reviewer. Tidak ada test yang di-skip atau dilemahkan. Typecheck dan lint bersih, 1122/1122 unit test lulus di HEAD, dan bukti iterasi 2 konsisten dengan HEAD.
