# Review design M1 — iterasi 3

- Reviewer: design-reviewer · Branch `milestone/1-3-baseline` @ `76cd8ac`
- Metode: `npm run build` (exit 0) + `PXE_MOCK_SIMULATION=off next start -p 3200` (background,
  dimatikan setelah audit; port bebas). Audit Playwright read-only `.agent/runs/m1/design/audit.mjs`
  (iter3: output `design/iter3/`, + pengukuran `toasts[]` per state: boxShadow, border, radius, font).
  State toast baru dipicu dari UI: reboot & hapus host (menu baris → AlertDialog), simpan konfigurasi
  single (PATCH) & bulk (POST bulk); mutasi di-stub `page.route` di browser (server tidak dimutasi,
  14 host utuh setelah audit). Tiap toast diukur di keadaan **diam**, **hover**, **focus-visible**
  (Alt+T, Tab). Total 41 state (`m1/design/iter3/audit-results-all.json`).
- Acuan: SPEC §1–2, `review-design-iter2.md`.

## Status temuan iter2

| ID | Status | Bukti |
|---|---|---|
| DR-1-2 (major) | **closed** | `ui/sonner.tsx` `toastOptions.classNames.toast` = `shadow-none! border! border-border! rounded-xl!`. Terukur di 8 state toast (reboot, hapus, simpan single, simpan bulk × diam/hover) **boxShadow `rgba(0, 0, 0, 0) 0px 0px 0px 0px` × 5 lapisan** (offset 0, blur 0, spread 0, alpha 0); sebelumnya `rgba(0,0,0,0.1) 0px 4px 12px 0px`. Focus-visible (4 state): satu-satunya lapisan non-nol `oklab(0.652 0.168 0.131 / 0.5) 0px 0px 0px 3px` = ring spread-only (focus ring, diizinkan). Border `1px solid rgb(230, 229, 224)` (token --border), radius 12px, bg putih. Juga toast di `passwords-dialog`: 0 lapisan non-nol. `drop` = 0 di 41/41 state. Bukti: `m2/design/iter3/toast-*-{idle,hover,focus}.png`, `m3/design/iter3/toast-save-*.png` |
| I-1-5 | closed | Radius toast 12px (`--radius-xl`), sama dengan Sheet/Dialog |

## Hasil pengukuran objektif

| Cek | Hasil | Status |
|---|---|---|
| `body` background | `rgb(247, 247, 244)` di 41/41 state | OK |
| Judul halaman | 26px / 400 di 41/41 state | OK |
| Box-shadow | 0 drop shadow di semua state; hanya hairline/ring spread-only | OK |
| Oranye | `/design`: tombol primary + 2 swatch token (I-1-1). Toast focus ring oranye 50% (focus ring) | OK |
| Mono data teknis (leaf) | 0 leaf MAC/IP/hostname non-mono | OK (lihat DR-2-3 untuk teks toast) |
| Overflow 375px | `scrollWidth == 375`, 0 offender | OK |

## Temuan baru

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| DR-1-3 | minor | `dashboard/src/components/ui/sonner.tsx:9-45` | Toast tidak memakai font Inter. Terukur `font-family` `li[data-sonner-toast]` = `ui-sans-serif, system-ui, -apple-system, …` (stylesheet Sonner pada `[data-sonner-toaster]`), sedangkan `html` = `"Inter Variable", …`. Melanggar SPEC §1 Tipografi "Sans **Inter**". Terlihat di semua toast M2/M3 (`m2/design/iter3/toast-reboot-idle.png`). Ukuran 13px = caption (OK). | Tambah `font-sans` ke `classNames.toast` (atau `style={{ fontFamily: "var(--font-sans)" }}` pada Toaster). Tambahkan cek font ke `e2e/iter3-ui.spec.ts`. |

## Info (non-blocking)

- I-1-1 … I-1-4 tetap berlaku.

Ringkasan: critical 0 · major 0 · minor 1 (DR-1-3, baru) · iter2: DR-1-2 **closed**.
