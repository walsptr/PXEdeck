# Review design M1 — iterasi 2

- Reviewer: design-reviewer · Branch `milestone/1-3-baseline` @ `ed30b1e`
- Acuan: SPEC §1–2, `docs/design/M1-plan.md`, `review-design-iter1.md`, `gate-iter1.md`
- Metode: `npm run build` (exit 0) + `PXE_MOCK_SIMULATION=off next start -p 3200` (dimatikan
  setelah audit). Audit Playwright read-only `.agent/runs/m1/design/audit.mjs` (diperbarui iter2:
  output ke `design/iter2/`, ukur IP sidebar, checkbox, alert, `input-group-button`, regex tipe
  key; state baru via `page.route` di browser tanpa memutasi server). Data:
  `m1/design/iter2/audit-results.json` (`audit-results-all.json` = 28 state M1–M3).
  Screenshot: `m1/design/iter2/*.png`.
- State M1: `/hosts`, `/design` (full), placeholder `/os-images` `/ssh-keys` `/jobs` `/settings`,
  dialog Ctrl+K, 375px `/hosts` `/design` `/os-images` `/settings`.

## Status temuan iter1

| ID | Status | Bukti |
|---|---|---|
| DR-1-1 (minor) | **closed** | `design/page.tsx`: `grid-cols-[auto_minmax(0,1fr)]` + `dd min-w-0 break-words`. `mobile-design.overflow.offenders = []`, `scrollWidth 375`. `iter2/mobile-design.png` |

## Hasil pengukuran objektif

| Cek | Hasil | Status |
|---|---|---|
| `body` background | `rgb(247, 247, 244)` di 28/28 state | OK |
| Judul halaman | 26px / 400 di semua state | OK |
| Box-shadow (elemen M1) | Tanpa drop shadow; hanya hairline spread-only (card `/design`). **Kecuali** toast Sonner global (DR-1-2) | 1 pelanggaran |
| Oranye | `/design`: tombol primary "Install OS" + 2 swatch token (I-1-1). Halaman lain tidak ada | OK |
| IP PXE server di sidebar | Kini dari `GET /api/network` (`pxeServer`): `10.10.10.1`, `"JetBrains Mono Variable"` 12px muted. Fallback `&nbsp;` (tanpa teks sans) | OK |
| Mono data teknis | 0 leaf MAC/IP/hostname non-mono di semua state M1 | OK |
| Radius | Tombol/input 8px, card & dialog 12px, badge 9999px | OK |
| Overflow 375px | `scrollWidth == clientWidth == 375`, 0 offender | OK |

## Temuan baru

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| DR-1-2 | major | `dashboard/src/components/ui/sonner.tsx:28-43` (Toaster global, `app/layout.tsx:19`) | Toast Sonner memakai stylesheet bawaan `[data-sonner-toast][data-styled=true]` → `box-shadow: rgba(0,0,0,0.1) 0px 4px 12px 0px` (drop shadow). Melanggar SPEC §1 baris 13 & 48 "tanpa drop shadow"; token `--shadow-*` di `globals.css:70-79` tidak berlaku karena Sonner tidak memakai utilitas Tailwind. Toast dipakai di alur M2 (`hosts-view.tsx`) dan M3 (`config-sheet.tsx`, `tab-ssh.tsx`, `tab-credentials.tsx`). Tidak terdeteksi di iter1 karena audit iter1 tidak memicu toast. Bukti: `m3/design/iter2/passwords-dialog.png` (toast kanan bawah), `audit-results-all.json` → `passwords-dialog.shadows[0]` (`li.cn-toast`, kind `drop`). | Override di `toastOptions.classNames.toast` (mis. `shadow-none! border border-border`) atau `style={{ boxShadow: "none" }}`, plus hairline 1px. Tambahkan state toast ke test design-token/e2e. |

## Info (non-blocking)

- I-1-1, I-1-2, I-1-3, I-1-4 iter1 tetap berlaku, tidak berubah.
- I-1-5 Radius toast = `var(--radius)` = 8px; panel mengambang lain (dialog/card) 12px. Pertimbangkan
  menyamakan saat memperbaiki DR-1-2.

Ringkasan: critical 0 · major 1 (DR-1-2, baru) · minor 0 · iter1: DR-1-1 closed.
