# M1–M3 — Opsi tooling test

Kandidat decision untuk Orchestrator. DEC-001 sudah menetapkan "Vitest (unit/integration,
coverage v8) + Playwright (E2E)". Dokumen ini mengonfirmasi pilihan itu dan memutuskan detail
yang belum ditetapkan: cara menguji route handler Next 16, browser Playwright, seam store mock,
dan cakupan coverage.

Fakta yang diperiksa (read-only, 2026-11-05):

- `dashboard/package.json`: belum ada vitest/jest/playwright. Next 16.4.5, React 19.3, Node
  v22.22.2, ESM (`"type"` tidak diset; config Vitest pakai `.mts`).
- `command -v google-chrome google-chrome-stable chromium chromium-browser` → **tidak ada**.
- `~/.cache/ms-playwright/` sudah berisi `chromium-1243` (Chrome for Testing 153.0.8010.12),
  `chromium_headless_shell-1243`, `ffmpeg-1011` — hasil unduhan CDN Playwright sebelumnya.
- `next/dist/server/request/connection.js`: `connection()` **melempar**
  (`throwForMissingRequestStore`) bila dipanggil di luar request scope Next. Dipakai oleh
  `GET /api/hosts` dan `GET /api/ssh-keys`.
- `RouteContext<"/api/hosts/[id]">` adalah tipe global hasil `next typegen` (`.next/types`).
- Store mock disimpan di `globalThis.__pxeMockStore` dan memakai `Date.now()`/`Math.random()`.
- Hook guard (`.claude/hooks/guard_bash.py`) mengizinkan unduhan dari registry npm dan CDN
  Playwright.

## O1. Runner unit/integration: Vitest vs Jest

| | Vitest 3/4 | Jest 30 (+ `next/jest` SWC) |
|---|---|---|
| ESM + TS + alias `@/*` | native (Vite), alias lewat `vite-tsconfig-paths` | lewat `next/jest` transform; ESM masih mode eksperimental |
| Dependensi ESM-only (`cn`, `unixcrypt`, `@hugeicons/*`, zod v4) | langsung | sering perlu `transformIgnorePatterns` |
| Web Crypto / `atob` (lib `ssh-key`, `credentials`) | tersedia di Node 22 env `node` | tersedia, tapi `jsdom` env Jest perlu polyfill `crypto.subtle` |
| Coverage | `@vitest/coverage-v8` | built-in (babel/v8) |
| Docs Next 16 bawaan | ada (`docs/01-app/02-guides/testing/vitest.md`) | ada |
| Konsistensi decision | sesuai DEC-001 | butuh decision baru |

**Rekomendasi: Vitest** (sesuai DEC-001). Dua environment via `test.projects`
(atau komentar `// @vitest-environment`): `node` untuk `src/lib/**` dan `src/app/api/**`,
`jsdom` untuk komponen (RTL). Catatan: Vitest tidak mendukung async Server Component — tidak
masalah, halaman di sini sinkron atau client.

## O2. Menguji route handler Next 16 dengan modul server in-memory

**A. Panggil handler langsung di Vitest (env `node`)** — `import { GET, PATCH } from
"@/app/api/hosts/[id]/route"`, panggil dengan `new Request("http://test/api/hosts/x",
{method, body})` dan `{ params: Promise.resolve({ id }) }`. Reset store di `beforeEach`
(`resetMockStore()` dari M2-T1, sementara bisa `delete globalThis.__pxeMockStore`), kunci
waktu dengan `vi.useFakeTimers({ now })`. `connection()` harus di-stub:
`vi.mock("next/server", async (orig) => ({ ...(await orig()), connection: async () => {} }))`.
- (+) Cepat, deterministik, masuk coverage v8, bisa memeriksa store sesudah request (AC atomik).
- (−) Tidak menguji routing/serialisasi Next sungguhan; stub `connection` harus ada di setup.

**B. HTTP ke server Next sungguhan** (`next start` di port test, `fetch` dari Vitest atau
`request` fixture Playwright).
- (+) Menguji routing, header, kode status persis seperti produksi.
- (−) Lambat, store di proses lain (butuh seam HTTP untuk reset), tidak masuk coverage v8
  Vitest.

**C. `next-test-api-route-handler` / harness pihak ketiga** — membungkus handler dengan
resolver Next internal.
- (−) Bergantung internal Next; Next 16 punya API berubah (lihat `dashboard/AGENTS.md`), risiko
  tidak kompatibel; dependensi tambahan tanpa nilai di atas A+B.

**Rekomendasi: A untuk semua AC "integration route handler"**, ditambah **smoke B** kecil di
Playwright (`request.get('/api/hosts')` cek 200 + `no-store`) agar routing nyata tetap
teruji. Opsi C ditolak.

## O3. Browser Playwright: CDN Playwright vs channel chrome lokal

| | A. Chromium bundel Playwright (CDN) | B. `channel: "chrome"` lokal |
|---|---|---|
| Ketersediaan | `chromium-1243` + headless shell **sudah ada** di cache; versi lain bisa diunduh dari CDN Playwright (diizinkan CLAUDE.md) | `google-chrome`/`chromium` **tidak terpasang**; memasang butuh sudo/dnf → dilarang |
| Reproducible | versi terkunci oleh versi `@playwright/test` | ikut update sistem |
| Sudo | tidak perlu (deps sistem sudah tervalidasi: `DEPENDENCIES_VALIDATED`) | perlu untuk instalasi |

**Rekomendasi: A.** Pin `@playwright/test` ke versi yang `browsers.json`-nya menunjuk
chromium revisi **1243** agar cache dipakai ulang tanpa unduhan (cek
`node_modules/playwright-core/browsers.json` setelah install; bila tidak cocok, jalankan
`npx playwright install chromium` — tanpa `--with-deps`, karena itu memanggil sudo). Satu
project `chromium` saja; Firefox/WebKit tidak diwajibkan SPEC. Opsi B tidak mungkin tanpa
melanggar batas keras.

Konfigurasi yang disarankan: `webServer` menjalankan `next build && next start -p 3100`
(port beda dari dev 3000 di `.claude/launch.json`), env `PXE_MOCK_SIMULATION=off`,
`workers: 1` (store in-memory global), `retries: 0` di gate (retry menutupi flaky test),
`trace: 'retain-on-failure'`, output ke `.agent/runs/m<n>/playwright/`.

## O4. Seam store mock untuk test (kandidat decision, terkait G2-1)

**A. Ekspor fungsi + env saja**: `resetMockStore(seed?)` untuk Vitest; env
`PXE_MOCK_SIMULATION=off` menghentikan tick waktu dan discovery. E2E memakai seed default dan
tidak menambah host secara dinamis; AC "host baru muncul" (AC-2.9) diuji dengan env
`PXE_MOCK_DISCOVER_EVERY_MS` kecil.
- (+) Tidak ada endpoint baru; permukaan serangan nol.
- (−) E2E empty state (AC-2.13) butuh server kedua dengan env `PXE_MOCK_SEED=empty`, atau
  diuji dengan `page.route` yang mengembalikan `{hosts: []}`.

**B. Endpoint test `POST /api/__test__/store`** (reset/seed/add host), aktif hanya bila
`PXE_TEST_SEAM=1`.
- (+) E2E fleksibel.
- (−) Endpoint tanpa auth yang bisa tertinggal aktif; reviewer keamanan wajib memeriksa; harus
  dihapus atau tetap terkunci saat backend nyata di M4.

**Rekomendasi: A**, dengan `page.route` untuk empty/error state dan env interval discovery untuk
AC-2.9. Paling aman terhadap SPEC §6 dan tidak meninggalkan endpoint test.

## O5. Cakupan coverage untuk gate "coverage kode baru ≥ 80%" (kandidat decision)

Karena DEC-002 menjadikan seluruh M1–M3 "kode baru", perlu ditetapkan apa yang diukur:

- **A. Vitest v8, include `src/lib/**`, `src/app/api/**`, `src/hooks/**`,
  `src/components/**` (kecuali `src/components/ui/**` hasil generator shadcn)**, dengan RTL
  untuk komponen. Ambang 80% lines/branches per milestone.
  (−) Komponen besar (`config-sheet`, `tab-*`, `hosts-view`) sulit mencapai 80% hanya dengan
  RTL; banyak duplikasi dengan E2E.
- **B. Vitest v8 untuk logika (`src/lib/**`, `src/app/api/**`, `src/hooks/**`,
  `src/components/**/*.ts` non-JSX seperti `form-state.ts`, plus komponen kecil yang diuji RTL)
  ≥ 80%; komponen `.tsx` besar dibuktikan lewat E2E (setiap AC UI punya test) dan dilaporkan
  coverage-nya terpisah via V8 coverage Playwright (Chromium, `page.coverage`) sebagai
  informasi.** `src/components/ui/**` dikecualikan dengan alasan tertulis (vendor shadcn; yang
  direstyle diuji lewat AC-1.4).
- **C. Gabungkan coverage Vitest + Playwright (monocart/istanbul merge) jadi satu angka.**
  (−) Tooling tambahan, rapuh dengan Turbopack/source map Next 16.

**Rekomendasi: B.** Tetap ketat untuk logika yang memuat aturan keamanan/validasi, realistis
untuk UI. Orchestrator perlu menuliskannya di decision agar gatekeeper punya definisi
"kode baru" yang objektif; daftar exclude harus eksplisit di `vitest.config.mts`, bukan
dibiarkan implisit.

## O6. Typecheck & lint

`tsc --noEmit` gagal tanpa tipe global `RouteContext`. Script `typecheck` =
`next typegen && tsc --noEmit`. `lint` = `eslint` (config sudah ada). File test ikut di-typecheck
(tsconfig `include` sudah mencakup `**/*.ts(x)`); tambahkan `types: ["vitest/globals"]` hanya
bila memakai globals — lebih disukai import eksplisit dari `vitest`.

## Ringkasan rekomendasi

| Topik | Rekomendasi |
|---|---|
| Runner | Vitest (DEC-001), env `node` + `jsdom`, coverage v8 |
| Route handler | Panggil handler langsung + stub `connection()` + reset store + fake timers; smoke HTTP di Playwright |
| Browser | Chromium bundel Playwright (cache `chromium-1243` sudah ada; CDN bila perlu), tanpa `--with-deps`, tanpa channel chrome |
| Seam mock | Fungsi reset + env (tanpa endpoint test); `page.route` untuk empty/error |
| Coverage | ≥ 80% untuk logika via Vitest; UI `.tsx` besar lewat E2E per AC; `components/ui/**` dikecualikan eksplisit |
