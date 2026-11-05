# Review design M3 — iterasi 3

- Reviewer: design-reviewer · Branch `milestone/1-3-baseline` @ `76cd8ac`
- Metode: `npm run build` (exit 0) + `PXE_MOCK_SIMULATION=off next start -p 3200` (background,
  dimatikan setelah audit; port bebas). Audit Playwright read-only `.agent/runs/m1/design/audit.mjs`
  (iter3: output `design/iter3/`, + pengukuran `toasts[]` per state: boxShadow, border, radius, font).
  State toast baru dipicu dari UI: reboot & hapus host (menu baris → AlertDialog), simpan konfigurasi
  single (PATCH) & bulk (POST bulk); mutasi di-stub `page.route` di browser (server tidak dimutasi,
  14 host utuh setelah audit). Tiap toast diukur di keadaan **diam**, **hover**, **focus-visible**
  (Alt+T, Tab). Total 41 state (`m1/design/iter3/audit-results-all.json`).
- Acuan: SPEC §1, §3.2, `review-design-iter2.md`. State M3: Sheet single 5 tab, AlertDialog
  install (ditutup Batal), Sheet bulk Network/Hostname, error state, dialog password, 375px,
  **baru:** toast simpan konfigurasi single (Hostname storage-01 → PATCH stub) dan bulk (Hostname
  2 host → POST bulk stub), diam/hover/focus. Hit-test tambahan (`elementFromPoint`) di Sheet bulk
  Network.

## Status temuan iter2

| ID | Status | Bukti |
|---|---|---|
| DR-1-2 (lintas, major) | **closed** | `toast-save-single-*`, `toast-save-bulk-*`, `passwords-dialog`: boxShadow 5 lapisan `rgba(0, 0, 0, 0) 0px 0px 0px 0px` (diam & hover); focus: ring `0 0 0 3px` saja. `m3/design/iter3/toast-save-*.png` |
| DR-3-4 (minor) | **closed** | "Tambah" DNS `tab-network.tsx:273` `h-9` → **36px** (sheet-single/bulk/mobile-network). "Hapus DNS 10.10.10.1" & "Batalkan perubahan Network" visual 24px, `::after` inset `-8px` → hit-test terukur ≥ **37×37px** (area 40px); target klik ≥ 36px terpenuhi. Visual 24px di dalam badge diterima sebagai ikon inline. |

## Hasil pengukuran objektif

| Cek | Hasil | Status |
|---|---|---|
| `body` bg / judul | `rgb(247,247,244)` / 26px 400 | OK |
| Box-shadow | 0 drop di 19 state M3 | OK |
| Oranye | Primary footer Sheet / "Unduh CSV" saja; toast tanpa oranye (kecuali focus ring) | OK |
| Mono | 0 leaf teknis non-mono | OK |
| Radius | Tombol/input 8px; Sheet/Dialog/toast 12px; badge 9999px | OK |
| Tinggi | Tombol < 36px hanya icon-xs 24px dengan hit area 40px | OK |
| Overflow 375px | 375/375 | OK |

## Temuan baru

Tidak ada temuan baru khusus M3. Toast simpan menampilkan "Konfigurasi disimpan"/nama section —
tidak memuat data teknis.

Lintas milestone: DR-1-3 (minor) font toast `ui-sans-serif` bukan Inter — berlaku juga untuk toast
simpan/install M3 (`m1/review-design-iter3.md`).

## Info (non-blocking)

- I-3-1 … I-3-7 tetap berlaku.
- I-3-8 Toast `toast.error` (install gagal, 422, CSV) tidak dipicu di audit ini; memakai kelas
  `classNames.toast` yang sama, jadi diharapkan sama-sama tanpa shadow — belum terukur.

Ringkasan: critical 0 · major 0 · minor 0 · iter2: DR-3-4 closed, DR-1-2 closed.
