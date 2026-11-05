# Review kode M1 — iterasi 2 (code-reviewer)

- Branch `milestone/1-3-baseline` @ ed30b1e; dibandingkan dengan iter1 (`git diff 8f4b2d7..ed30b1e`).
- Dibaca: review-code-iter1.md, gate-iter1.md, ac-matrix-iter2.md, `*-iter2.log`, coverage-summary-iter2.*.
- Dijalankan ulang (read-only): `npm run typecheck` exit 0, `npm run lint` exit 0, `npm run test:unit`
  **359/359 lulus**, `npx playwright test --list` → **58 test di 9 file** (semua file spec masuk ke salah satu project).
  Build/E2E tidak dijalankan (port dipakai reviewer lain); dipakai `e2e-iter2.log` (58 passed, exit 0;
  `unit-iter2.log` = `vitest run --coverage` tanpa flag tambahan, exit 0; log m1/m2/m3 identik byte-per-byte).
- Pelemahan test: grep `.skip/.only/.todo/.fixme/test.fail/waitForTimeout/expect.soft/skipIf/runIf` di
  `dashboard/src` dan `dashboard/e2e` → 0 hit. Semua baris test yang dihapus di diff diganti asersi yang
  lebih ketat (lihat bagian "Perubahan test"). Jumlah test per file lama tidak berkurang
  (m1-layout 9→10, lainnya sama).
- `vitest.config.mts` vs DEC-004: satu-satunya perubahan `allowOnly: false` (baris 12). Provider v8,
  ambang `lines: 80, branches: 80`, include dan exclude **tidak berubah**.

## Status temuan iter1

| ID | Sev. iter1 | Status | Bukti |
|---|---|---|---|
| CR-1-1 | major | **closed** | `dashboard/playwright.config.ts:51` `forbidOnly: true`; `:84, :97, :107` `reuseExistingServer: false` untuk server :3100, :3101, dan semua server per file; `dashboard/vitest.config.mts:12` `allowOnly: false`. `e2e-iter2.log` menunjukkan build produksi dijalankan oleh webServer (bukan reuse). |
| CR-1-2 | minor | **closed** | `src/app/(dashboard)/layout.tsx:14-19` konten jadi `<div data-slot="page-content">`. Test baru `e2e/m1-layout.spec.ts` "CR-1-2 satu landmark main" (4 rute): tepat satu `main`/`role=main`, `main main` = 0. Selector `CONTENT` diperbarui, asersi padding tetap. |
| CR-1-3 | minor | **closed** | `e2e/m1-design-system.spec.ts:62-64` memakai `waitForAnimations` (`e2e/helpers.ts:114-126`, menunggu `document.getAnimations()` selesai) + `data-state=open`; `waitForTimeout` tidak ada lagi di repo. |
| CR-1-4 | minor | **closed** | `e2e/m1-design-system.spec.ts:170-180`: tepat satu button default, dan elemen oranye lain harus persis satu swatch `div.bg-primary` dengan caption `primary#f54e00` (`toEqual` array). |
| CR-1-5 | minor | **closed** (lewat guard) | Nilai `--chart-*` masih pastel (`src/app/globals.css:116-120`), tetapi test baru `src/app/globals-tokens.test.ts` "CR-1-5 / AC-1.6": token chart tidak dipakai di luar globals.css, dan hex pastel hanya boleh sebagai nilai `--stage-*`/`--chart-*`. |
| CR-1-6 | minor | **partially** (diterima gatekeeper) | `next-themes` dihapus dari deps dan `src/components/ui/sonner.tsx` dipaku ke `theme="light"`; `@custom-variant dark` (`globals.css:6`) dan varian `dark:` di `ui/*` masih ada, tetapi tidak aktif. |
| CR-1-7 | minor | **partially** (diterima, M4) | IP sidebar kini dari `GET /api/network` (`src/components/app-sidebar.tsx:41`); status DHCP/TFTP/HTTP `online` dan `10.10.10.1:69` masih hard-code di `src/components/server-status.tsx:19-21`. |
| CR-1-8 | minor | **closed** | `src/app/globals-tokens.test.ts`: `allBlocks()` menggabungkan semua blok `:root` (termasuk di `@layer`, selector list), dengan unit test parser sendiri + asersi jumlah blok = jumlah selector `:root`. |

## Perubahan test (dicek terhadap pelemahan)
- `playwright.config.ts`: kini 7 project + 7 webServer (`next start` per file yang memutasi store, satu build
  produksi). `retries: 0`, `workers: 1`, `PXE_MOCK_SIMULATION=off` tetap untuk semua server kecuali :3101
  (AC-2.9, memang `on`). `--list` membuktikan 58 test/9 file terkumpul → tidak ada file yang hilang dari run.
- AC-1.3: jeda tetap → tunggu animasi (lebih kuat). AC-1.8: selector ikut DOM baru, asersi tidak berubah.
- Oranye di /design: pengecualian dipersempit (lebih kuat).

## Temuan baru

| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-1-9 | minor | dashboard/playwright.config.ts:61-79 | Setiap project memakai `testMatch` eksplisit per file, tanpa project penampung. File spec baru (mis. `m4-*.spec.ts`) yang tidak cocok dengan pola mana pun **tidak dijalankan sama sekali tanpa peringatan**, dan `e2e.log` tetap hijau. Saat ini aman (58/58 terkumpul), tetapi ini risiko laten "suite menyempit diam-diam", sejenis CR-1-1. | Tambah guard: unit test atau `globalSetup` yang membandingkan `e2e/*.spec.ts` dengan gabungan `testMatch` dan gagal bila ada file yatim. Alternatifnya project default dengan `testIgnore` berisi daftar file khusus. Wajib sebelum file E2E M4 ditambahkan. |

## Ringkasan
| Severity | Terbuka |
|---|---|
| critical | 0 |
| major | 0 (CR-1-1 closed) |
| minor | 3 (CR-1-6 partial, CR-1-7 partial, CR-1-9 baru) |
