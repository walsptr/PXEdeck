# Review kode M1 — iterasi 3

Diff yang direview: `git diff ed30b1e..76cd8ac` (541fb8d produk, 76cd8ac test + bukti), branch milestone/1-3-baseline. Hanya baca; tidak ada build/e2e yang dijalankan ulang. Rujukan: gate-iter2.md, review-*-iter2.md.

## Pemeriksaan bersama (M1–M3)

- **vitest.config.mts**: tidak berubah sejak fe6a353 (`git diff 8709a96..76cd8ac` kosong). Ambang `lines/branches 80`, include/exclude DEC-004 utuh, `allowOnly: false`.
- **playwright.config.ts**: `forbidOnly: true`, `retries: 0`, `workers: 1`; `reuseExistingServer: false` di ketiga definisi webServer (:113, :126, :136; per-file mencakup project baru `iter3-ui` :3107). Satu-satunya perubahan lain = guard CR-1-9 (`assertEverySpecCollected`) dan ekstraksi pola `SHARED_MATCH`/`POLLING_MATCH` tanpa mengubah polanya.
- **Skip/only**: grep `.skip|.only|.todo|.fixme|xit(|xdescribe(|fit(|test.fail|skipIf|runIf|expect.soft|waitForTimeout` di `dashboard/src` + `dashboard/e2e` → 0 hit. Tidak ada asersi yang dihapus; `m3-bulk.spec.ts` hanya menambah `waitForAnimations` sebelum screenshot; `helpers.ts` `dropShadowViolations` menambah parameter `scope` (default tetap `body *`, pemanggil lama tidak berubah).
- **Log iter3**: identik byte-per-byte di m1/m2/m3 (`cmp`). Typecheck exit 0, lint exit 0, unit 365/365 (21 file) exit 0, coverage lines 99.79% / branches 98% / statements 99.72% / functions 99.05%, E2E 64/64 exit 0 (11 file spec di `e2e/`, semua terkumpul).

## Status temuan sebelumnya

| ID | Severity | Status | Bukti |
|---|---|---|---|
| CR-1-9 | minor | **closed** | `dashboard/playwright.config.ts:48-71` `assertEverySpecCollected()` dipanggil saat config dimuat: setiap `e2e/*.spec.ts` harus cocok dengan **tepat satu** pola project (shared, polling, FILE_SERVERS), kalau tidak config melempar Error (suite gagal, tidak menyempit diam-diam). Pola diuji terhadap path absolut, sama seperti pencocokan Playwright. 11 spec → 64 test di `e2e-iter3.log`. |
| DR-1-2 (konteks kode) | major (design) | diperbaiki di kode, penutupan diputuskan design reviewer | `src/components/ui/sonner.tsx:41-46` `shadow-none! border! border-border! rounded-xl!` + ring fokus spread-only; `--border-radius: var(--radius-xl)`. Diuji `e2e/iter3-ui.spec.ts:116-155` (hapus/reboot M2, simpan M3; diam/hover/focus-visible; `dropShadowViolations` pada toast + seluruh halaman, offset/blur 0, border 1px token, radius 12px). Test kuat, bukan screenshot saja. |
| CR-1-6 | minor | partially (diterima gatekeeper) | Tidak disentuh. |
| CR-1-7 | minor | partially (diterima, M4) | Tidak disentuh. |

## Temuan baru

| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-1-10 | minor | dashboard/playwright.config.ts:59 | Guard CR-1-9 memakai `readdirSync(TEST_DIR)` non-rekursif, sedangkan Playwright mengumpulkan spec secara rekursif dari `testDir`. Spec di subfolder (mis. `e2e/m4/x.spec.ts`) yang tidak cocok pola apa pun lolos dari guard. Saat ini tidak ada subfolder. | `readdirSync(TEST_DIR, { recursive: true })` atau larang subfolder secara eksplisit; tidak memblokir. |

Tidak ada regresi pada sonner.tsx: `cn-toast` tetap ada, `theme="light"` tetap, props lain diteruskan.

## Ringkasan

| Severity | Terbuka |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 3 (CR-1-6 partial, CR-1-7 partial, CR-1-10 baru) |
