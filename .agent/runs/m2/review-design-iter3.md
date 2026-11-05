# Review design M2 — iterasi 3

- Reviewer: design-reviewer · Branch `milestone/1-3-baseline` @ `76cd8ac`
- Metode: `npm run build` (exit 0) + `PXE_MOCK_SIMULATION=off next start -p 3200` (background,
  dimatikan setelah audit; port bebas). Audit Playwright read-only `.agent/runs/m1/design/audit.mjs`
  (iter3: output `design/iter3/`, + pengukuran `toasts[]` per state: boxShadow, border, radius, font).
  State toast baru dipicu dari UI: reboot & hapus host (menu baris → AlertDialog), simpan konfigurasi
  single (PATCH) & bulk (POST bulk); mutasi di-stub `page.route` di browser (server tidak dimutasi,
  14 host utuh setelah audit). Tiap toast diukur di keadaan **diam**, **hover**, **focus-visible**
  (Alt+T, Tab). Total 41 state (`m1/design/iter3/audit-results-all.json`).
- Acuan: SPEC §1, §3.1, `review-design-iter2.md`. State M2: `/hosts`, bulk bar (1440/375),
  menu baris, empty state, **baru:** toast reboot & toast hapus (diam/hover/focus).

## Status temuan

| ID | Status | Bukti |
|---|---|---|
| DR-1-2 (lintas, major) | **closed** | `toast-reboot-{idle,hover}`, `toast-delete-{idle,hover}`: boxShadow 5 lapisan `rgba(0, 0, 0, 0) 0px 0px 0px 0px`; focus: hanya ring `0 0 0 3px` spread-only. Border 1px `rgb(230,229,224)`, radius 12px. `m2/design/iter3/toast-*.png` |

## Hasil pengukuran objektif

| Cek | Hasil | Status |
|---|---|---|
| `body` bg / judul | `rgb(247,247,244)` / 26px 400 | OK |
| Box-shadow | 0 drop (termasuk toast hover) | OK |
| Oranye | Hanya "Install OS" primary bulk bar; toast tanpa oranye kecuali focus ring | OK |
| Mono (leaf/sel tabel) | 0 non-mono | OK |
| Pastel di luar pill | 0 | OK |
| Overflow 375px | 375/375 | OK |

## Temuan baru

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| DR-2-3 | minor | `dashboard/src/components/hosts/hosts-view.tsx:200,203,208,214` | Hostname/MAC di judul toast ("storage-01 di-reboot ke PXE", "storage-01 dihapus dari daftar") dirender sans (font toast), padahal SPEC §1 "Mono … untuk SEMUA data teknis: MAC, IP, hostname". Inkonsisten dengan AlertDialog konfirmasi yang sama (`hosts-view.tsx:370,376` membungkus dengan `type-data`). Bukti `toast-reboot-idle.png`, `toast-delete-idle.png`. | Toast title sebagai JSX: `<><span className="type-data">{name}</span> di-reboot ke PXE</>`. |

Lintas milestone: DR-1-3 (minor) font toast bukan Inter (`m1/review-design-iter3.md`).

## Info (non-blocking)

- I-2-1, I-2-2 tetap berlaku.

Ringkasan: critical 0 · major 0 · minor 1 (DR-2-3, baru) · DR-1-2 closed.
