# AC matrix M1 — iterasi 3 (test-engineer)

Sumber status (satu run untuk satu codebase M1–M3, branch `milestone/1-3-baseline` @ 541fb8d + test iter3; log identik di m1/m2/m3):
- `typecheck-iter3.log` exit 0 · `lint-iter3.log` exit 0
- `unit-iter3.log` = `npm run test` biasa (vitest run --coverage, **tanpa flag tambahan**): 21 file, **365/365 lulus, exit 0**. Daftar nama test: `unit-iter3-verbose.log`.
- `coverage-summary-iter3.txt`/`.json` (DEC-004, ambang/include/exclude tidak diubah; 31 file): **lines 99.79%, branches 98%**, statements 99.72%, functions 99.05%.
- `e2e-iter3.log` = `npm run test:e2e`: **64/64 lulus, exit 0** (forbidOnly true, retries 0, workers 1, reuseExistingServer false; guard CR-1-9 aktif).

Perubahan test iter3 (menguatkan, bukan melemahkan):
- Spec baru `dashboard/e2e/iter3-ui.spec.ts` (6 test) didaftarkan di `FILE_SERVERS` (`iter3-ui`, :3107, env lab) — guard CR-1-9 lulus (10 spec, masing-masing tepat 1 project).
- `e2e/helpers.ts` `dropShadowViolations(page, scope = "body *")`: parameter scope opsional; default (dipakai AC-1.3) tidak berubah.
- `e2e/m3-bulk.spec.ts`: `waitForAnimations()` sebelum screenshot `ac-3.14-passwords-dialog` (I-3-13); asersi tidak diubah.
- Uji mutasi DR-1-2: `sonner.tsx` dikembalikan sementara ke versi sebelum 541fb8d → 3/3 test toast iter3 **gagal** (`dropShadowViolations([data-sonner-toast])` menemukan drop shadow); file dipulihkan (`git checkout`), lalu run penuh di atas.
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
| AC-1.12 | typecheck-iter3.log, lint-iter3.log, e2e-iter3.log | typecheck/lint exit 0; build produksi di awal e2e-iter3.log | PASS |
| (tambahan) oranye | dashboard/e2e/m1-design-system.spec.ts | oranye hanya pada tombol primary — **CR-1-4**: di /design tepat 1 Button default + tepat 1 elemen non-tombol = swatch token `primary` (div `bg-primary`, caption "primary#f54e00") | PASS |
| CR-1-1 | dashboard/playwright.config.ts, dashboard/vitest.config.mts | forbidOnly true, reuseExistingServer false (semua server), Vitest allowOnly false — dipakai oleh run ini | PASS |
| CR-1-2 | dashboard/e2e/m1-layout.spec.ts | CR-1-2 satu landmark main › /hosts, /design, /settings, /ssh-keys: tepat satu `<main>`/role=main, tanpa `main main`, satu `[data-slot=page-content]` | PASS |
| CR-1-3 | dashboard/e2e/m1-design-system.spec.ts, e2e/helpers.ts | `waitForTimeout(600)` diganti `waitForAnimations()` (poll `document.getAnimations()` sampai 0 running/pending) + `data-state=open` | PASS |
| CR-1-8 | dashboard/src/app/globals-tokens.test.ts | CR-1-8 parser semua blok :root › menangkap :root kedua, :root di @layer, selector list; nilai terakhir menang | PASS |
| DR-1-2 (iter3) | dashboard/e2e/iter3-ui.spec.ts | DR-1-2 toast Sonner tanpa drop shadow (alur nyata M2 & M3) › M2 hapus host · M2 reboot ke PXE · M3 simpan konfigurasi — di keadaan diam, hover, dan focus-visible: `dropShadowViolations(page, "[data-sonner-toast], [data-sonner-toast] *")` = [], setiap lapisan box-shadow toast offset 0 & blur 0, ring spread hanya terlihat saat `:focus-visible` (dan memang ada saat fokus keyboard), border 1px solid = token `--border` di 4 sisi, radius 12px di 4 sudut; plus `dropShadowViolations(page)` seluruh halaman = [] saat toast tampil | PASS |
| CR-1-9 (iter3) | dashboard/playwright.config.ts | `assertEverySpecCollected()` — run e2e-iter3 memuat config dengan 10 spec (iter3-ui terdaftar di FILE_SERVERS), 64 test terkumpul | PASS |

**Perubahan selector (bukan pelemahan):** `e2e/m1-layout.spec.ts:9` `CONTENT` berubah dari `main[data-slot=sidebar-inset] > main` menjadi `main[data-slot=sidebar-inset] > [data-slot=page-content]` karena struktur DOM berubah (CR-1-2: `<main>` dalam layout diganti `<div data-slot="page-content">`). Elemen yang diuji sama (wadah konten di dalam SidebarInset); asersi padding 32px/24px dan isi placeholder tidak berubah. Ditambah test baru yang memastikan hanya ada satu landmark main.

Screenshot: `screenshots/` (ac-1.3-*, ac-1.4-*, ac-1.8-*, ac-1.10-*).
