# DEC-004: Tooling test dan definisi cakupan coverage "kode baru"
- Tanggal: 2026-11-05T06:20:00Z
- Milestone: 1, 2, 3 (berlaku seterusnya)
- Status: Accepted
## Konteks
Gate mewajibkan coverage kode baru ≥ 80%. Karena DEC-002, seluruh kode M1–M3 berstatus "kode
baru". Komponen view besar (`config-sheet`, `tab-*`, `hosts-view`) sulit mencapai 80% lewat unit
test tanpa duplikasi E2E. Opsi dari architect: `docs/design/M1-3-options.md` (O1–O5).
Google Chrome/Chromium sistem tidak terpasang; Chromium bundel Playwright tersedia di cache.
## Opsi yang dipertimbangkan
1. Coverage Vitest untuk semua `src/**` termasuk komponen view (RTL) — ketat tapi mahal dan
   duplikatif dengan E2E.
2. Coverage Vitest ≥ 80% untuk **logika** + setiap AC UI wajib punya test E2E; coverage
   Playwright dilaporkan sebagai informasi.
3. Gabungkan coverage Vitest + Playwright — tooling rapuh dengan Turbopack/source map Next 16.
## Keputusan
Opsi 2, dengan definisi objektif:
- Vitest (jsdom untuk hook/komponen kecil, node untuk server), coverage v8, ambang **80% lines dan
  80% branches** pada include berikut, dipaksakan lewat `coverage.thresholds` di
  `dashboard/vitest.config.mts`:
  `src/lib/**`, `src/app/api/**`, `src/app/boot/**` (mulai M4), `src/hooks/**`,
  `src/components/**/*.ts` (logika non-JSX, mis. `form-state.ts`, `columns` filter bila
  dipisah ke `.ts`).
- Exclude eksplisit, ditulis di config beserta komentar alasan: `src/components/ui/**` (vendor
  shadcn; restyle diuji lewat AC-1.x/E2E), file `*.d.ts`, dan file test.
- Komponen view `.tsx`: dibuktikan per AC lewat Playwright E2E; tidak boleh ada AC UI tanpa test.
- Route handler diuji dengan memanggil handler langsung (stub `next/server` `connection()`),
  plus smoke HTTP via Playwright `request`.
- Playwright memakai Chromium bundelnya (`npx playwright install chromium` bila belum ada;
  host CDN Playwright ada di allowlist).
- Script npm wajib: `typecheck` (`next typegen && tsc --noEmit`), `lint`, `test`
  (`vitest run --coverage`), `test:e2e`.
## Konsekuensi
- Menurunkan ambang atau memperluas exclude di kemudian hari butuh decision baru; gatekeeper
  memperlakukan perubahan diam-diam pada `vitest.config.mts` sebagai pelemahan test (critical).
- UI kompleks bergantung pada kualitas E2E; design-reviewer dan code-reviewer memeriksa bahwa
  E2E benar-benar mengassert hasil, bukan hanya membuka halaman.
