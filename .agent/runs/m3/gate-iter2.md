<!-- Disimpan Orchestrator dari keputusan agent gatekeeper (verbatim). -->
## Keputusan gatekeeper, iterasi 2 (branch milestone/1-3-baseline @ ed30b1e)

Hasil: **M1 CHANGES_REQUESTED · M2 CHANGES_REQUESTED · M3 CHANGES_REQUESTED.**

Tidak ada yang BLOCKED. Ini iterasi ke-2, satu-satunya FAIL bisa diperbaiki dev, dan M1–M3 tidak butuh bukti KVM.

Iterasi 3 adalah iterasi terakhir. Bila masih ada FAIL di sana, keputusannya **BLOCKED**.

Semua FAIL iterasi 1 sudah tertutup dengan bukti, yaitu T-1/CR-2-1, CR-1-1, CR-3-1, CR-3-2, SR-3-1, SR-3-4, DR-3-1, dan G-SEC-2. Yang tersisa hanya satu temuan **major baru dari design reviewer, DR-1-2**: toast Sonner global punya drop shadow. Temuan ini ada di komponen M1 dan muncul di alur M2 dan M3. Sesuai prinsip iterasi 1, temuan infrastruktur bersama dihitung di setiap milestone yang terdampak.

### Pemeriksaan lintas milestone (berlaku untuk M1, M2, M3)

**Log bersama.**
- `typecheck-iter2.log`, `lint-iter2.log`, `unit-iter2.log`, `unit-iter2-verbose.log`, `coverage-summary-iter2.txt/.json`, dan `e2e-iter2.log` di m1/, m2/, m3/ identik byte-per-byte (dicek dengan `cmp`).
- Commit ed30b1e (setelah fe6a353) hanya mengubah file test dan bukti. Jadi log mencerminkan kode produk di HEAD.
- Working tree `dashboard/` bersih. Yang belum di-commit hanya `.agent/runs/**` (laporan review iter2, `design/iter2/`, `audit.mjs`).

**Hasil run.**
- Typecheck exit 0, lint exit 0.
- `npm run test` = `vitest run --coverage` tanpa flag tambahan: **359/359 lulus, exit 0**.
- E2E `npm run test:e2e`: **58/58 lulus, exit 0**.

**Coverage (DEC-004).**
- Lines 99.78%, branches 98.22%, statements 99.72%, functions 99.04%, semuanya di atas 80%.
- `coverage-summary-iter2.json` memuat 31 file, termasuk 10 route handler `src/app/api/**`.

**`dashboard/vitest.config.mts`.**
- Satu-satunya perubahan adalah `allowOnly: false` (baris 12).
- Provider v8, ambang `lines: 80, branches: 80`, include, dan exclude tidak berubah. Sesuai DEC-004.

**`dashboard/playwright.config.ts`.**
- `forbidOnly: true`, `retries: 0`, `workers: 1`.
- `reuseExistingServer: false` di semua 7 webServer.
- Satu build produksi; `PXE_MOCK_SIMULATION=off` kecuali :3101 (AC-2.9, memang `on`).
- Ada 9 file spec di `e2e/` dan 9 file yang terkumpul (58 test). Tidak ada file yatim saat ini (risiko laten: CR-1-9).

**Pencarian skip/only/fixme/waitForTimeout.**
- Grep `.skip|.only|.todo|.fixme|xit(|xdescribe(|fit(|test.fail|skipIf|runIf|expect.soft|waitForTimeout` di `dashboard/src` dan `dashboard/e2e`: **0 hit**.
- Saya memeriksa baris test yang dihapus (`git diff 8f4b2d7..ed30b1e`). Semuanya diganti asersi yang lebih ketat:
  - `waitForTimeout` diganti `waitForAnimations`/`waitForRequest`-timeout;
  - batas 6.5 dtk diperketat menjadi 6 dtk;
  - `sort()` di sisi asersi dihapus;
  - `toContainText` diganti regex persis untuk 7 status;
  - selector `main > main` diganti `[data-slot=page-content]` karena perubahan DOM CR-1-2.
- Test AC-2.2 asli tidak diubah. **Tidak ada pelemahan test.**

**Secret/plaintext.**
- `mock-hosts.ts:256-261` kini berisi `DEMO_SEED_PASSWORD_HASH` dengan salt acak, tanpa penyebutan plaintext. Ada test penjaganya (`mock-hosts.test.ts` "iter2 G-SEC-2").
- `$6$pxelab$` di `dashboard/` hanya muncul sebagai konstanta pembanding di test.
- Log dan screenshot iter2 bersih; kolom password di-mask.
- Public key `wals@wal` bukan secret.
- `configs/autoinstall/user-data:21-22` tetap di luar M1–M3 dan **wajib dibereskan sebelum gate M4** (catatan iterasi 1 tetap berlaku).

**DR-1-2 (major, terbuka).** Saya verifikasi di kode dan data audit:
- `dashboard/src/components/ui/sonner.tsx` tidak meng-override shadow bawaan Sonner.
- `toastOptions.classNames.toast` hanya berisi `cn-toast`.
- `m1/design/iter2/audit-results-all.json`, state 19 dan 20: `li.cn-toast` punya kind `drop` dengan `boxShadow: rgba(0,0,0,0.1) 0px 4px 12px 0px`.
- Ini melanggar SPEC §1 ("tanpa drop shadow", baris 13 dan 48).
- Test AC-1.3 lulus karena teks AC hanya mencakup /hosts, /design, dropdown, dan Sheet, dan tidak memicu toast. Jadi ini celah cakupan test, bukan pelemahan.
- Toaster dipasang di root layout (`app/layout.tsx:19`, komponen design system M1). Toast dipakai di alur AC-2.12 (M2: hapus/reboot) dan AC-3.12 (M3: simpan konfigurasi).
- Karena itu temuan ini dihitung terbuka di **M1, M2, dan M3**. Gate tidak saya turunkan.

---

## Milestone 1 — CHANGES_REQUESTED

| Gate | Status | Bukti |
|---|---|---|
| Typecheck | PASS (exit 0) | .agent/runs/m1/typecheck-iter2.log |
| Lint | PASS (exit 0) | .agent/runs/m1/lint-iter2.log |
| Unit & integration | PASS: 359/359, exit 0, tanpa flag tambahan | .agent/runs/m1/unit-iter2.log, unit-iter2-verbose.log |
| Coverage ≥ 80% (DEC-004) | PASS: lines 99.78%, branches 98.22%; config tidak dilemahkan | .agent/runs/m1/coverage-summary-iter2.txt/.json, dashboard/vitest.config.mts |
| E2E Playwright | PASS: 58/58, exit 0 | .agent/runs/m1/e2e-iter2.log, dashboard/playwright.config.ts |
| AC coverage | PASS: AC-1.1 s/d AC-1.12 masing-masing punya test nyata yang lulus | .agent/runs/m1/ac-matrix-iter2.md, docs/design/M1-plan.md |
| Code review | PASS: 0 critical, 0 major (CR-1-1 closed); minor CR-1-6, CR-1-7 partial, CR-1-9 baru | .agent/runs/m1/review-code-iter2.md |
| Security review | PASS: 0/0/0 (SR-1-1 closed) | .agent/runs/m1/review-security-iter2.md |
| Design review | **FAIL**: 1 major terbuka, DR-1-2 (drop shadow toast Sonner) | .agent/runs/m1/review-design-iter2.md, .agent/runs/m1/design/iter2/audit-results-all.json (states 19–20), .agent/runs/m3/design/iter2/passwords-dialog.png |
| Secret/plaintext | PASS | review-security-iter2.md (I-1-8, I-1-9), git grep |
| Test skip/.only/dilemahkan | PASS: 0 hit; diff test diperiksa, tidak ada pelemahan | grep dashboard/src, dashboard/e2e; git diff 8f4b2d7..ed30b1e |

**Wajib diperbaiki (iterasi 3, terakhir):**
1. **DR-1-2 (major).** Perbaikan di `dashboard/src/components/ui/sonner.tsx`:
   - hilangkan drop shadow toast, misalnya `toastOptions.classNames.toast: "cn-toast shadow-none! border border-border"` atau `style: { boxShadow: "none" }`;
   - pertahankan hairline 1px;
   - radius sebaiknya 12px seperti panel mengambang lain (I-1-5).
2. **Bukti penutupan DR-1-2 wajib berupa test, bukan hanya screenshot.**
   - Tambahkan E2E yang memicu toast, lalu jalankan `dropShadowViolations` (helper AC-1.3) pada `[data-sonner-toast]`. Asersinya: setiap lapisan shadow punya offset 0 dan blur 0.
   - Test ini boleh diletakkan di spec M1 atau `iter2-ui`/iter3. Yang penting harus terkumpul oleh `testMatch` (lihat CR-1-9).

**Minor yang boleh diterima:**
- **CR-1-6 (partial).** Varian `dark:` vendor shadcn di `ui/*` dan `@custom-variant dark` tidak aktif, karena tidak ada token `.dark` dan `next-themes` sudah dihapus. Ini sesuai plan G1-6, dan tidak ada dampak visual atau fungsional.
- **CR-1-7 (partial).** IP sidebar sudah dari `/api/network`. Status DHCP/TFTP/HTTP masih hard-code, dan memang di luar scope (G1-4), dikerjakan di M4.
- **CR-1-9 (minor baru).** Belum ada guard terhadap file spec yang tidak cocok dengan `testMatch` project mana pun. Saat ini 9/9 file terkumpul, jadi belum ada test yang hilang. **Wajib paling lambat sebelum file E2E M4 ditambahkan.** Disarankan sekalian di iterasi 3, karena test DR-1-2 menambah file atau spec.

---

## Milestone 2 — CHANGES_REQUESTED

| Gate | Status | Bukti |
|---|---|---|
| Typecheck | PASS (exit 0) | .agent/runs/m2/typecheck-iter2.log |
| Lint | PASS (exit 0) | .agent/runs/m2/lint-iter2.log |
| Unit & integration | PASS: 359/359, exit 0; AC-2.2 lulus dengan test asli yang tidak diubah | .agent/runs/m2/unit-iter2.log, dashboard/src/lib/format.test.ts |
| Coverage ≥ 80% (DEC-004) | PASS: lines 99.78%, branches 98.22% | .agent/runs/m2/coverage-summary-iter2.txt/.json |
| E2E Playwright | PASS: 58/58, exit 0 | .agent/runs/m2/e2e-iter2.log |
| AC coverage | PASS: AC-2.1 s/d AC-2.14 semua punya test yang lulus (AC-2.2 kini terpenuhi) | .agent/runs/m2/ac-matrix-iter2.md, docs/design/M2-plan.md |
| Code review | PASS: 0 critical, 0 major (CR-2-1 closed, CR-1-1 bersama closed); minor CR-2-2, CR-2-10 | .agent/runs/m2/review-code-iter2.md |
| Security review | PASS: 0/0/0 (G-SEC-2, SR-2-1 untuk M2, dan SR-2-2 closed) | .agent/runs/m2/review-security-iter2.md |
| Design review | **FAIL**: 0 major milik M2, tetapi DR-1-2 (major, lintas milestone) terbuka dan muncul di alur AC-2.12 (toast hapus/reboot, `hosts-view.tsx`) | .agent/runs/m2/review-design-iter2.md, .agent/runs/m1/review-design-iter2.md |
| Secret/plaintext | PASS: G-SEC-2 closed (`mock-hosts.ts:256-261`, test "iter2 G-SEC-2") | .agent/runs/m2/review-security-iter2.md, dashboard/src/lib/server/mock-hosts.test.ts |
| Test skip/.only/dilemahkan | PASS: 0 hit; CR-2-7 dan CR-2-8 justru diperketat | grep; git diff |

**Wajib diperbaiki (iterasi 3, terakhir):**
1. **DR-1-2 (major, lintas milestone).** Sama dengan butir M1. Test toast tanpa drop shadow sebaiknya memicu toast dari alur M2 (hapus atau reboot host).

**Minor yang boleh diterima:**
- **CR-2-10.** Logika filter masih di `columns.tsx`. DEC-004 mengizinkannya, dan fungsinya tetap diuji unit.
- **SR-2-1 (sisa desain seed).** Seed `ubuntu`/`sudo` dan `installHosts` menganggap seed ber-credentials. Ini masih mock dan hash-nya bukan password publik. **Wajib di M4:** persistence tidak mewarisi seed hash, dan host tanpa credentials eksplisit ditolak saat install.
- **SR-3-5 (DNS rebinding, minor).** Juga mengenai reboot/DELETE M2. Dihitung di M3, **wajib ≤ M4**.

**Minor yang sebaiknya ikut diperbaiki:**
- **CR-2-2.** `now` bisa basi sampai 15 dtk setelah kembali ke /hosts (`src/hooks/use-now.ts`). Belum disentuh di iterasi 2. Murah, sebaiknya ikut di iterasi 3.

---

## Milestone 3 — CHANGES_REQUESTED

| Gate | Status | Bukti |
|---|---|---|
| Typecheck | PASS (exit 0) | .agent/runs/m3/typecheck-iter2.log |
| Lint | PASS (exit 0) | .agent/runs/m3/lint-iter2.log |
| Unit & integration | PASS: 359/359, exit 0 | .agent/runs/m3/unit-iter2.log |
| Coverage ≥ 80% (DEC-004) | PASS: lines 99.78%, branches 98.22% | .agent/runs/m3/coverage-summary-iter2.txt/.json |
| E2E Playwright | PASS: 58/58, exit 0, termasuk server env KVM :3106 | .agent/runs/m3/e2e-iter2.log |
| AC coverage | PASS: AC-3.1 s/d AC-3.15 punya test yang lulus. AC-3.9 kini terpenuhi: SR-3-4 closed dengan test baris 1-kolom/kolom tertukar (`iter2-routes.test.ts:341-381`) | .agent/runs/m3/ac-matrix-iter2.md, docs/design/M3-plan.md |
| Code review | PASS: 0 critical, 0 major (CR-3-1, CR-3-2, CR-1-1 closed); 7 minor | .agent/runs/m3/review-code-iter2.md |
| Security review | PASS: 0 critical, 0 major (SR-3-1 closed; SR-3-2/3-3/3-4 closed); 1 minor SR-3-5 | .agent/runs/m3/review-security-iter2.md |
| Design review | **FAIL**: DR-3-1 closed, 0 major milik M3, tetapi DR-1-2 (major, lintas milestone) terbuka dan muncul di alur simpan konfigurasi AC-3.12 (`config-sheet.tsx`, `tab-ssh.tsx`, `tab-credentials.tsx`) | .agent/runs/m3/review-design-iter2.md, .agent/runs/m3/design/iter2/passwords-dialog.png, .agent/runs/m1/design/iter2/audit-results-all.json |
| Secret/plaintext | PASS: hash seed demo tanpa plaintext; log bersih; password di screenshot di-mask | .agent/runs/m3/review-security-iter2.md (I-3-13) |
| Test skip/.only/dilemahkan | PASS: 0 hit; CR-3-10 dan CR-3-11 diperketat | grep; git diff |

**Wajib diperbaiki (iterasi 3, terakhir):**
1. **DR-1-2 (major, lintas milestone).** Sama dengan butir M1. Test toast boleh memakai toast "Konfigurasi … disimpan" dari alur M3.

**Minor yang boleh diterima (dengan alasan):**
- **CR-3-4.** `getConfig` membuat config lazy. Tidak berdampak di store mock; dipisah ke `peekConfig` di M4 (DB).
- **CR-3-8.** UI lebih ketat daripada API. Ini aman, karena tidak meloloskan input invalid.
- **CR-3-12 (partial).** Public key admin `wals@wal` di seed. Public key bukan secret; wajib tidak terbawa ke persistence M4.
- **CR-3-15.** Budget `planIps` untuk subnet env sangat besar. Hanya terpicu lewat konfigurasi operator, bukan input user. Perbaiki paling lambat M4, saat env jaringan nyata dipakai.
- **CR-3-16.** Sheet diblokir seluruhnya bila `/api/network` gagal. Ini perilaku konservatif yang aman, dan diuji E2E (CR-3-13).
- **SR-3-5 (DNS rebinding melewati `guardMutation`).** Endpoint masih mock dan auth adalah scope M6. **Wajib selesai paling lambat M4**, dengan allowlist Host dan test Origin = Host = host asing, sebelum endpoint install atau credentials menjadi nyata.
- **I-3-10, I-3-11** (sisa netralisasi CSV dan echo username): risiko rendah dan sudah dijelaskan reviewer.

**Minor yang sebaiknya ikut diperbaiki di iterasi 3:**
- **CR-3-14 / sisa CR-3-9.** Klien belum menolak IP host yang sama dengan gateway payload; `form-state.ts` `ipPlan` belum memasukkan `form.network.gateway` ke `usage`. Akibatnya UI lebih longgar daripada API. Perbaikannya murah dan perlu unit test.
- **DR-3-4 / sisa DR-3-3.** Tiga kontrol di Sheet berukuran < 36px: "Tambah" DNS 32px, "Hapus DNS" dan "Batalkan perubahan" 24px visual dengan area klik 32px. Pilihannya: naikkan "Tambah" ke `h-9`, lalu perluas hit area ke ≥ 36px atau catat pengecualian icon-in-badge di SPEC/decision.
- **I-3-13 (kualitas bukti).** `screenshots/ac-3.14-passwords-dialog.png` menangkap Sheet kosong. Ambil ulang supaya dialog terlihat (tetap di-mask).

---

**Catatan untuk iterasi 3 (berlaku untuk ketiga milestone):**
- Setelah DR-1-2 diperbaiki, jalankan ulang typecheck, lint, `npm run test` (tanpa flag tambahan), dan `npm run test:e2e`. Simpan sebagai `*-iter3.log` dan `coverage-summary-iter3.*` di m1/, m2/, dan m3/.
- Perbarui `ac-matrix-iter3.md`, dengan baris DR-1-2 yang merujuk test toast tanpa drop shadow.
- Design reviewer perlu mengulang audit yang memicu toast (`design/iter3/`) dan menyatakan DR-1-2 closed beserta angka `boxShadow` terukur.
- Code reviewer dan security reviewer cukup mengonfirmasi tidak ada regresi atau temuan baru pada diff iterasi 3.
- Commit laporan review iter2 dan `design/iter2/` yang belum di-commit, supaya jejak bukti lengkap.
- Jangan mengubah ambang, include, atau exclude DEC-004, dan jangan mengubah `forbidOnly`, `retries`, atau `reuseExistingServer`.
