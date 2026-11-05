# Review kode M2 — iterasi 3

Diff yang direview: `git diff ed30b1e..76cd8ac` (541fb8d produk, 76cd8ac test + bukti), branch milestone/1-3-baseline. Hanya baca; tidak ada build/e2e yang dijalankan ulang. Rujukan: gate-iter2.md, review-*-iter2.md.

## Pemeriksaan bersama (M1–M3)

- **vitest.config.mts**: tidak berubah sejak fe6a353 (`git diff 8709a96..76cd8ac` kosong). Ambang `lines/branches 80`, include/exclude DEC-004 utuh, `allowOnly: false`.
- **playwright.config.ts**: `forbidOnly: true`, `retries: 0`, `workers: 1`; `reuseExistingServer: false` di ketiga definisi webServer (:113, :126, :136; per-file mencakup project baru `iter3-ui` :3107). Satu-satunya perubahan lain = guard CR-1-9 (`assertEverySpecCollected`) dan ekstraksi pola `SHARED_MATCH`/`POLLING_MATCH` tanpa mengubah polanya.
- **Skip/only**: grep `.skip|.only|.todo|.fixme|xit(|xdescribe(|fit(|test.fail|skipIf|runIf|expect.soft|waitForTimeout` di `dashboard/src` + `dashboard/e2e` → 0 hit. Tidak ada asersi yang dihapus; `m3-bulk.spec.ts` hanya menambah `waitForAnimations` sebelum screenshot; `helpers.ts` `dropShadowViolations` menambah parameter `scope` (default tetap `body *`, pemanggil lama tidak berubah).
- **Log iter3**: identik byte-per-byte di m1/m2/m3 (`cmp`). Typecheck exit 0, lint exit 0, unit 365/365 (21 file) exit 0, coverage lines 99.79% / branches 98% / statements 99.72% / functions 99.05%, E2E 64/64 exit 0 (11 file spec di `e2e/`, semua terkumpul).

## Status temuan sebelumnya

| ID | Severity | Status | Bukti |
|---|---|---|---|
| CR-2-2 | minor | **closed** | `src/hooks/use-now.ts:18-49`: `subscribe` menyetel `now = Date.now()` (useSyncExternalStore membaca ulang snapshot setelah subscribe → nilai segar saat kembali ke /hosts); listener `visibilitychange` → `refresh()` hanya saat `visible`, dipasang bersama timer dan dilepas saat subscriber terakhir pergi. Unit `src/hooks/hooks.test.ts:235-280` (subscribe ulang setelah 40 dtk, hidden diabaikan, visible menyegarkan, removeEventListener saat unmount). |
| DR-1-2 (alur M2) | major (design) | diperbaiki di kode | Toast hapus & reboot diuji `e2e/iter3-ui.spec.ts:116-135`. Lihat review M1. |
| CR-2-10 | minor | open (diterima gatekeeper) | Tidak disentuh. |

## Temuan baru

| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-2-11 | minor | dashboard/src/hooks/use-now.ts:31 | `now` diperbarui pada **setiap** subscribe tanpa `notify()`. `useNow` dipanggil per baris (`last-seen.tsx:12`), jadi baris yang baru ter-mount (host baru dari polling, ganti halaman/filter) membaca `now` baru sementara baris lama tetap pada render terakhir sampai tick/re-render berikutnya. Teks "x lalu" antarbaris bisa tidak konsisten ≤ 15 dtk; tidak salah fungsional. | Segarkan hanya bila `listeners.size === 0` sebelum `add` (kasus CR-2-2), atau panggil `notify()` setelah memperbarui. |

Catatan: komentar "segarkan saat subscribe" benar untuk komponen yang baru subscribe; perilaku React (re-check snapshot setelah subscribe) mendukungnya. `syncServerClock` tidak berubah.

## Ringkasan

| Severity | Terbuka |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 2 (CR-2-10 diterima, CR-2-11 baru) |
