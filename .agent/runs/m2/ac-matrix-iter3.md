# AC matrix M2 — iterasi 3 (test-engineer)

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
| AC-2.1 | dashboard/src/lib/oui.test.ts | AC-2.1 lookupVendor · osLabel | PASS |
| AC-2.2 | dashboard/src/lib/format.test.ts | AC-2.2 formatRelative › < 45 dtk · 2 menit · 45 dtk → menit · 3 jam · **2 hari → '2 hari yang lalu'** (test iter1 tidak diubah) · **iter2: 1 hari → '1 hari yang lalu' (bukan 'kemarin'), 1 jam, 1 menit** · masa depan numerik; ipToNumber | PASS (CR-2-1 tertutup) |
| AC-2.3 | dashboard/src/lib/server/mock-hosts.test.ts | AC-2.3 store mock (seed, tahap, discovery) + seam DEC-005 | PASS |
| AC-2.4 | dashboard/src/lib/server/mock-hosts.test.ts | AC-2.4 deleteHost & rebootToPxe | PASS |
| AC-2.5 | dashboard/src/app/api/hosts/hosts-routes.test.ts; dashboard/src/app/api/iter2-routes.test.ts | AC-2.5 GET /api/hosts, /:id; **CR-2-5** no-store di semua GET (hosts, host/:id, config, ssh-keys, network) | PASS |
| AC-2.6 | dashboard/src/app/api/hosts/hosts-routes.test.ts; iter2-routes.test.ts | AC-2.6 DELETE & reboot; **SR-2-2** DELETE/reboot: Origin asing/null/Sec-Fetch-Site cross-site → 403 tanpa efek, tanpa Content-Type diterima, Content-Type non-JSON → 415 | PASS |
| AC-2.7 | dashboard/src/components/hosts/columns.test.tsx | AC-2.7 pencarian/filter/sort; **CR-2-4** MAC Cisco `5254.0010.1011`/`5254.0010`/`0CC4.7A91.5E10` cocok, query IP `10.10.10` tidak cocok dengan digit MAC; **CR-2-3** sort hostname naik & turun: tanpa hostname di akhir | PASS |
| AC-2.8 | dashboard/e2e/m2-hosts-table.spec.ts | AC-2.8 › header kolom, baris per host API, '—', mono, pill | PASS |
| AC-2.9 | dashboard/e2e/m2-polling.spec.ts | AC-2.9 host baru ≤ 6 dtk tanpa reload; polling ~5 dtk — **CR-2-7**: batas kini `≤ 6 000 ms` (sama dengan teks AC) untuk kemunculan dan untuk tiap jeda polling (> 4 000, ≤ 6 000) | PASS |
| AC-2.10 | dashboard/e2e/m2-hosts-table.spec.ts; dashboard/e2e/iter2-ui.spec.ts | AC-2.10 › pencarian · **CR-2-8** filter status: tepat 7 item berurutan, teks persis `^<Label>\s*<n>$`, sel hitungan = API, total = jumlah host · filter OS, Reset, tanpa hasil · ?q=; iter2: pencarian MAC Cisco (E2E), sort Hostname naik/turun '—' di akhir (E2E) | PASS |
| AC-2.11 | dashboard/e2e/m2-hosts-table.spec.ts; iter2-ui.spec.ts | AC-2.11 › toolbar, Shift+klik, header checkbox; **DR-2-1/2-2**: tombol bulk bar & Batalkan pilihan 36px, Filter OS & input pencarian 36px | PASS |
| AC-2.12 | dashboard/e2e/m2-hosts-table.spec.ts | AC-2.12 › lima aksi · Hapus · Reboot · Lihat log · Install/Edit membuka Sheet | PASS |
| AC-2.13 | dashboard/e2e/m2-hosts-table.spec.ts; iter2-ui.spec.ts | AC-2.13 › empty · error 500; **CR-2-6** empty state menampilkan subnet dari /api/network (10.10.10.0/24) | PASS |
| AC-2.14 | dashboard/e2e/m2-hosts-table.spec.ts | AC-2.14 copy MAC | PASS |
| G-SEC-2 | dashboard/src/lib/server/mock-hosts.test.ts | iter2 G-SEC-2 hash seed demo › bukan hash lab (salt hash lab lama), tidak cocok dengan password lab/umum · source tanpa hash lab/`LAB_PASSWORD_HASH`/pola `crypt "…"` | PASS |
| CR-2-9 | dashboard/playwright.config.ts | server per file spec (lihat atas); komentar "urutan penting" di m2-hosts-table.spec.ts diganti | PASS |
| DR-1-2 (iter3, alur M2) | dashboard/e2e/iter3-ui.spec.ts | DR-1-2 › M2 hapus host → toast "win-jump dihapus dari daftar" · M2 reboot ke PXE → toast "legacy-01 di-reboot ke PXE": datar di diam/hover/focus-visible, border 1px, radius 12px (detail di M1) | PASS |
| CR-2-2 (iter3) | dashboard/src/hooks/hooks.test.ts | use-now: `now` disegarkan saat subscribe dan saat `visibilitychange` → visible (test dari dev 541fb8d, lulus di unit-iter3.log) | PASS |

Pendukung: dashboard/src/hooks/hooks.test.ts (use-hosts, use-now, **use-network-config**).
Screenshot: `screenshots/` (ac-2.8 … ac-2.14, iter2-search-cisco-mac, iter3-toast-delete-*, iter3-toast-reboot-*).
