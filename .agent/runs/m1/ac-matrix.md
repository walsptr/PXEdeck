# AC matrix M1 — test-engineer
Sumber status: `unit.log` (`npm run test`: 244 test, 243 lulus, 1 gagal, exit 1), `e2e.log` (`npm run test:e2e`: 42 lulus, 0 gagal, exit 0), `typecheck.log`/`lint.log` (exit 0). Coverage DEC-004: lines 99.64%, branches 97.90% (`coverage-summary.txt`/`.json`). Satu codebase untuk M1–M3, log sama di m1/m2/m3.

| AC | File test | Nama test | Status |
|---|---|---|---|
| AC-1.1 | dashboard/src/app/globals-tokens.test.ts | AC-1.1 token globals.css › :root %s = %s (25 token) · lima token --stage-* · semua --shadow-* di blok @theme bernilai nol · tidak ada token warna dark aktif | PASS |
| AC-1.2 | dashboard/e2e/m1-design-system.spec.ts | AC-1.2 warna dasar & font › body bg/teks, font Inter + JetBrains Mono di /hosts · … di /design | PASS |
| AC-1.3 | dashboard/e2e/m1-design-system.spec.ts | AC-1.3 tanpa drop shadow › /hosts, dropdown aksi baris, dan Sheet konfigurasi · /design | PASS |
| AC-1.4 | dashboard/e2e/m1-design-system.spec.ts | AC-1.4 › Button 40px/8px, Input 44px/8px border hairline, Card 12px putih, pill 9999px, placeholder muted-soft · G1-3: pemetaan varian tombol ke SPEC terdokumentasi | PASS |
| AC-1.5 | dashboard/e2e/m1-design-system.spec.ts | AC-1.5 tipografi › judul top bar, label kolom tabel, sel MAC mono | PASS |
| AC-1.6 | dashboard/src/components/status-pill.test.tsx; dashboard/src/app/globals-tokens.test.ts | AC-1.6 StatusPill › status %s → label + data-status (7) · done & failed memakai teks putih · offline memakai kelas netral · …; AC-1.6 pemakaian stage-* terbatas | PASS |
| AC-1.7 | dashboard/src/lib/nav.test.ts | AC-1.7 navigasi › NAV_ITEMS berisi tepat 5 item berurutan · cocok untuk path persis dan sub-path · undefined untuk /design, /hostsx, dan / | PASS |
| AC-1.8 | dashboard/e2e/m1-layout.spec.ts | AC-1.8 layout › sidebar 5 link, item aktif, border hairline, top bar 64px, padding main 32px · item aktif & judul mengikuti halaman · viewport < 768 › padding main 24px | PASS |
| AC-1.9 | dashboard/e2e/m1-layout.spec.ts | AC-1.9 navigasi › GET / redirect ke /hosts · klik tiap item sidebar … <title> · placeholder /os-images, /ssh-keys, /jobs, /settings | PASS |
| AC-1.10 | dashboard/e2e/m1-layout.spec.ts | AC-1.10 pencarian global › Ctrl+K buka dialog, cari halaman + Enter, Escape menutup · memilih host → /hosts?q=<mac> dan tabel terfilter | PASS |
| AC-1.11 | dashboard/e2e/m1-layout.spec.ts; dashboard/src/components/server-status.test.tsx | AC-1.11 status server PXE › top bar menampilkan DHCP, TFTP, HTTP …; AC-1.11 ServerStatus › online: false → teks offline + titik bg-destructive | PASS |
| AC-1.12 | typecheck.log, lint.log, e2e.log (webServer `npm run build`) | npm run typecheck / npm run lint exit 0; build produksi "Compiled successfully" di awal e2e.log | PASS |
| (tambahan) | dashboard/e2e/m1-design-system.spec.ts | oranye hanya pada tombol primary (/hosts, /design) | PASS |

Screenshot: `screenshots/` (ac-1.3-*, ac-1.4-*, ac-1.8-*, ac-1.10-*).
Temuan (tidak diuji sebagai AC): dua landmark `<main>` bersarang (SidebarInset `<main>` + `<main>` di layout) — lihat laporan.
