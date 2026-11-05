# Review design M2 — iterasi 1

- Reviewer: design-reviewer · Branch `milestone/1-3-baseline` @ `8f4b2d7`
- Acuan: SPEC §1, §3.1, `docs/design/M2-plan.md` (AC-2.8, 2.11, 2.12)
- Metode: sama dengan M1 (`.agent/runs/m1/design/audit.mjs`, server produksi port 3200,
  `PXE_MOCK_SIMULATION=off`). Data: `m2/design/audit-results.json`. Screenshot `m2/design/`.
- State M2: `/hosts` default, 2 baris terpilih → bulk action bar (1440 & 375), menu aksi baris
  terbuka.

## Hasil pengukuran objektif

| Cek | Hasil | Status |
|---|---|---|
| `body` background | `rgb(247, 247, 244)` | OK |
| Box-shadow | Bulk bar mengambang & dropdown menu: tanpa drop shadow; dropdown hanya hairline 1px spread-only | OK |
| Oranye | Hanya tombol primary "Install OS" di bulk bar (`data-variant=default`) | OK |
| Mono | Semua sel MAC, IP (lease + mgmt), hostname di tabel (38/38 di 1440, 37/37 di 375) dan input pencarian → JetBrains Mono | OK |
| Label kolom | 11px/600/uppercase/0.88px/muted (kolom ter-sort: ink — I-1-2 M1) | OK |
| Pill status | discovered `rgb(159,187,224)`, booting `rgb(223,168,143)`, installing `rgb(192,168,221)`, configuring `rgb(159,201,162)` teks ink; done `rgb(192,133,50)` teks putih; failed `rgb(207,45,86)` teks putih; offline `rgb(230,229,224)` teks muted; radius 9999px; tinggi 24px | OK |
| Pastel di luar pill | Tidak ada | OK |
| Radius | Tombol/select/input-group 8px, dropdown menu 12px, pill 9999px | OK |
| Overflow 375px | `scrollWidth == 375` (tabel scroll di dalam container) | OK |

## Temuan

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| DR-2-1 | minor | `dashboard/src/components/hosts/bulk-action-bar.tsx` | Semua tombol bulk bar (Set Credentials/Hostname/IP, Inject SSH Key, **Install OS** primary) `size="sm"` → tinggi 32px; "Batalkan pilihan" icon-sm 32px. SPEC: tombol 40px (36–40 untuk konteks padat). Bukti: `m2/design/hosts-bulk-bar.png`, `audit-results.json` → `shapes.buttons`. | Pakai tinggi ≥ 36px (mis. `h-9`) atau default 40px. |
| DR-2-2 | minor | `dashboard/src/components/hosts/hosts-toolbar.tsx` | Kontrol toolbar tabel: filter OS `SelectTrigger size="sm"` 32px dan input pencarian (`input-group`) 36px. SPEC input 44px (36–40 di tabel/dialog padat); 32px di bawah batas bawah. | Naikkan select ke ≥ 36px dan samakan dengan tinggi input pencarian. |

## Info (non-blocking)

- I-2-1 Kolom IP menggabungkan lease + mgmt (G2-5) — keduanya mono, label "mgmt statis" sans
  muted; diterima.
- I-2-2 Bulk bar mengambang di atas tabel tanpa shadow, dibedakan hairline + latar putih — sesuai
  aturan "tanpa shadow".

Ringkasan: critical 0 · major 0 · minor 2.
