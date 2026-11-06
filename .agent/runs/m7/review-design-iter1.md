Verdict: PASS

# Design review M7 "PXE lewat VLAN", iterasi 1

- Reviewer: design-reviewer (read-only). Disimpan oleh Orchestrator dari jawaban akhir reviewer; isi temuan tidak diubah.
- HEAD `56c4dec`, kode produk `339f234` (`git diff 339f234 HEAD -- dashboard/src` kosong). `npm run build` exit 0.
- Playwright read-only terhadap `next start` :3195 (`PXE_VLAN_NETWORKS="20:10.99.20.0/24:10.99.20.1;30:10.99.30.0/26:10.99.30.1"`) dan :3196 (tanpa env). Subnet PXE 10.10.10.0/24, seed demo, DB/media sementara di scratchpad, password admin acak hanya di env. Lebar 375, 414, 768, 1024, 1280, 1440.
- Harness `.agent/runs/m7/design-review/` (`dr.config.ts`, `dr-vlan.spec.ts`, `dr-novlan.spec.ts`, `dr2-vlan.spec.ts`, `dr3-vlan.spec.ts`, `probe.ts`, `util.ts`); 11/11 + 1/1 + 1/1 lulus. Output `results-vlan.json`, `results-novlan.json`, `results-vlan-unoccluded.json`, `summary-font.json`, `shots/` (58 PNG).

## Cek objektif
| Cek | Hasil |
|---|---|
| Body `#f7f7f4` | PASS di semua halaman, lebar, state Sheet, kedua server |
| Drop shadow | PASS, 0 elemen; kartu VLAN ring 1px zero-blur (pola DR-6-9) |
| Oranye hanya CTA utama dan fokus | PASS; elemen VLAN tidak menambah oranye |
| Data teknis mono | PASS untuk semua elemen VLAN baru (input, hint, deskripsi CIDR, hint tidak terdaftar, error field `ip-token`, sel tabel VLAN, empty state, MAC/IP preview bulk). Pengecualian: ringkasan "Perlu diperbaiki" (DR-7-1) |
| Tipografi judul | PASS, 6 judul termasuk "Masuk" 26px/400/−0.325px |
| Pastel hanya status | PASS |
| Overflow halaman | PASS; tabel VLAN tanpa scroll di 375; Sheet 0 di semua state VLAN |
| Login normal load (DEC-027, DR-6-11) | PASS: opacity disampling tiap frame sampai hydration (167–217 sampel/lebar) tetap 1, tombol `#f54e00`; JS tertunda 2,5 s: nonaktif, opacity 1; tanpa JS: nonaktif, opacity 1; `method=post`, `action=/login/submit` |
| Keyboard ke region scroll baru (F-T8-1) | PASS: Preview IP baru, Preview CSV credentials, Password yang dibuat terjangkau Tab, `:focus-visible` border 1px `#f54e00` (3.52:1) + ring 3px |
| Informasi penting tidak muted (DEC-017 §9) | PASS untuk M7: hint VLAN tidak terdaftar `#26251e`, error/ringkasan VLAN `#cf2d56`; "Terdaftar: …" dan empty state muted (penjelasan) |
| axe (filter tidak berubah) | PASS untuk cakupan AC-7.12: 0 di luar filter di 375/1440 pada /login, /hosts, /settings (dengan/tanpa VLAN), /jobs, /os-images, /ssh-keys; Sheet Network 5 state VLAN (elemen di tengah) 0; preview bulk VLAN 1440 0. Sisa = artefak oklusi (DR-7-5); tab Credentials di luar cakupan (DR-7-2) |

## Temuan
| ID | Severity | Lokasi / bukti | Deskripsi | Perbaikan |
|---|---|---|---|---|
| DR-7-1 | minor | `dashboard/src/components/host-config/section-errors.tsx:22`; `summary-font.json`, `shots/sheet-summary-vlan20-outside-375.png` | Ringkasan "Perlu diperbaiki" tab Network merender "Di luar subnet 10.99.20.0/24 (VLAN 20)" seluruhnya Inter (SPEC §1 mono untuk IP); error field di bawahnya sudah `IpText`. Komponen sejak sebelum M7, tetapi M7 kini mengalirkan pesan CIDR VLAN lewat jalur ini. | `<IpText text={e} />` di `SectionErrors`; asersi mono ringkasan di E2E m7-vlan. |
| DR-7-2 | minor (sejak M3) | `tab-credentials.tsx:326-331` (input file sr-only tanpa label), `:369-399` (Switch `#cred-sudo`/`#cred-nopw`); `results-vlan.json` → `bulk-cred/csv-axe-{375,1440}` | axe di tab Credentials bulk: `label` (critical) pada input file, `button-name` (critical) pada Switch. Input file sr-only bisa menerima fokus Tab tanpa nama. Tidak ada audit axe E2E untuk tab ini. | `aria-label="Pilih file CSV"` + `tabIndex={-1}` pada input file; `aria-labelledby` ke `FieldTitle` pada Switch; tambahkan tab Credentials ke audit axe Sheet. |
| DR-7-3 | minor (sejak sebelumnya) | `components/ui/checkbox.tsx`; `results-vlan.json` → `bulk-cred/pw-*/next` | Fokus keyboard checkbox: border `#cfcdc4` 1.59:1 + ring 1.2:1, di bawah target ≥ 3:1 (DR-6-4). | `focus-visible:border-ring` + `ring-ring/40`–`/50`. |
| DR-7-4 | info | `passwords-dialog.tsx:104-111` | Deskripsi "…password tidak bisa dilihat lagi — buat ulang jika hilang." muted; konsekuensi penting. | Opsional `text-body`. |
| DR-7-5 | info | `results-vlan.json` vs `results-vlan-unoccluded.json` | axe kontras 3.94 hanya saat hint di bawah footer sticky `#fafaf7`; di tengah 0. Pola DR-6-15. | Pertahankan `auditSheetUnoccluded`; filter tidak diubah. |
| DR-7-6 | info | `focus-passwords-dialog-*.png` | Sejak F-T8-1 fokus awal dialog password jatuh ke region tabel, bukan "Unduh CSV". Ring terlihat, region berlabel. | Opsional `onOpenAutoFocus` → Unduh CSV. |
| DR-7-7 | info | `bulk-vlan20-preview-focus-375.png` | Di 375 kolom "IP BARU" perlu scroll horizontal di region (392 vs 324); sudah ada sebelum M7. | Opsional sembunyikan "Saat ini" di bawah `sm`. |
| DR-7-8 | info | `tab-credentials.tsx` "2 valid · 12 tidak valid" | Hitungan validasi CSV muted; error per baris `#cf2d56`. | Opsional `text-body`. |

## Jumlah severity
critical 0, major 0, minor 3 (DR-7-1; DR-7-2, DR-7-3 sudah ada sebelumnya), info 5 (DR-7-4..8).
