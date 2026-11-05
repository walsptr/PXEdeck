# Review design M1 — iterasi 1

- Reviewer: design-reviewer · Branch `milestone/1-3-baseline` @ `8f4b2d7`
- Acuan: SPEC §1–2, `docs/design/M1-plan.md` (AC-1.2–1.5, 1.8)
- Metode: `npm run build` + `PXE_MOCK_SIMULATION=off next start -p 3200`; audit Playwright
  read-only `.agent/runs/m1/design/audit.mjs` (computed style, 1440×900 dan 375×812,
  `reducedMotion`, fokus di-blur + tunggu 500 ms sebelum ukur agar focus ring transient tidak
  terhitung). Data mentah: `m1/design/audit-results.json` (`audit-results-all.json` = semua
  state M1–M3). Screenshot: `m1/design/*.png`.
- State M1: `/hosts` default, `/design` (full page), placeholder `/os-images`, `/ssh-keys`,
  `/jobs`, `/settings`, dialog pencarian global (Ctrl+K), 375px `/hosts`, `/design`,
  `/os-images`, `/settings`.

## Hasil pengukuran objektif

| Cek | Hasil | Status |
|---|---|---|
| `body` background / warna | `rgb(247, 247, 244)` / `rgb(38, 37, 30)` di semua 24 state | OK |
| Font `html` | `"Inter Variable", …` | OK |
| Box-shadow | Tidak ada lapisan drop (offset/blur ≠ 0). Lapisan non-transparan hanya hairline spread-only `rgb(230,229,224) 0 0 0 1px` (card `/design`, dialog command) | OK |
| Oranye `rgb(245,78,0)`/`rgb(208,66,0)` | `/design`: tombol primary "Install OS" + 2 swatch warna (`bg-primary`, `bg-primary-active`, dokumentasi token). Halaman lain: tidak ada | OK (lihat I-1-1) |
| Judul halaman (top bar h1) | 26px / 400 / letter-spacing -0.325px / ink, semua halaman | OK |
| Top bar | tinggi 64px | OK |
| Label kolom tabel | 11px / 600 / uppercase / 0.88px / muted `rgb(128,125,114)` | OK (lihat I-1-2) |
| Data teknis mono | 100% leaf MAC/IP/hostname di `/hosts` (38/38), sidebar `10.10.10.1`, hex token `/design` → `"JetBrains Mono Variable"` | OK |
| Radius | Tombol 8px, input/input-group/select 8px, Card 12px, dialog command 12px, badge/pill 9999px | OK |
| Tinggi | `/design`: Button 40px (semua varian), Input 44px | OK |
| Pastel | Hanya di dalam `[data-status]` (pill) | OK |
| Overflow 375px | `scrollWidth == clientWidth == 375` di semua halaman M1 | OK (lihat DR-1-1) |

## Temuan

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| DR-1-1 | minor | `dashboard/src/app/(dashboard)/design/page.tsx` (card "Tombol", `<dl grid-cols-[auto_1fr]>`) | Di 375px, kolom deskripsi varian tombol (`dd`) melebar sampai x=403 sedangkan Card berakhir di x=351 dan `overflow:hidden` → teks "SPEC: primary variant=…", "SPEC: secondary (putih + hairline)…", dst. terpotong ±52px. Tidak ada scroll horizontal halaman, tetapi konten style guide tidak terbaca. Bukti: `m1/design/mobile-design.png`, `audit-results.json` → `mobile-design.overflow.offenders`. | Beri `min-w-0` pada `dd`/kolom `1fr` atau tumpuk tombol di atas deskripsi pada `< sm`. |

## Info (non-blocking)

- I-1-1 Swatch `primary`/`primary-active` di `/design` memakai `bg-primary` — dokumentasi token,
  bukan pemakaian UI; diterima. Test otomatis "oranye hanya CTA" perlu mengecualikan swatch ini.
- I-1-2 Header kolom yang sedang di-sort ("LAST SEEN", default sort) berwarna ink, bukan muted —
  indikator kolom aktif, diterima.
- I-1-3 Saat dialog/sheet dibuka, elemen yang menerima fokus otomatis menampilkan ring/border
  oranye (`focus-visible:border-ring ring-ring/50`). Transient focus ring — sesuai SPEC
  (`--ring` = primary). Hilang setelah blur (terverifikasi).
- I-1-4 Di 375px status server di top bar hanya berupa titik (tanpa label DHCP/TFTP/HTTP visual);
  label aksesibel tetap ada (AC-1.11). Diterima.

Ringkasan: critical 0 · major 0 · minor 1.
