# Code review M5, iterasi 3 (terakhir)

- Reviewer: code-reviewer, 2026-11-06
- Worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `0c61ed8`
- Lingkup: `git diff 7af8d05..0c61ed8` (`4d77111` backend CR-5-18/SR-5-12/SR-5-11/CR-5-19, `0c61ed8` frontend DR-5-8/DR-5-9)
- Acuan: `gate-iter2.md`, `review-code-iter2.md`, `test-migration.md` §Iterasi 3

## Verifikasi yang dijalankan (read-only)
| Perintah | Hasil |
|---|---|
| `npx tsc --noEmit` | rc 0 |
| `npm run lint` | rc 0 |
| `npx vitest run` (semua) | 48 file, **1206/1206 lulus** |
| `vitest run m5-iter3-redact.test.ts --coverage` 3x | 84/84 lulus setiap kali (test performa lulus dengan instrumentasi coverage) |
| Playwright | **Tidak dijalankan** (sesuai instruksi; port dipakai agent lain). E2E dinilai dari kode saja |
| `git diff 7af8d05..0c61ed8 --numstat` atas test | `m5-iter3-redact.test.ts` +266/-0; `m5-library.spec.ts` +207/-2. Dua baris yang dihapus hanya baris `import` yang diperluas. `vitest.config.ts`/`playwright.config.ts` tidak berubah. `m5-te-lifecycle-routes.test.ts` (AC-5.13) tidak berubah |
| `git grep` `.skip/.only/.todo/.fixme/xit/xdescribe` | 0 hit |
| `git diff --stat 7af8d05..0c61ed8 -- installers app/boot boot-script.ts infra` | **kosong**. Sejak `543cf5a` hanya ada perubahan yang sudah tercatat di `kvm-path-diff.txt` (string pesan `context.ts`, `infra/test/m5.sh`, `infra/test/run.sh`, test `app/boot`), dan semuanya dari sebelum iterasi 3 |
| Probe manual (jiti, skrip di scratchpad, memanggil `redact.ts`/`job-events.ts` asli) | lihat CR-5-23, CR-5-24, serta probe performa di bawah |

Probe performa (16 KB, satu run, tanpa coverage): `stripAnsi` untuk CSI tanpa final byte, `ESC[1` x 5000, OSC tanpa terminator 16 KB, dan `ESC]` x 8000 semuanya ≤ 0,3 ms. `redactSecrets` dengan 16 000 baris kosong + footer selesai dalam 1,2 ms; 64 footer yang masing-masing didahului 250 baris kosong selesai dalam 1,4 ms. Regex `ANSI_RE`, `PKEY_BODY_LINE_RE`, dan `WORD_RE` tidak punya kuantor bertumpuk, jadi linear. Pemindaian mundur di `redactOrphanKeyTail` paling buruk O(64·n) karena `guard < 64`.

## Status temuan wajib
| ID | Status | Bukti |
|---|---|---|
| **CR-5-18** | **Closed** (sisa: CR-5-24, minor) | `cleanAndRedact` (`job-events.ts:80-85`) meredaksi salinan yang sekuens ANSI-nya sudah dibuang utuh. Salinan itu hanya dipakai bila memuat secret; selain itu jalur iterasi 2 tetap berlaku. Ekspektasi AC-5.13 **tidak berubah**: `m5-te-lifecycle-routes.test.ts` tidak tersentuh, dan `m5-iter3-redact.test.ts:129-135` menambahkan asersi `dua[31m merah\tkolom` lewat unit dan `handleLogPost`. Test mencakup 7 jenis sekuens × 3 bentuk (`token=`, path, `$6$`) lewat `cleanEventMessage` maupun `handleLogPost` → DB, ditambah asersi kontrol bahwa urutan iterasi 2 memang bocor (`:109`). Pengecualian `\x9b` + hash di `:107-109` sudah dijelaskan dan benar. Probe ulang atas tiga kasus dari iter2 (`token=`, path, `$6$` + `ESC[0m`) sekarang menghasilkan `[REDACTED]` utuh |
| **CR-5-19** | **Closed** (ada regresi terkait: CR-5-23, minor) | Probe iter2 `Langkah\nSelesai\n\n<b64>\n<b64>\nEND\nafter` sekarang menghasilkan `Langkah\nSelesai\n\n[REDACTED PRIVATE KEY]\nafter` (`:237-240`). Kata tunggal dan baris kosong di atas footer atau di atas baris key tetap utuh (`:241-244`). Kasus iter2 `\n<b64>\nEND` tetap teredaksi (`:254`) |

Catatan untuk SR-5-11 dan SR-5-12 (penilaian akhir ada di security-reviewer): pola baris key sudah linear, dan test performanya terbukti merah dengan pola lama (268–1072 ms menurut `test-migration.md`). Normalisasi `\r` di `provisioning.ts:314` setara dengan `splitLogLines`, yang memang sudah membuang `\r` per baris, jadi tidak ada perubahan pada log sah. Regex `\p{Cf}` dengan flag `u` sudah benar: rentang C0/C1 tetap sama dengan iterasi 2, `\t` dipertahankan, dan `\r` hanya dipertahankan di `CONTROL_KEEP_NL_RE`.

## Temuan baru
| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-5-23 | minor | `dashboard/src/lib/server/redact.ts:79-84,111`; `.agent/runs/m5/test-migration.md:172-174` | **Regresi dari perbaikan CR-5-19.** Pada footer END yatim, bila baris isi key terakhir tepat di atas footer pendek (< 16) dan **berbentuk kata** menurut `WORD_RE` (mis. `AAAA`, `QUJD`, `Ab`, `abc`, `Zz`), `isKeyBodyLine` mengembalikan false lalu `break`. Akibatnya **semua baris key 64/70 karakter di atasnya tidak teredaksi**; hanya footer yang tersamar. Probe: `<b64 64>×4\nAAAA\n-----END OPENSSH PRIVATE KEY-----\nafter` menghasilkan 4 baris base64 utuh + `AAAA` + `[REDACTED PRIVATE KEY]`. Di iterasi 2, `AAAA` cocok dengan pola lama sehingga seluruh ekor tersamar. `test-migration.md` menyebut sisa risikonya hanya "baris akhir key yang pendek … padding/komentar, bukan material kunci", padahal yang bocor adalah seluruh isi key pada request kedua. Kemungkinannya kecil: baris akhir harus 1–15 karakter, tanpa `=`, dan berbentuk kata. Server juga tidak pernah mengirim private key ke node, jadi ini hanya lapisan pertahanan tambahan, sejenis CR-5-20(a). Meski begitu, ini regresi pada jalur yang dibuat khusus untuk SR-5-2 | Jangan `break` pada baris adjacent yang berbentuk kata bila baris di atasnya adalah baris key ≥ 16 karakter: ikutkan keduanya, dan pertahankan kata tunggal hanya bila tidak ada baris key di atasnya. Tambah test `KEY_LINES + "AAAA"/"QUJD"/"Ab" + END` yang mengasersikan tidak ada `KEY_LINES` tersisa. Perbaiki kalimat sisa risiko di `test-migration.md` |
| CR-5-24 | minor | `dashboard/src/lib/server/db/repos/job-events.ts:56,80-85` | `cleanAndRedact` memilih **salah satu** salinan: bersih-ANSI atau asli. Alternatif ke-4 `ANSI_RE` (`\x1b[ -/]*[0-~]`) dan CSI 8-bit `\x9b…[@-~]` ikut menelan **satu karakter sesudah ESC/`\x9b`**. Karena itu `token=<20>ESC<23>` hanya tertangkap lewat salinan asli, di mana `stripControl` membuang ESC saja sehingga token kembali 43 karakter. Bila pesan yang sama juga memuat secret lain yang dipecah sekuens ANSI, cabang salinan bersih yang dipilih, dan token `token=` tersimpan 42/43 karakter. Probe: `token=<20>ESC<23> $6$s$QQQQQ ESC[0m Q…` menjadi `token=abcDEF0123456789_-abDEF0123456789_-abcDEFG $6$[REDACTED]`. Probe dengan path ANSI + `token=ESC<43>` memberi hasil serupa. Bentuk path tetap aman karena `TOKEN_PATH_PARTIAL_RE {8,43}`. Di iterasi 2 kasus `token=` ini teredaksi (yang bocor ekor hash), jadi ini pertukaran kecil. Dampaknya rendah: token tidak pernah dikirim dalam bentuk `token=` (CR-5-21), dan payload semacam ini harus disusun oleh pemegang token | Pilih salah satu: (a) pakai alternatif ke-4 hanya untuk ESC + intermediate (`\x1b[ -/]+[0-~]`), sedangkan ESC tunggal + huruf/angka diserahkan ke `stripControl` (yang membuang ESC saja); (b) jalankan redaksi berurutan, `redactSecrets(stripControl(stripAnsi(redactSecrets(stripControl(raw, keep)))))`, lalu sesuaikan agar AC-5.13 tetap; atau (c) jadikan `TOKEN_KV_RE` parsial `{8,43}` (bersama CR-5-21). Tambah test kasus campuran |
| CR-5-25 | minor | `dashboard/src/lib/server/m5-iter3-redact.test.ts:226-230` | Test performa `handleLogPost` memakai **satu** pengukuran dengan batas 50 ms, termasuk transaksi SQLite, sehingga rawan flaky di CI yang sibuk atau saat coverage aktif (GC, fsync, jitter). Test `redactSecrets`/`cleanEventMessage` (`:221-225`) memakai yang terbaik dari 5 run dengan batas 20 ms. Itu wajar: hasil terukur sekitar 1 ms (margin ~20×), sedangkan pola lama 268–1072 ms. Test-test itu tetap lulus 3× berturut-turut dengan coverage | Ubah ke yang terbaik dari 3 run (`post` ke job yang sama melewati rate limit? periksa `LOG_RATE_PER_MIN`), atau naikkan batas ke ±150 ms. Batas itu tetap jauh di bawah pola lama, dan asersi linear murni sudah ditanggung test 20 ms |
| CR-5-26 | minor | `dashboard/e2e/m5-library.spec.ts:315,363` (`registerLongImages` di luar `try`) dan `:362-397` | Bila `registerLongImages` gagal setelah image pertama berhasil didaftarkan, mis. image kedua mendapat 409 atau 5xx, `finally` tidak dijalankan dan image 48 karakter tertinggal. Dengan `workers: 1` + serial, sisa data ini memengaruhi test berikutnya di file yang sama, mis. hitungan kartu dan tinggi halaman. DR-5-9 juga tidak mengasersikan bahwa data sudah hilang setelah `finally`, padahal DR-5-8 melakukannya | Pindahkan `registerLongImages` ke dalam `try`; `removeLongImages` sudah menerima 404. Tambah asersi `toHaveCount(0)` setelah DR-5-9 |
| CR-5-27 | info | `dashboard/src/lib/server/provisioning.ts:314`, `job-events.ts:80-85` | Keputusan memakai salinan bersih-ANSI berlaku untuk **seluruh body request**. Satu baris berisi secret yang dipecah ANSI membuat sisa sekuens (`[32m`) di baris **lain** pada request yang sama ikut hilang (test `:122-127` mengasersikan ini). Akibatnya baris log yang sama bisa tersimpan berbeda tergantung isi baris lain dalam request yang sama. Tidak berbahaya karena hanya kosmetik | Opsional (M6): jalankan `cleanAndRedact` per baris setelah redaksi blok key di seluruh body |
| CR-5-28 | info | `dashboard/src/lib/server/redact.ts:79-84`; `job-events.ts:44` | Over-redaksi dan pembuangan yang tidak berbahaya: (a) baris satu kata ≥ 16 huruf di atas footer yatim (mis. `ConfigurationDone`) ikut tertelan (probe); (b) `\p{Cf}` juga membuang ZWJ, bidi mark, dan tag char, sehingga emoji ZWJ terpecah. Hal ini sudah dicatat di `test-migration.md` | Tidak perlu tindakan |
| CR-5-29 | info | `dashboard/src/lib/server/provisioning.ts:314` | Iterasi 3 mengubah jalur ingest log yang dipakai node saat KVM, yaitu `handleLogPost`. Namun file ini tidak termasuk daftar pemicu run KVM ulang di `gate-iter2.md` (`installers/shell.ts`, `app/boot/**`, `boot-script.ts`, `infra/`), dan route `app/boot/**` tidak berubah. Perilakunya pada log sah identik (karena `\r` sudah dibuang oleh `splitLogLines`) dan tercakup test integrasi `handleLogPost`. Bukti KVM tetap berlaku sesuai DEC-016 | Cantumkan file ini secara eksplisit di `kvm-path-diff.txt` iterasi 3 |

### Frontend (DR-5-8/DR-5-9), dari sisi kode
- `os-images-view.tsx`: breakpoint kartu dinaikkan secara konsisten dari `md` ke `xl` di semua kelas. `COLS` 9→7 sesuai jumlah `TableHead` (7). Sel ID memakai `flex-1 min-w-0` dengan span `inline-block max-w-full wrap-break-word`, yang didukung Tailwind 4.3.4 (terpasang). Kolom "Bootable" ("Ya"/"Tidak") dihapus, dan menurut grep tidak ada test yang memakainya.
- E2E DR-5-8 sudah memenuhi syarat gate: ID 48 dan 42 karakter, path panjang, viewport 375 dan 414, asersi bounding box ID/Dipakai/Hapus tanpa overlap (> 0,5 px) untuk **setiap** kartu, tanpa luberan, ID utuh (bukan ellipsis), `scrollWidth` = viewport, dan batas DR-5-1 (≤ 200 px) tetap berlaku untuk image bawaan. Batas 520 px untuk kartu image panjang adalah batas **baru**, bukan pelonggaran, dan dicatat dengan ukuran terukur 466/416 px. Mutasi revert komponen menghasilkan merah (`test-migration.md`). Asersi DR-5-1 lama tidak diubah (diff hanya berupa penambahan).
- Satu hal tidak dinilai karena Playwright tidak dijalankan: kelulusan aktual E2E. Itu harus dipastikan dari log E2E test-engineer di HEAD final.

## Test yang dilemahkan / di-skip
Tidak ada. Diff test hanya berupa penambahan; tidak ada perubahan pada config test maupun pada ekspektasi AC-5.13.

## Ringkasan per severity
| Severity | Jumlah | ID |
|---|---|---|
| critical | 0 | — |
| major | 0 | — |
| minor | 4 | CR-5-23, CR-5-24, CR-5-25, CR-5-26 |
| info | 3 | CR-5-27, CR-5-28, CR-5-29 |

CR-5-18 dan CR-5-19 **Closed**. Typecheck dan lint bersih, unit test 1206/1206 lulus di `0c61ed8`, tanpa test yang di-skip atau dilemahkan. Jalur `installers/**`, `app/boot/**`, `boot-script.ts`, dan `infra/` tidak berubah di iterasi 3. CR-5-23 adalah regresi kecil pada redaksi ekor key yatim dan kalimat sisa risikonya di `test-migration.md` keliru, jadi disarankan diperbaiki atau dicatat secara eksplisit sebagai sisa risiko untuk M6 bersama CR-5-20. Keputusan ada di gatekeeper.

---

## Tinjauan lanjutan atas `0c61ed8..40ef24d`

> Ditulis oleh Orchestrator dari laporan code-reviewer (tanpa tool Write), isinya tidak diubah.

### Verifikasi
- `tsc --noEmit` dan lint bersih.
- `npm run test` dengan coverage: 1266/1266 lulus, tanpa skip/todo/only. Coverage `redact.ts` 100/97,4/100/100 dan `job-events.ts` 97,9/94,2/94,1/97,7.
- Satu-satunya `expect` yang dihapus berasal dari test perf `handleLogPost` lama. Test itu ditulis ulang dengan batas 50 ms yang sama.
- Uji diferensial acak 50.000 input, membandingkan `cleanAndRedact` dengan `redactSecrets` pada teks tanpa ANSI: 0 selisih setelah placeholder berurutan dinormalisasi. Surrogate, CRLF, dan AC-5.13 benar. Perf 16 KB sekitar 1,4 ms.
- Playwright tidak dijalankan.

### Status
| ID | Status | Bukti |
|---|---|---|
| CR-5-23 | **Closed** | `redact.ts:80-98`: `longKeyLineAbove` dievaluasi lazy dan tetap linear. Test mencakup 42 kasus ditambah 2 request lewat `handleLogPost`. CR-5-19 tetap tertutup. Kalimat sisa risiko di `test-migration.md` sudah dikoreksi. Mutasi menghasilkan 44 merah. |
| CR-5-24 | **Closed** (sisanya dicatat di CR-5-30) | `job-events.ts:76-145`: tanda dari view `plain` dan `bare` digabung lewat peta indeks. Kasus CR-5-24 dan SR-5-16 diuji lewat `cleanEventMessage` dan `handleLogPost` → DB. Revert ke perilaku lama menghasilkan 14 merah. Alasan menolak opsi (b) masuk akal. |
| CR-5-25 | **Closed** | Diambil yang terbaik dari 5 run, dengan asersi 5 run `ok:true`. Batas 50 ms tidak dinaikkan. |
| CR-5-26 | **Closed** | Pendaftaran berada di dalam `try`. `removeImages` memverifikasi tidak ada sisa lewat `GET /api/os-images`. DR-5-9 juga mengasersikan `toHaveCount(0)` di UI. |

### Temuan baru
| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-5-30 | minor (bukan regresi) | `job-events.ts:58,109-145`; `redact.ts:24` | Sisa celah dari penggabungan dua view. Secret yang dipecah ANSI utuh (merusak `plain`) **dan** escape yang menelan satu karakter (merusak `bare`) tidak terdeteksi di kedua view. Contoh: `token=<20>ESC[0mESC<23>` disimpan sebagai 43 karakter token utuh yang hanya disela `[0m`. Bila ada secret kedua, 42/43 karakter tersimpan dari `bare`. Bentuk path dan hash aman. Bentuk key setara dengan CR-5-20(b). Klaim docstring dan `test-migration.md` ("tidak lagi meloloskan sisa secret") terlalu luas. Dampak rendah: token tidak dikirim dalam bentuk `token=`, dan payload harus disusun oleh pemegang token. | (a) Batasi alternatif ke-4 `ANSI_RE` ke `\x1b[ -/]+[0-~]`; atau (b) jadikan `TOKEN_KV_RE` parsial `{8,43}` di M6 bersama CR-5-21. Minimal: catat sebagai sisa risiko dan perbaiki kalimat klaimnya. |
| CR-5-31 | minor | `e2e/m5-library.spec.ts:136-148, 218` | Test geometri OS Images (DR-5-1/8/12/13) tidak menunggu `document.fonts.ready`, padahal font memakai `font-display: swap`. Dengan margin 1 px (windows-2022 199/200), pengukuran sebelum font termuat bisa menambah satu baris dan membuat test merah. | Tambahkan `await page.evaluate(() => document.fonts.ready)` setelah `goto`. Jangan menaikkan batas 200 tanpa decision. |
| CR-5-32 | info | `os-images-view.tsx:277,299,304` | Mutasi "hapus `min-w-0` saja" tidak terdeteksi karena `min-w-0` redundan selama `wrap-anywhere` ada. Mutasi yang bermakna terbukti merah. Ini bukan test yang lemah. | Beri komentar bahwa keduanya redundan, atau hapus `min-w-0`. |
| CR-5-33 | info | `redact.ts:114-125` | Adjacency baru membuat baris pendek non-kata yang dipisah baris kosong dari footer yatim ikut ditelan. Over-redaksi yang tidak berbahaya. | Tidak perlu tindakan. |
| CR-5-34 | info | `e2e/m5-library.spec.ts:271-280` | Kalau test dan cleanup sama-sama gagal, error cleanup menutupi error asli. | Opsional: gunakan `expect.soft` atau `test.step`. |
| CR-5-35 | info | `os-images-view.tsx:76-89` (`PathText`) | `wrap-anywhere` diwarisi segmen path, sehingga kolom Sumber di desktop bisa menyempit dan segmen pendek terpecah di tengah kata. DR-5-12 tidak mengasersikan pemenggalan path di "/". | Serahkan ke design-reviewer. Opsional: asersi `sourceLineCounts` ≤ 2 untuk image bawaan. |
| CR-5-36 | info | `job-events.ts:116-145`; `redact.ts` (`secretMarks`) | Kosmetik dan keterbacaan: variabel `found` redundan, placeholder bisa terpecah atau tergabung, sentinel U+E001 di dalam blok key. Fuzz tidak menemukan kebocoran tambahan. | Opsional: rapikan dan lengkapi docstring. |

### Ringkasan (tinjauan lanjutan)
critical 0 · major 0 · minor 2 (CR-5-30, CR-5-31) · info 5 (CR-5-32..CR-5-36). CR-5-23..CR-5-26 Closed. Tidak ada test yang di-skip atau dilemahkan.
