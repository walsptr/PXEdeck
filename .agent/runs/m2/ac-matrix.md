# AC matrix M2 — test-engineer
Sumber status: `unit.log` (`npm run test`: 244 test, 243 lulus, 1 gagal, exit 1), `e2e.log` (`npm run test:e2e`: 42 lulus, 0 gagal, exit 0), `typecheck.log`/`lint.log` (exit 0). Coverage DEC-004: lines 99.64%, branches 97.90% (`coverage-summary.txt`/`.json`). Satu codebase untuk M1–M3, log sama di m1/m2/m3.

| AC | File test | Nama test | Status |
|---|---|---|---|
| AC-2.1 | dashboard/src/lib/oui.test.ts | AC-2.1 lookupVendor › prefix dikenal · huruf besar diterima · tidak dikenal → null; AC-2.1 osLabel › id katalog · id asing · null/undefined | PASS |
| AC-2.2 | dashboard/src/lib/format.test.ts | AC-2.2 formatRelative › < 45 dtk · 2 menit · 3 jam · **2 hari → '2 hari yang lalu'**; AC-2.2 ipToNumber | **FAIL** (1 dari 8): produk mengembalikan "kemarin dulu" (Intl numeric:"auto"), bukan "2 hari yang lalu" — bug `dashboard/src/lib/format.ts:1` |
| AC-2.3 | dashboard/src/lib/server/mock-hosts.test.ts | AC-2.3 store mock › 14 host seed · booting → installing (20) → configuring (+60) → done (+20) · discovery tiap 40 dtk maks 4 · tidak menambah ulang · listHosts salinan; seam DEC-005 (simulasi off, interval env, seed empty) | PASS |
| AC-2.4 | dashboard/src/lib/server/mock-hosts.test.ts | AC-2.4 deleteHost & rebootToPxe › menghapus host + konfigurasi · id tak dikenal → false · osAssigned → booting · tanpa osAssigned → discovered · id tak dikenal → null | PASS |
| AC-2.5 | dashboard/src/app/api/hosts/hosts-routes.test.ts | AC-2.5 GET /api/hosts › 200, Cache-Control no-store, skema Host (zod) · seed empty; AC-2.5 GET /api/hosts/:id › 200 · 404 · 400 id bukan 12 hex | PASS |
| AC-2.6 | dashboard/src/app/api/hosts/hosts-routes.test.ts | AC-2.6 DELETE & reboot › DELETE 204 lalu GET 404 · DELETE tak dikenal 404/invalid 400 · POST reboot 200 status baru · reboot tak dikenal 404 | PASS |
| AC-2.7 | dashboard/src/components/hosts/columns.test.tsx | AC-2.7 pencarian global (format MAC setara, hostname/IP lease/IP mgmt) · filter kolom (status multi, OS terpasang ATAU ditugaskan, "none") · sorting (urutan PROVISION_STATUSES, IP numerik) — instance useTable v9 | PASS |
| AC-2.8 | dashboard/e2e/m2-hosts-table.spec.ts | AC-2.8 › header kolom, satu baris per host API, '—', font mono, pill data-status | PASS |
| AC-2.9 | dashboard/e2e/m2-polling.spec.ts | AC-2.9 host baru discovery muncul ≤ 6 dtk tanpa reload; polling ~5 dtk (server kedua :3101, PXE_MOCK_DISCOVER_EVERY_MS=2000) | PASS |
| AC-2.10 | dashboard/e2e/m2-hosts-table.spec.ts | AC-2.10 › pencarian MAC/hostname/IP · filter status (hitungan), filter OS, Reset, tanpa hasil · /hosts?q=<mac> | PASS |
| AC-2.11 | dashboard/e2e/m2-hosts-table.spec.ts | AC-2.11 › 2 baris → toolbar, hanya Install OS primary, batal · Shift+klik rentang · checkbox header semua/indeterminate; tersembunyi oleh filter | PASS |
| AC-2.12 | dashboard/e2e/m2-hosts-table.spec.ts | AC-2.12 › tepat lima aksi · Hapus (Batal/konfirmasi + toast) · Reboot ke PXE · Lihat log → /jobs?host=<id> · Install OS/Edit membuka Sheet | PASS |
| AC-2.13 | dashboard/e2e/m2-hosts-table.spec.ts | AC-2.13 › {hosts: []} → 'Belum ada host' · 500 → Alert 'Gagal memuat data host' (page.route) | PASS |
| AC-2.14 | dashboard/e2e/m2-hosts-table.spec.ts | AC-2.14 › tombol copy terlihat saat fokus keyboard dan menulis MAC ke clipboard | PASS |

Pendukung coverage: dashboard/src/hooks/hooks.test.ts (use-hosts polling 5 dtk, delete/reboot, use-now clock skew G2-4).
Screenshot: `screenshots/` (ac-2.8 … ac-2.14).
