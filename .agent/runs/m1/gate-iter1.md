<!-- Disimpan Orchestrator dari keputusan agent gatekeeper (verbatim). -->
## Keputusan gatekeeper, iterasi 1 (branch milestone/1-3-baseline @ 8f4b2d7)

Hasil: **M1 CHANGES_REQUESTED · M2 CHANGES_REQUESTED · M3 CHANGES_REQUESTED.** Tidak ada yang BLOCKED: ini iterasi ke-1, semua FAIL bisa diperbaiki oleh dev, dan M1–M3 tidak butuh bukti KVM.

### Pemeriksaan lintas milestone (berlaku untuk M1, M2, dan M3)

**Log yang dipakai bersama.** Isi `typecheck.log`, `lint.log`, `unit.log`, `coverage-summary.txt/.json`, dan `e2e.log` di m1/, m2/, dan m3/ identik byte-per-byte (saya cek dengan `cmp`). Artinya hanya ada satu run untuk satu codebase.

**Penilaian soal test gagal di run bersama.** Gate 2 berbunyi "semua unit/integration/E2E lulus" dan dinilai per run, bukan per file test milestone. `npm run test` berakhir dengan exit 1, karena test AC-2.2 `src/lib/format.test.ts > 2 hari → '2 hari yang lalu'` gagal (243/244 lulus). Karena itu gate Unit & integration saya nilai **FAIL untuk M1, M2, dan M3**. Gate ini baru PASS bila `npm run test` exit 0 dan mencetak coverage tanpa flag tambahan.

**Prinsip yang sama untuk temuan di infrastruktur test.** CR-1-1 menyangkut konfigurasi Playwright/Vitest yang dipakai ketiga milestone. Temuan ini major, jadi saya hitung sebagai temuan terbuka di M1, M2, dan M3. Sebaliknya, bug produk yang khusus milik satu milestone hanya dihitung di milestone itu. Pengecualiannya adalah efeknya ke run bersama, seperti kasus AC-2.2 di atas.

**Konfigurasi terhadap DEC-004.**
- `dashboard/vitest.config.mts` **sesuai** DEC-004:
  - provider v8, ambang `lines: 80, branches: 80`;
  - include: `src/lib/**`, `src/app/api/**`, `src/app/boot/**`, `src/hooks/**`, `src/components/**/*.ts`;
  - exclude `src/components/ui/**`, `*.d.ts`, dan file test, masing-masing dengan komentar alasan.
  - Ambang tidak diturunkan dan exclude tidak diperluas.
- Route handler `src/app/api/**` memang masuk laporan coverage (9 file, semuanya 100%, terlihat di `coverage-summary.json`).
- `dashboard/playwright.config.ts` memakai Chromium bundel, `retries: 0`, `workers: 1`, dan build produksi dengan `PXE_MOCK_SIMULATION=off`. Masalahnya, `forbidOnly: !!process.env.CI` dan `reuseExistingServer: !process.env.CI`, sedangkan `allowOnly` Vitest tidak di-set. Proteksi ini mati saat gate dijalankan lokal. Ini temuan CR-1-1 (major).

**Coverage.** Lines 99.64%, branches 97.90%, statements 99.58% (`coverage-summary.txt`). Angka ini diambil dari run yang sama memakai flag CLI `--coverage.reportOnFailure`; konfigurasi, ambang, dan include tidak diubah. Saya terima sebagai data, dan ambang ≥ 80% terpenuhi. Tetapi gate Unit & integration tetap FAIL karena exit 1.

**Pencarian test yang di-skip atau dilemahkan.**
- Saya grep `.skip|.only|.todo|.fixme|xit(|xdescribe(|fit(|test.fail|skipIf|runIf|expect.soft` di `dashboard/src` dan `dashboard/e2e`: **0 hit**. Satu-satunya kecocokan adalah field `skipUsed`, yang bukan test.
- Test AC-2.2 yang gagal **tidak** dilemahkan. Asersinya benar: membandingkan dengan ICU `numeric:"always"` dan string literal dari AC. Bug-nya di produk: `dashboard/src/lib/format.ts:1` memakai `numeric: "auto"`, sehingga −2 hari menjadi "kemarin dulu".
- Ada beberapa asersi yang dari awal ditulis longgar: CR-1-4, CR-2-7, CR-2-8, CR-3-10, CR-3-11. Tidak ada bukti test-test ini sebelumnya lebih ketat lalu diubah, jadi saya tidak menilainya sebagai "pelemahan" (critical). Statusnya tetap minor, dan sebagian besar sebaiknya ikut diperbaiki.

**Secret/plaintext.**
- Log dan screenshot di `.agent/runs/**` bersih. `Fixture-Pass-7319` hanya muncul sebagai nilai dummy fixture, dan dialog password di screenshot di-mask.
- Tidak ada private key sungguhan. `FAKE_PRIVATE_KEY` di fixture sah.
- Namun `dashboard/src/lib/server/mock-hosts.ts:256` berisi komentar `// Hash SHA-512 crypt "ubuntu" …`. Komentar ini menyebut password plaintext dari `LAB_PASSWORD_HASH`, dan hash itu dipakai sebagai credentials default host seed. Gate CLAUDE.md berbunyi "tidak ada … password plaintext di repo", jadi gate Secret **FAIL untuk M2 dan M3** (store mock adalah lingkup M2 dan dipakai M3).
- Pola yang sama ada di `configs/autoinstall/user-data:21`. File itu konfigurasi lab dari sebelum workflow ini, di luar dashboard dan di luar deliverable M1–M3 (DEC-002), sehingga tidak saya hitung di M1–M3. File itu **wajib** dibereskan sebelum gate M4, karena generator installer M4 akan menyentuh area ini.

---

## Milestone 1 — CHANGES_REQUESTED

| Gate | Status | Bukti |
|---|---|---|
| Typecheck | PASS (exit 0) | .agent/runs/m1/typecheck.log |
| Lint | PASS (exit 0) | .agent/runs/m1/lint.log |
| Unit & integration | **FAIL**: 243/244 lulus, exit 1 (AC-2.2 gagal di run bersama). Coverage lines 99.64% / branches 97.90% (≥ 80%, OK) | .agent/runs/m1/unit.log, .agent/runs/m1/coverage-summary.txt, coverage-summary.json |
| E2E Playwright | PASS: 42/42, exit 0 | .agent/runs/m1/e2e.log |
| AC coverage | PASS: AC-1.1 s/d AC-1.12 (12 AC sesuai M1-plan) masing-masing punya test nyata yang lulus. AC-1.12 dibuktikan oleh typecheck, lint, dan build produksi di e2e.log | .agent/runs/m1/ac-matrix.md, docs/design/M1-plan.md |
| Code review | **FAIL**: 0 critical, 1 major terbuka (CR-1-1) | .agent/runs/m1/review-code-iter1.md |
| Security review | PASS: 0 critical, 0 major (1 minor) | .agent/runs/m1/review-security-iter1.md |
| Design review | PASS: 0 critical, 0 major (1 minor) | .agent/runs/m1/review-design-iter1.md, .agent/runs/m1/design/ |
| Secret/plaintext | PASS: tidak ada di kode M1, log, maupun screenshot. Catatan untuk M4 soal `configs/autoinstall/user-data:21` ada di bagian lintas milestone | review-security-iter1.md (I-1-1, I-1-2, I-1-4) |
| Test skip/.only/dilemahkan | PASS: 0 hit | grep dashboard/src, dashboard/e2e |

**Wajib diperbaiki:**
1. **T-1 / CR-2-1 (dari run bersama).** `dashboard/src/lib/format.ts:1`: ganti `numeric: "auto"` menjadi `numeric: "always"` supaya test AC-2.2 lulus. Test-nya tidak boleh diubah. Tambahkan kasus 1 hari ("1 hari yang lalu"). Hasil akhirnya: `npm run test` exit 0 dan mencetak coverage tanpa `--coverage.reportOnFailure`.
2. **CR-1-1 (major).**
   - `playwright.config.ts`: `forbidOnly: true`, dan `reuseExistingServer: false` untuk server :3100.
   - `vitest.config.mts`: tambahkan `allowOnly: false`.
   - Perubahan ini menguatkan test dan tidak menyentuh ambang, include, atau exclude DEC-004, jadi tidak perlu decision baru.

**Minor yang boleh diterima:**
- CR-1-6: sisa dukungan dark mode tidak aktif karena tidak ada token `.dark`; sesuai plan G1-6. Hapus `next-themes` bila memang tidak dipakai.
- CR-1-7: IP dan status server di top bar di-hard-code; sudah dinyatakan di luar scope (G1-4), dikerjakan di M4.

**Minor yang sebaiknya ikut diperbaiki:**
- CR-1-2: `<main>` bersarang (a11y). Perbaikannya murah, sekalian perbarui selector `main > main` di `e2e/m1-layout.spec.ts`.
- CR-1-3: ganti `waitForTimeout(600)` dengan menunggu animasi selesai, supaya test tidak flaky.
- CR-1-4: persempit pengecualian "div oranye" hanya ke swatch token.
- CR-1-5: guard AC-1.6 belum menangkap `--chart-*` yang memakai pastel.
- CR-1-8: test AC-1.1 hanya mem-parse blok `:root` pertama.
- SR-1-1: pindahkan `shadcn` ke `devDependencies`. Ini wajib paling lambat M4.
- DR-1-1: teks `/design` terpotong di lebar 375px; perbaiki dengan `min-w-0`.

---

## Milestone 2 — CHANGES_REQUESTED

| Gate | Status | Bukti |
|---|---|---|
| Typecheck | PASS (exit 0) | .agent/runs/m2/typecheck.log |
| Lint | PASS (exit 0) | .agent/runs/m2/lint.log |
| Unit & integration | **FAIL**: 243/244 lulus, exit 1 (AC-2.2). Coverage lines 99.64% / branches 97.90% (OK) | .agent/runs/m2/unit.log, .agent/runs/m2/coverage-summary.txt |
| E2E Playwright | PASS: 42/42, exit 0 | .agent/runs/m2/e2e.log |
| AC coverage | **FAIL**: 13/14 AC punya test yang lulus. AC-2.2 punya test, tetapi test itu **gagal** dan AC tidak terpenuhi | .agent/runs/m2/ac-matrix.md, dashboard/src/lib/format.test.ts:30-34 |
| Code review | **FAIL**: 0 critical, 1 major terbuka (CR-2-1), ditambah CR-1-1 (major, infrastruktur bersama) | .agent/runs/m2/review-code-iter1.md, .agent/runs/m1/review-code-iter1.md |
| Security review | PASS: 0 critical, 0 major (2 minor) | .agent/runs/m2/review-security-iter1.md |
| Design review | PASS: 0 critical, 0 major (2 minor) | .agent/runs/m2/review-design-iter1.md, .agent/runs/m2/design/ |
| Secret/plaintext | **FAIL**: `dashboard/src/lib/server/mock-hosts.ts:256` menyebut password plaintext lab ("ubuntu") untuk hash credentials default seed. Log dan screenshot bersih | mock-hosts.ts:256, review-security-iter1.md (SR-2-1, I-2-7) |
| Test skip/.only/dilemahkan | PASS: 0 hit | grep dashboard/src, dashboard/e2e |

**Wajib diperbaiki:**
1. **CR-2-1 (major, AC-2.2 gagal).** Perbaikan sama dengan T-1: `format.ts` diubah ke `numeric: "always"`, tambah test 1 hari, test tidak boleh dilonggarkan.
2. **CR-1-1 (major, infrastruktur bersama).** Sama dengan butir M1. Ini juga prasyarat agar CR-2-9 (ketergantungan urutan pada store mutable) tidak memakai server yang di-reuse.
3. **G-SEC-2 (gate Secret).** Hapus penyebutan password plaintext dari komentar `mock-hosts.ts:256`. Ganti hash lab dengan hash fixture dummy yang tidak didokumentasikan sebagai password, atau batasi ke seed demo berlabel jelas. Ini juga menutup sebagian CR-3-12.

**Minor yang boleh diterima:**
- CR-2-6: subnet `10.10.10.0/24` di empty state di-hard-code; dicatat G2-4, dikerjakan di M4.
- CR-2-10: logika filter berada di `.tsx`. DEC-004 mengizinkannya dan fungsinya tetap diuji unit. Saran: pindahkan ke `.ts`.
- SR-2-1 (bagian desain seed credentials) dan SR-2-2 (CSRF pada reboot): masih mock dan auth adalah scope M6. Keduanya **wajib selesai paling lambat M4**, saat endpoint menjadi nyata.

**Minor yang sebaiknya ikut diperbaiki:**
- CR-2-2: `now` basi sampai 15 detik.
- CR-2-3: host tanpa hostname muncul paling atas saat sort.
- CR-2-4: MAC format Cisco tidak cocok di pencarian.
- CR-2-5: tambahkan `no-store` di semua GET.
- CR-2-7: toleransi 6.5 detik melebihi "≤ 6 dtk" di AC-2.9. Rujukan baris di laporan reviewer keliru; baris sebenarnya `dashboard/e2e/m2-polling.spec.ts:24,34`. Samakan dengan teks AC atau perjelas AC lewat plan.
- CR-2-8: test AC-2.10 hanya mengecek hitungan 4 dari 7 status, dengan `toContainText` yang longgar. Prioritas, karena AC meminta "hitungan per status".
- CR-2-9: ketergantungan urutan antar file E2E.
- DR-2-1, DR-2-2: tombol dan kontrol berukuran 32px, di bawah batas 36px.

---

## Milestone 3 — CHANGES_REQUESTED

| Gate | Status | Bukti |
|---|---|---|
| Typecheck | PASS (exit 0) | .agent/runs/m3/typecheck.log |
| Lint | PASS (exit 0) | .agent/runs/m3/lint.log |
| Unit & integration | **FAIL**: 243/244 lulus, exit 1 (AC-2.2, run bersama). Coverage lines 99.64% / branches 97.90% (OK) | .agent/runs/m3/unit.log, .agent/runs/m3/coverage-summary.txt |
| E2E Playwright | PASS: 42/42, exit 0 | .agent/runs/m3/e2e.log |
| AC coverage | **FAIL**: AC-3.1 s/d AC-3.15 punya test dan lulus, tetapi AC-3.9 ("respons tidak memuat password") dilanggar pada kasus tepi SR-3-4 (MAC invalid di-echo mentah, sehingga password terpantul) dan tidak ada test untuk kasus itu | .agent/runs/m3/ac-matrix.md, review-security-iter1.md SR-3-4, config-service.ts:96-114 |
| Code review | **FAIL**: 0 critical, 2 major terbuka (CR-3-1, CR-3-2), ditambah CR-1-1 (infrastruktur bersama) | .agent/runs/m3/review-code-iter1.md |
| Security review | **FAIL**: 0 critical, 1 major terbuka (SR-3-1) | .agent/runs/m3/review-security-iter1.md |
| Design review | **FAIL**: 0 critical, 1 major terbuka (DR-3-1) | .agent/runs/m3/review-design-iter1.md, .agent/runs/m3/design/sheet-single-ssh-keys.png |
| Secret/plaintext | **FAIL**: `mock-hosts.ts:256` (sama dengan M2; dipakai alur install M3, lihat CR-3-12). Log bersih; screenshot hanya berisi fixture dummy | mock-hosts.ts:256, review-security-iter1.md I-3-6 |
| Test skip/.only/dilemahkan | PASS: 0 hit | grep dashboard/src, dashboard/e2e |

**Wajib diperbaiki:**
1. **T-1 / CR-2-1.** Test run bersama harus hijau (lihat M2).
2. **CR-1-1 (major, infrastruktur bersama).**
3. **CR-3-1 (major).** `dashboard/src/lib/net.ts:171-207` (`planIps`): IP awal di luar subnet membuat loop linear dan membekukan tab browser. Saya verifikasi di kode: `cur = ipToInt(spec.start)` tanpa clamp ke subnet. Tolak atau clamp ke subnet, batasi iterasi, dan tambahkan unit test untuk IP awal di luar subnet.
4. **CR-3-2 (major).** Form memakai `MGMT_NETWORK` yang di-hard-code (`form-state.ts:18,149-151`), sedangkan server memakai env `PXE_MGMT_*`. Akibatnya UI dan API tidak konsisten, melanggar DEC-006. Ekspos subnet aktif ke klien, atau buat decision yang menunda perbaikan ke M4 sekaligus menonaktifkan override env.
5. **SR-3-1 (major, mencakup CR-3-7).** Alfabet `credentials.ts:26-27` memuat `-+=@`, dan `toCsv` (`credentials.ts:83-91`) tidak menetralkan sel berawalan karakter itu. Akibatnya terjadi formula injection pada CSV password sekali-tampil. Pastikan karakter pertama password alfanumerik dan/atau `toCsv` menetralkan sel formula. Tambahkan unit test (10.000 password tanpa awalan `[=+\-@]`, dan `toCsv` menetralkan sel formula).
6. **DR-3-1 (major).** Badge tipe SSH key di `tab-ssh.tsx:136,217` masih memakai font sans. Tambahkan `type-data`/`font-mono`.
7. **SR-3-4, dinaikkan ke wajib karena melanggar teks AC-3.9.** `config-service.ts:96-114` jangan meng-echo MAC invalid mentah, karena bisa memantulkan password. Tambahkan test baris CSV 1-kolom berisi password dan assert respons tidak memuat password itu.
8. **G-SEC-2.** Komentar plaintext di `mock-hosts.ts:256`, sama dengan M2.

**Minor yang boleh diterima (dengan alasan):**
- CR-3-4: `getConfig` membuat konfigurasi lazy. Tidak berdampak di store mock; dipisah menjadi `peekConfig` di M4 (DB).
- CR-3-8: UI lebih ketat daripada API. Ini aman (tidak meloloskan input invalid), cukup sebagai perbaikan UX.
- CR-3-12 (sisa di luar komentar plaintext): seed credentials dan public key admin. Hanya mock; wajib tidak terbawa ke persistence M4.
- SR-3-2 (CSRF/Content-Type) dan SR-3-3 (batas ukuran body): auth adalah scope M6 dan endpoint masih mock. **Wajib selesai paling lambat M4**, sebelum endpoint install menjadi nyata.

**Minor yang sebaiknya ikut diperbaiki:**
- CR-3-3: hitungan `updated` dan `updatedAt` berlebih di mode CSV.
- CR-3-5: private key yang gagal di-parse tetap dikirim dan disimpan di cache query. Ini sisi keamanan, prioritas.
- CR-3-6: dialog password bisa tertutup lewat Escape/overlay tanpa unduh, padahal itu satu-satunya kesempatan melihat password. Prioritas.
- CR-3-9: IP host belum dicek terhadap gateway dari payload.
- CR-3-10: asersi urutan di-`sort()` sehingga urutan tidak teruji.
- CR-3-11: `waitForTimeout(300)` untuk asersi "tanpa request".
- CR-3-13: form tetap dirender dengan nilai default saat load config gagal.
- DR-3-2: Sheet radius 0. Perbaiki, atau catat pengecualiannya di SPEC/decision.
- DR-3-3: tombol 24px di Sheet.

---

**Catatan untuk iterasi berikut (berlaku untuk ketiga milestone):** jalankan ulang typecheck, lint, test (tanpa `--coverage.reportOnFailure`), dan test:e2e setelah CR-1-1 diterapkan, lalu simpan log baru ke m1/, m2/, dan m3/. Reviewer juga perlu memperbarui laporan menjadi iter2, yang menyatakan status CR-1-1, CR-2-1, CR-3-1, CR-3-2, SR-3-1, SR-3-4, DR-3-1, dan G-SEC-2 sebagai closed beserta buktinya.