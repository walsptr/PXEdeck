# AC matrix M1 — iterasi 2 (test-engineer)

Sumber status (satu run untuk satu codebase M1–M3, branch `milestone/1-3-baseline` @ fe6a353 + test iter2; log identik di m1/m2/m3):
- `typecheck-iter2.log` exit 0 · `lint-iter2.log` exit 0
- `unit-iter2.log` = `npm run test` biasa (vitest run --coverage, **tanpa flag tambahan**): 21 file, **359/359 lulus, exit 0**. Daftar nama test: `unit-iter2-verbose.log`.
- `coverage-summary-iter2.txt`/`.json` (DEC-004, ambang/include/exclude tidak diubah): **lines 99.78%, branches 98.22%**, statements 99.72%, functions 99.04%.
- `e2e-iter2.log` = `npm run test:e2e`: **58/58 lulus, exit 0** (forbidOnly true, retries 0, workers 1, reuseExistingServer false).

Perubahan infrastruktur test iter2 (menguatkan, bukan melemahkan):
- CR-2-9: `playwright.config.ts` kini menjalankan server `next start` sendiri per file spec yang memutasi store (m2-hosts-table :3102, m3-sheet :3103, m3-bulk :3104, iter2-ui :3105, iter2-network-env :3106; M1+smoke :3100; polling :3101), semuanya dari satu build produksi. Store segar dari seed per file → hasil tidak bergantung urutan file/`--grep`. Diverifikasi: kombinasi project parsial (m2-polling + iter2-ui + m3-bulk + m3-sheet, tanpa m2-hosts-table) dijalankan 3× berturut-turut → 15/15 lulus tiap kali.
- Semua webServer memakai env `PXE_MGMT_*` eksplisit (subnet lab); server iter2-network-env memakai subnet KVM 10.99.0.0/24.
- Tidak ada `.skip/.only/.fixme/test.fail/waitForTimeout` di `dashboard/e2e` maupun `dashboard/src` (grep 0 hit).

| AC / temuan | File test | Nama test | Status |
|---|---|---|---|
| AC-1.1 | dashboard/src/app/globals-tokens.test.ts | AC-1.1 token globals.css › :root %s = %s (25 token, kini dari **gabungan semua blok :root**) · jumlah blok = jumlah selector :root · lima --stage-* · --shadow-* nol · tanpa .dark | PASS |
| AC-1.2 | dashboard/e2e/m1-design-system.spec.ts | AC-1.2 › body bg/teks, font Inter + JetBrains Mono di /hosts · /design | PASS |
| AC-1.3 | dashboard/e2e/m1-design-system.spec.ts | AC-1.3 › /hosts, dropdown aksi baris, dan Sheet konfigurasi (menunggu animasi selesai) · /design | PASS |
| AC-1.4 | dashboard/e2e/m1-design-system.spec.ts | AC-1.4 › Button 40px/8px, Input 44px, Card 12px, pill 9999px · G1-3 pemetaan varian | PASS |
| AC-1.5 | dashboard/e2e/m1-design-system.spec.ts | AC-1.5 › judul top bar, label kolom tabel, sel MAC mono | PASS |
| AC-1.6 | dashboard/src/components/status-pill.test.tsx; dashboard/src/app/globals-tokens.test.ts | AC-1.6 StatusPill (7 status); pemakaian stage-* terbatas; **CR-1-5** token chart tidak dipakai di luar globals.css · hex pastel hanya sebagai nilai --stage-*/--chart-* di globals.css | PASS |
| AC-1.7 | dashboard/src/lib/nav.test.ts | AC-1.7 navigasi (5 item, sub-path, undefined) | PASS |
| AC-1.8 | dashboard/e2e/m1-layout.spec.ts | AC-1.8 › sidebar 5 link …, padding main 32px · item aktif & judul · viewport < 768 padding 24px | PASS |
| AC-1.9 | dashboard/e2e/m1-layout.spec.ts | AC-1.9 › redirect / → /hosts · klik tiap item sidebar · placeholder ×4 | PASS |
| AC-1.10 | dashboard/e2e/m1-layout.spec.ts | AC-1.10 › Ctrl+K/Enter/Escape · pilih host → /hosts?q=<mac> | PASS |
| AC-1.11 | dashboard/e2e/m1-layout.spec.ts; dashboard/src/components/server-status.test.tsx | AC-1.11 status server PXE (DHCP/TFTP/HTTP online/offline) | PASS |
| AC-1.12 | typecheck-iter2.log, lint-iter2.log, e2e-iter2.log | typecheck/lint exit 0; build produksi di awal e2e-iter2.log | PASS |
| (tambahan) oranye | dashboard/e2e/m1-design-system.spec.ts | oranye hanya pada tombol primary — **CR-1-4**: di /design tepat 1 Button default + tepat 1 elemen non-tombol = swatch token `primary` (div `bg-primary`, caption "primary#f54e00") | PASS |
| CR-1-1 | dashboard/playwright.config.ts, dashboard/vitest.config.mts | forbidOnly true, reuseExistingServer false (semua server), Vitest allowOnly false — dipakai oleh run ini | PASS |
| CR-1-2 | dashboard/e2e/m1-layout.spec.ts | CR-1-2 satu landmark main › /hosts, /design, /settings, /ssh-keys: tepat satu `<main>`/role=main, tanpa `main main`, satu `[data-slot=page-content]` | PASS |
| CR-1-3 | dashboard/e2e/m1-design-system.spec.ts, e2e/helpers.ts | `waitForTimeout(600)` diganti `waitForAnimations()` (poll `document.getAnimations()` sampai 0 running/pending) + `data-state=open` | PASS |
| CR-1-8 | dashboard/src/app/globals-tokens.test.ts | CR-1-8 parser semua blok :root › menangkap :root kedua, :root di @layer, selector list; nilai terakhir menang | PASS |

**Perubahan selector (bukan pelemahan):** `e2e/m1-layout.spec.ts:9` `CONTENT` berubah dari `main[data-slot=sidebar-inset] > main` menjadi `main[data-slot=sidebar-inset] > [data-slot=page-content]` karena struktur DOM berubah (CR-1-2: `<main>` dalam layout diganti `<div data-slot="page-content">`). Elemen yang diuji sama (wadah konten di dalam SidebarInset); asersi padding 32px/24px dan isi placeholder tidak berubah. Ditambah test baru yang memastikan hanya ada satu landmark main.

Screenshot: `screenshots/` (ac-1.3-*, ac-1.4-*, ac-1.8-*, ac-1.10-*).
