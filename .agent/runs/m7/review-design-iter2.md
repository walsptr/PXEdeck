Verdict: PASS

# Design review M7 "PXE lewat VLAN", iterasi 2 (sempit)

- Reviewer: design-reviewer (read-only). Disimpan oleh Orchestrator dari jawaban akhir reviewer; temuan tidak diubah.
- Kode `5220865` (HEAD `d48ce8a`). Diff UI sejak `339f234`: `login-form.tsx` hanya pindah blok JSDoc; `plan-table.tsx:37`, `passwords-dialog.tsx:114` hanya `scrollRegionLabel`. `npm run build` exit 0.
- Harness `.agent/runs/m7/design-review/iter2/` (`dr.config.ts` :3195 dengan `PXE_VLAN_NETWORKS`, `dr-iter2.spec.ts` 8/8, `dr-iter2b.spec.ts` 1/1, `dr-iter2c.spec.ts` 1/1); hasil `results-iter2*.json`, `run*.log`, 23 PNG. DB/media sementara di scratchpad, password admin acak hanya di env.

## Verifikasi
| Cek | Hasil |
|---|---|
| Login muat normal (CR-7-3, DEC-027) | PASS: opacity per frame sampai hidrasi (375: 215 sampel, 1440: 168), min 1, background selalu `#f54e00`; `method=post action=/login/submit` |
| Login JS ditunda 2,5 s / tanpa JS | PASS: nonaktif opacity 1 sebelum hidrasi, aktif setelahnya; tanpa JS nonaktif opacity 1 |
| Login keyboard / axe | PASS: Tab username → password → toggle → Masuk, `:focus-visible` 3.52:1 + ring 3px; axe 0 di 375/1440 |
| Nama aksesibel preview bulk | PASS: AX tree dan `ariaSnapshot` `region "Area gulir preview IP baru"` → `table "Preview IP baru"`; nama ganda hilang |
| Nama aksesibel dialog password | PASS: `dialog "Password acak dibuat"` → `region "Area gulir password yang dibuat"` → `table "Password yang dibuat"` |
| Fokus region (bulk, dialog) | PASS di 375/1440: `:focus-visible` 3.52:1 + ring 3px; panah menggulir region |
| axe bulk / dialog | PASS: per elemen tanpa oklusi 0 di luar filter; sisa = artefak oklusi footer sticky (DR-7-5) dan header kolom di luar area gulir di atas overlay pada 375 (0 setelah region digulir) |
| axe /login, /hosts, /settings, /jobs, /os-images, /ssh-keys 375/1440 | PASS, 0 |
| Token objektif (body, shadow, oranye, mono, judul, pastel, overflow) | PASS, sama dengan iterasi 1 |

## Status temuan iterasi 1
| ID | Severity | Status |
|---|---|---|
| DR-7-1 | minor | Terbuka, ditunda DEC-028 |
| DR-7-2 | minor (sejak M3) | Terbuka, ditunda DEC-028 |
| DR-7-3 | minor | Terbuka, ditunda DEC-028 |
| DR-7-4 | info | Terbuka |
| DR-7-5 | info | Tetap (artefak oklusi) |
| DR-7-6 | info | Tetap; nama region kini jelas |
| DR-7-7 | info | Tetap (392 vs 324 di 375) |
| DR-7-8 | info | Tidak diuji ulang |

## Temuan baru
| ID | Severity | Lokasi | Deskripsi | Perbaikan |
|---|---|---|---|---|
| DR-7-9 | minor | `dashboard/src/components/host-config/tab-credentials.tsx:417-418` | Region preview CSV masih `aria-label` = `scrollRegionLabel` = "Preview CSV credentials" (pola CR-7-4 yang hanya diperbaiki di plan-table dan passwords-dialog); nama diumumkan dua kali; lolos axe. | `scrollRegionLabel="Area gulir preview CSV credentials"` + asersi nama di test a11y. |
| DR-7-10 | info (sejak sebelum M7) | `results-iter2-unoccluded.json` `bulk@*` | Hover baris preview (`hover:bg-canvas-soft` `#e6e5e0`) menurunkan sel muted "Saat ini" ke 3.27:1; hanya saat hover. | Opsional: hilangkan hover pada tabel non-interaktif atau `text-body`. |

## Jumlah severity
Terbuka: critical 0, major 0, minor 4 (DR-7-1..3 ditunda DEC-028, DR-7-9 baru), info 6 (DR-7-4..8, DR-7-10).
