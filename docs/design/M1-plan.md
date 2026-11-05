# M1 — Setup, design tokens, layout (plan)

- Milestone: 1 (baseline, DEC-002) · Branch: `milestone/1-3-baseline`
- Sumber: SPEC §1 (design system), §2 (layout); DEC-001 (stack), DEC-002 (baseline)
- Tooling test: lihat `docs/design/M1-3-options.md` (kandidat decision)

## 1. Scope

Kode sudah ada. M1 = membuktikan dengan test otomatis bahwa fondasi UI sesuai SPEC, lalu
menutup gap kecil. Termasuk:

- Token warna SPEC §1 → variabel shadcn + token tambahan (`src/app/globals.css`).
- Tipografi: Inter + JetBrains Mono (fontsource, self-hosted), utilitas `type-*`.
- Bentuk: radius 8/12/9999, **tanpa drop shadow** (shadow theme di-nol-kan; hairline via
  `ring-1`/`border`), tinggi tombol 40px, input 44px.
- Komponen ui yang direstyle: `button`, `input`, `card`, `checkbox`, `table`, `switch`,
  `radio-group` (+ `badge` lewat `status-pill`).
- Layout §2: sidebar krem (5 item nav), top bar 64px (judul, search global Ctrl+K, status
  DHCP/TFTP/HTTP), konten padding 24–32px; halaman placeholder untuk OS Images, SSH Keys,
  Jobs, Settings; halaman `/design` (style guide); redirect `/` → `/hosts`.
- Setup tooling test (Vitest + Playwright) — prasyarat semua milestone.

Tidak termasuk: isi halaman pendukung (M4/M5), status server nyata (M4), auth (M6).

## 2. Task

| ID | Owner | Deskripsi | Dependensi | File |
|---|---|---|---|---|
| M1-T1 | frontend-dev | Pasang tooling test sesuai decision tooling: devDeps Vitest (+ coverage v8, RTL, jsdom), Playwright; script `test`, `test:unit`, `test:e2e`, `typecheck` (`next typegen && tsc --noEmit`), `lint`. Konfigurasi `vitest.config.mts`, `playwright.config.ts` (webServer `next build && next start` di port terpisah). | decision tooling | `dashboard/package.json`, `dashboard/vitest.config.mts`, `dashboard/playwright.config.ts` |
| M1-T2 | frontend-dev | Verifikasi + lengkapi gap tokens/komponen (lihat §4: G1-1, G1-2, G1-3). Pastikan `typecheck` & `lint` bersih untuk seluruh `src/`. | M1-T1 | `globals.css`, `components/ui/input.tsx`, `components/ui/*` |
| M1-T3 | frontend-dev | Verifikasi + lengkapi gap layout (G1-4, G1-5): `data-testid`/atribut a11y yang dibutuhkan test bila belum ada (tanpa mengubah perilaku). | M1-T1 | `app-sidebar.tsx`, `top-bar.tsx`, `server-status.tsx` |
| M1-T4 | test-engineer | Unit test token & util: parse `globals.css` (AC-1.1), `navItemFor` (AC-1.7), `StatusPill` RTL (AC-1.6). | M1-T1 | `dashboard/src/**/*.test.ts(x)` |
| M1-T5 | test-engineer | E2E Playwright: computed style, layout, nav, search, redirect (AC-1.2–1.5, 1.8–1.11). Bukti ke `.agent/runs/m1/`. | M1-T2, M1-T3 | `dashboard/e2e/m1-*.spec.ts` |

## 3. Acceptance criteria

Semua nilai warna diuji dalam bentuk `rgb()` hasil `getComputedStyle` (E2E) atau string hex
dari `globals.css` (unit).

- **AC-1.1** (unit Vitest) `globals.css` `:root` mendefinisikan tepat nilai SPEC: `--background`
  #f7f7f4, `--canvas-soft` #fafaf7, `--card`/`--popover` #ffffff, `--foreground` #26251e,
  `--body` #5a5852, `--muted-foreground` #807d72, `--muted-soft` #a09c92, `--border`/`--input`
  #e6e5e0, `--hairline-soft` #efeee8, `--hairline-strong` #cfcdc4, `--secondary`/`--muted`
  #e6e5e0, `--primary`/`--ring` #f54e00, `--primary-active` #d04200, `--primary-foreground`
  #ffffff, `--destructive` #cf2d56, `--success` #1f8a65, dan lima `--stage-*` sesuai SPEC; semua
  `--shadow-*` di blok `@theme` bernilai nol.
- **AC-1.2** (e2e) Di `/hosts` dan `/design`: `body` background `rgb(247, 247, 244)`, warna teks
  `rgb(38, 37, 30)`; font-family `html` diawali `"Inter Variable"`; font `document.fonts`
  memuat Inter dan JetBrains Mono (`document.fonts.check`).
- **AC-1.3** (e2e) **Tanpa drop shadow**: pada `/hosts`, `/design`, dan saat dropdown aksi baris
  + Sheet konfigurasi terbuka, untuk setiap elemen yang terlihat, setiap lapisan
  `box-shadow` punya offset-x = offset-y = 0 dan blur = 0 (lapisan ring/hairline spread-only
  diizinkan).
- **AC-1.4** (e2e) Bentuk & ukuran di `/design`: `Button` default tinggi 40px radius 8px;
  `Input` tinggi 44px radius 8px border `rgb(230, 229, 224)`; `Card` radius 12px background
  putih; badge/pill radius ≥ 9999px (computed `border-radius` sangat besar); placeholder
  input berwarna muted-soft `rgb(160, 156, 146)`.
- **AC-1.5** (e2e) Tipografi: judul halaman di top bar 26px/400, letter-spacing -0.325px; label
  kolom tabel host 11px/600 uppercase, letter-spacing 0.88px, warna muted; sel MAC memakai
  font-family yang diawali `"JetBrains Mono Variable"`.
- **AC-1.6** (unit Vitest + RTL) `StatusPill` merender label dan `data-status` untuk ketujuh
  status; `done` dan `failed` memakai teks putih, `offline` kelas netral; kelas `bg-stage-*`
  hanya dipakai di `status-pill.tsx` (grep test atas `src/` tidak menemukan `stage-` di file
  lain selain `globals.css`, `status-pill.tsx`, `design/page.tsx`).
- **AC-1.7** (unit Vitest) `NAV_ITEMS` berisi tepat 5 item berurutan Hosts, OS Images, SSH Keys,
  Provisioning Jobs, Settings; `navItemFor` cocok untuk path persis dan sub-path
  (`/hosts/abc`), dan `undefined` untuk `/design` dan `/hostsx`.
- **AC-1.8** (e2e) Layout: sidebar memuat 5 link nav tersebut; item aktif punya
  `data-active="true"` sesuai halaman; sidebar border kanan hairline; top bar tinggi 64px dan
  memuat judul halaman sesuai nav; `main` padding 24px (viewport < 768) / 32px (≥ 768).
- **AC-1.9** (e2e) Navigasi: `GET /` redirect ke `/hosts`; klik tiap item sidebar membuka
  halaman yang benar dengan `<title>` `"<Label> · PXE Lab"`; empat halaman placeholder
  menampilkan judul + deskripsi.
- **AC-1.10** (e2e) Pencarian global: `Ctrl+K` membuka dialog "Pencarian global"; mengetik nama
  halaman lalu Enter bernavigasi; memilih host menuju `/hosts?q=<mac>` dan tabel terfilter ke
  host itu; `Escape` menutup dialog.
- **AC-1.11** (e2e) Status server PXE: top bar menampilkan tiga indikator DHCP, TFTP, HTTP,
  masing-masing dengan teks aksesibel `online`/`offline`; komponen `ServerStatus` dengan prop
  `online: false` merender titik `--destructive` (unit RTL boleh menggantikan bagian ini).
- **AC-1.12** (CI gate) `npm run typecheck`, `npm run lint` bersih; `npm run build` sukses.

Total: 12 AC.

## 4. Gap kode vs SPEC (M1)

| ID | Gap | Tindakan | Owner |
|---|---|---|---|
| G1-1 | `Input` memakai `placeholder:text-muted-foreground` (#807d72), SPEC: placeholder = muted-soft #a09c92. Utilitas komponen menimpa aturan global `::placeholder`. | Ganti ke `placeholder:text-muted-soft`; cek juga `InputGroupInput`, `textarea`, `CommandInput`. | frontend-dev |
| G1-2 | Belum ada tooling test, script `typecheck`/`test`. `RouteContext` adalah tipe global hasil `next typegen`; `tsc` tanpa typegen bisa gagal. | M1-T1. | frontend-dev |
| G1-3 | Pemetaan nama varian tombol ke SPEC tidak terdokumentasi: SPEC "secondary (putih + hairline)" = varian `outline`; varian `secondary` shadcn = abu `surface-strong`. Risiko dev salah pakai. | Dokumentasikan di `/design` (bagian tombol) dengan label SPEC; tidak perlu ubah API. | frontend-dev |
| G1-4 | Sidebar menampilkan nilai hard-coded `10.10.10.1` dan `Ubuntu 24.04.5 · dnsmasq`; `ServerStatus` memakai `MOCK_STATUS` statis. | **Di luar scope, milestone 4** (Settings + `GET /api/server/status`). Di M1 cukup diuji bentuk/a11y-nya. | — |
| G1-5 | Halaman OS Images, SSH Keys, Jobs, Settings masih placeholder. | **Di luar scope, milestone 4 (OS Images, SSH Keys, Settings) dan 5 (Jobs).** | — |
| G1-6 | Varian `dark` dan dependensi `next-themes` ada tetapi SPEC light-only. | Tidak wajib; boleh dibiarkan selama tidak ada token dark yang aktif. Reviewer cukup mencatat. | — |

## 5. Risiko

- **Ring = box-shadow.** Tailwind `ring-*` dirender sebagai `box-shadow` spread-only. Test
  "tanpa shadow" harus mem-parse lapisan, bukan menuntut `box-shadow: none` (AC-1.3).
- **Font loading** di E2E bisa terlambat → tunggu `document.fonts.ready` sebelum asersi.
- **Next 16 + `cacheComponents`**: `next build` bisa gagal bila komponen dinamis tidak dibungkus
  `Suspense`; dev wajib baca `node_modules/next/dist/docs/` (lihat `dashboard/AGENTS.md`).
- **Viewport**: asersi padding/top bar bergantung breakpoint; kunci viewport di config
  Playwright (mis. 1440×900 + satu kasus 390×844).
