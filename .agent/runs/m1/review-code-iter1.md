# Review kode M1 — iterasi 1 (code-reviewer)

- Branch `milestone/1-3-baseline` @ 8f4b2d7 · Lingkup: setup tooling test, tokens, layout (AC-1.1–1.12)
- Dibaca: `docs/SPEC.md`, `docs/design/M1-plan.md`, DEC-001…006, `.agent/runs/m1/*`
- Dijalankan ulang (read-only): `npm run typecheck` exit 0, `npm run lint` exit 0,
  `npm run test:unit` 243/244 lulus (1 gagal = AC-2.2, lihat review M2 CR-2-1). E2E/build tidak
  dijalankan (dipakai reviewer lain); dipakai `e2e.log` (42 lulus).
- Cek pelemahan test: tidak ada `.skip`/`.only`/`fixme`/`test.fail` di `e2e/**` maupun
  `src/**/*.test.*`; `retries: 0`, `workers: 1`; ambang coverage `vitest.config.mts` sesuai DEC-004.

## Temuan

| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-1-1 | major | dashboard/playwright.config.ts:15, :31; dashboard/vitest.config.mts (tanpa `allowOnly`) | Proteksi gate hanya aktif bila `CI` di-set: `forbidOnly: !!process.env.CI`, `reuseExistingServer: !process.env.CI`, dan Vitest `allowOnly` default `!CI`. Gate di workflow ini dijalankan lokal tanpa `CI`, sehingga `.only` yang tertinggal tidak menggagalkan run (suite diam-diam menyempit) dan E2E bisa memakai server yang sudah berjalan di :3100 (mis. `next dev` dengan simulasi aktif / store termutasi) alih-alih build produksi dengan `PXE_MOCK_SIMULATION=off`. Saat ini tidak ada `.only` (laten, bukan pelemahan aktif). | Set `forbidOnly: true`, `reuseExistingServer: false` untuk server :3100, dan `allowOnly: false` di `vitest.config.mts` (perubahan menguatkan; tidak menyentuh ambang/include). |
| CR-1-2 | minor | dashboard/src/app/(dashboard)/layout.tsx:13 | `<main>` bersarang di dalam `SidebarInset` yang sudah me-render `<main data-slot="sidebar-inset">` → dua landmark `main` (a11y). Test AC-1.8 bahkan bergantung pada selector `main > main`. | Ganti `<main>` dalam layout menjadi `<div>` (atau `SidebarInset` sebagai `div`) dan perbarui selector `CONTENT` di `e2e/m1-layout.spec.ts`. |
| CR-1-3 | minor | dashboard/e2e/m1-design-system.spec.ts:53 | AC-1.3 (Sheet) menunggu `waitForTimeout(600)` tetap untuk animasi slide-in sebelum memindai shadow — rawan flaky di mesin lambat dan bisa memindai di tengah animasi. | Tunggu `document.getAnimations()` selesai (`Promise.all(a.map(x=>x.finished))`) atau `expect.poll` sampai `data-state=open` + transform none. |
| CR-1-4 | minor | dashboard/e2e/m1-design-system.spec.ts:161-163 | Asersi "oranye hanya pada tombol primary" di `/design` menerima **semua** `div` oranye (`else expect(el.tag).toBe("div")`), bukan hanya swatch token primary — longgar. | Batasi pengecualian ke swatch (mis. `data-token="primary"`/aria-label swatch) dan assert jumlahnya. |
| CR-1-5 | minor | dashboard/src/app/globals.css:116-120 | Token `--chart-1..5` memakai hex pastel tahap provisioning (SPEC: pastel HANYA di status pill/timeline). Guard AC-1.6 hanya mencari string `stage-`, sehingga pemakaian pastel lewat `bg-chart-*` lolos tanpa terdeteksi. Saat ini `chart-*` belum dipakai. | Ganti nilai `--chart-*` dengan warna netral/ink, atau perluas test AC-1.6 agar juga mencari hex pastel & `chart-`. |
| CR-1-6 | minor | dashboard/src/app/globals.css:6; varian `dark:` di `src/components/ui/*` | Sisa dukungan dark mode (`@custom-variant dark`, `next-themes` di deps) padahal SPEC light-only (G1-6). Tidak aktif karena tidak ada token `.dark`. | Catat/dibiarkan sesuai plan; hapus `next-themes` bila tidak dipakai. |
| CR-1-7 | minor | dashboard/src/components/app-sidebar.tsx:80, :122; dashboard/src/components/server-status.tsx:170-174 | IP `10.10.10.1`, "Ubuntu 24.04.5 · dnsmasq", dan status DHCP/TFTP/HTTP `online` di-hard-code — top bar selalu menunjukkan "online" walau server mati. Sudah dinyatakan di luar scope (G1-4, M4), dicatat agar tidak lolos ke M4. | M4: `GET /api/server/status` + Settings; sampai itu, beri label "mock". |
| CR-1-8 | minor | dashboard/src/app/globals-tokens.test.ts:12-22, :61 | AC-1.1 hanya mem-parse blok `:root {` **pertama**; override token di blok `:root` kedua/`@layer` tidak akan terdeteksi (E2E AC-1.2 hanya mengecek bg/fg body). | Gabungkan semua blok `:root` (atau assert hanya ada satu) sebelum membandingkan. |

## Kesesuaian AC (ringkas)
AC-1.1–1.12 masing-masing punya test yang benar-benar mengassert nilai (computed style/rgb,
ukuran px, urutan nav, redirect 307/308, `<title>`, font `document.fonts.check`). Parser
box-shadow AC-1.3 memisahkan lapisan dengan benar dan mengizinkan ring spread-only. Tidak ada
temuan kebenaran yang membuat AC M1 tidak terpenuhi.

## Ringkasan
| Severity | Jumlah |
|---|---|
| critical | 0 |
| major | 1 (CR-1-1) |
| minor | 7 |
