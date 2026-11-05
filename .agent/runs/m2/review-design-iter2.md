# Review design M2 — iterasi 2

- Reviewer: design-reviewer · Branch `milestone/1-3-baseline` @ `ed30b1e`
- Acuan: SPEC §1, §3.1, `docs/design/M2-plan.md`, `review-design-iter1.md`, `gate-iter1.md`
- Metode: sama dengan M1 iter2 (`.agent/runs/m1/design/audit.mjs`). Data
  `m2/design/iter2/audit-results.json`. Screenshot `m2/design/iter2/`.
- State M2: `/hosts` default, bulk bar (1440 & 375), menu aksi baris, **baru:** empty state
  `/hosts` (stub `GET /api/hosts` → `[]` di browser; CIDR dari `/api/network` asli).

## Status temuan iter1

| ID | Status | Bukti |
|---|---|---|
| DR-2-1 (minor) | **closed** | `bulk-action-bar.tsx`: `h-9`/`size-9`. Terukur: "Batalkan pilihan", "Set Credentials", "Set Hostname", "Set IP", "Inject SSH Key", "Install OS" = 36px (1440 & 375). `iter2/hosts-bulk-bar.png` |
| DR-2-2 (minor) | **closed** | `hosts-toolbar.tsx`: `data-[size=sm]:h-9`. Select filter OS 36px = input pencarian 36px. |

## Hasil pengukuran objektif

| Cek | Hasil | Status |
|---|---|---|
| `body` background | `rgb(247, 247, 244)` | OK |
| Box-shadow | Bulk bar, dropdown: tanpa drop shadow (hairline spread-only) | OK (toast: DR-1-2) |
| Oranye | Hanya "Install OS" primary di bulk bar | OK |
| Mono | Semua MAC/IP/hostname tabel mono; empty state: CIDR `10.10.10.0/24` (dari `/api/network`) mono, IP sidebar mono. Fallback tanpa CIDR = kata "management" (bukan data teknis) | OK |
| Empty state | Container `rounded-xl` dashed hairline, `bg-canvas-soft`, tombol "Muat ulang" outline 40px, tanpa oranye | OK |
| Pill status / pastel | Tidak berubah dari iter1; pastel hanya di `[data-status]` | OK |
| Overflow 375px | `scrollWidth == 375` | OK |

## Temuan

Tidak ada temuan baru khusus M2.

Lintas milestone: **DR-1-2 (major, terbuka)** — toast Sonner ber-drop shadow; dipakai alur M2
(`hosts-view.tsx`: reboot/hapus host). Perbaikan di `ui/sonner.tsx` (lihat `m1/review-design-iter2.md`).

## Info (non-blocking)

- I-2-1, I-2-2 iter1 tetap berlaku.

Ringkasan: critical 0 · major 0 milik M2 (+ DR-1-2 lintas milestone, terbuka) · minor 0 · iter1:
DR-2-1, DR-2-2 closed.
