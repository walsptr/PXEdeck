Verdict: PASS

# Design review M6, iteration 2

- Reviewer: design-reviewer (read-only). Disimpan oleh Orchestrator dari jawaban akhir reviewer tanpa diubah isinya.
- Build produksi ulang (`npm run build`, exit 0); kode produk `18913b5` (`git diff 18913b5 HEAD -- dashboard/src` kosong).
- Playwright read-only terhadap `next start` port 3194 (tidak dipakai config Playwright mana pun); DB/media sementara di scratchpad; password admin acak hanya di env. Seed demo + `seedM6Iter2` (60 job, hostname 63 karakter, host Failed `compute-03`). Lebar 375, 414, 768, 800, 1024, 1279, 1280, 1440 (+1600, 1920 untuk DR-6-6). Halaman sama dengan iterasi 1 + `/jobs?job=job-iter2-failed-001` dan Sheet host Failed.
- Harness `.agent/runs/m6/design-review/iter2/` (`dr.config.ts`, `dr.spec.ts` cek objektif iterasi 1 dengan cek muted diperluas ke "sesi berakhir" dan label tahap; `dr3.spec.ts` cek target + axe; `dr4–6` investigasi). Run: `cd dashboard && NODE_PATH=$PWD/node_modules DR_TMP=<tmp> DR_SPEC='dr3?\.spec\.ts' npx playwright test -c ../.agent/runs/m6/design-review/iter2/dr.config.ts` → 19/19 lulus. Output: `results.json`, `targets.json`, `sheet-os-probe.json`, `sheet-os-axe-repro.json`, `hostname-scroll.json`, `shots/`.

## Status DR-6-1..14

| ID | Severity iter1 | Status | Bukti |
|---|---|---|---|
| DR-6-1 | major | **Resolved** | Di 8 lebar: `job-row-failure` (8 node) dan `host-failure-reason` `#5a5852`. Sheet `sheet-last-job-failure`: alasan `#5a5852`, prefix "Install terakhir gagal:" `#cf2d56` (375/768/1440). Log "Job tidak ditemukan — …" `#5a5852` (`shots/log-not-found-1440.png`). "Sesi berakhir…" tidak terlihat di browser karena handler sesi langsung redirect (`providers.tsx:32`); kelas `text-body` di `log-viewer.tsx`, diasersi unit test `m6-iter2-ui.test.tsx:81`. Tidak ada alasan gagal/not-found/sesi yang dirender `#807d72`. |
| DR-6-2 | minor | **Resolved** | Label timeline pending "Installing", "Configuring" `#5a5852`; "Booting" `#26251e`; Failed putih di pill. `shots/timeline-failed-1440.png`. |
| DR-6-3 | minor | **Resolved (DEC-022 §1)** | `/os-images` `img-available=false` dan Sheet `os-option-note`: teks + ikon info `#5a5852` di semua lebar, tidak merah. Merah hanya catatan "Windows" saat image terpilih tidak tersedia (sesuai maksud). `shots/os-unavailable-1440.png`, `shots/sheet-os-notes-1440.png`. |
| DR-6-4 | minor | **Resolved** | Input, input-group, input Sheet (`#os-disk`) fokus: border 1px solid `#f54e00` + ring 3px `ring/40`; border 3.52:1 vs field putih, 3.28:1 vs kanvas (≥ 3:1). Bacaan lebih ketat: DR-6-17. |
| DR-6-5 | minor | **Resolved** | Mock `/api/server-status`: online centang di disk `#1f8a65`, offline silang di disk `#cf2d56`, unknown tanda tanya outline `#5a5852`. Nama layanan terlihat di 8 lebar (28px, bukan `sr-only`); badge 60px di bawah `sm`, tanpa overflow di 375 (tepi kanan 359). Tetap terbedakan grayscale. |
| DR-6-6 | minor | **Resolved, sisa → DR-6-16** | Hostname 63 karakter dipotong 192px + `title`, tetap mono. Tabel 1795px → 1194px; scroll dalam tabel di 1440 **76px** (hanya LAST SEEN sebagian dan AKSI). Halaman tidak overflow. |
| DR-6-7 | minor | **Resolved** | "Di luar subnet 10.99.0.0/24": CIDR di span `[data-slot=ip-token]` JetBrains Mono `#cf2d56`, sisa kalimat Inter. Scan `nonMono` 0 hit di semua lebar dan tab Sheet. |
| DR-6-8 | minor | **Resolved** | Judul "Job tidak ditemukan" + deskripsi "Mungkin sudah dihapus oleh retensi riwayat atau host dihapus." (375/1440); tidak mengulang judul; selaras log viewer. |
| DR-6-9 | info | Open (ditunda, DEC-022 §3) | Hairline Card masih ring 1px zero-blur. |
| DR-6-10 | info | Open (ditunda) | `e2e/support/axe.ts` tidak berubah; iterasi 2 menambah asersi E2E "informasi penting tidak muted". |
| DR-6-11..14 | info | Open (ditunda) | Tidak dicek ulang. |

## Cek regresi (8 lebar, semua halaman, login, Sheet 5 tab)

| Cek | Hasil |
|---|---|
| Body `#f7f7f4` | PASS |
| Drop shadow | PASS, 0 elemen |
| Oranye hanya CTA utama dan fokus | PASS ("Masuk", "Daftarkan image", "Tambah key", Sheet "Install"; sisanya fokus). Glyph server-status hijau/merah/abu body. |
| Data teknis mono | PASS, 0 hit non-mono |
| Judul halaman | PASS, 6 judul 26px/400/−0.325px Inter `#26251e` |
| Pastel hanya status | PASS; Done putih di `#c08532` (pengecualian yang ada) |
| Kartu login | PASS |
| Overflow halaman | PASS; hanya tabel dan daftar tab Sheet di 375 scroll di container sendiri |
| Keyboard login dan logout | PASS |
| Muted pada teks penting | PASS; sisa hit hanya label/deskripsi field `/settings` dan deskripsi Credentials (penjelasan, bukan error/status) |
| axe (filter `auditA11y` tidak berubah) | 7 halaman di 375 dan 1440 + tab Hostname Sheet: 0 pelanggaran di luar filter; `final-iter2/axe-summary-run{1,2}.txt` juga 0. Pengecualian tab OS Sheet host Failed: DR-6-15. |

## Temuan baru

| ID | Severity | Lokasi / bukti | Deskripsi | Perbaikan |
|---|---|---|---|---|
| DR-6-15 | info | `iter2/sheet-os-axe-repro.json`, `tab-os.tsx:137` | Tab OS Sheet host Failed `compute-03` 1440×900: axe `color-contrast` pada deskripsi "Kosongkan untuk memilih disk terbesar…" (`#807d72` di `#fafaf7`, 3.94), filter benar mempertahankannya (4/4). Penyebab: catatan "Install terakhir gagal" mendorong konten sehingga deskripsi berada di bawah footer sticky (`#fafaf7`) dan tidak terlihat; setelah di-scroll berada di putih (pasangan muted/white terdaftar). Bukan defek visual; audit E2E proyek memakai host lain. | Opsional: `scrollIntoView` node kontras sebelum axe, atau audit Sheet dengan region di-scroll. Filter tidak diubah. |
| DR-6-16 | info | `iter2/hostname-scroll.json` | Dengan hostname 63 karakter, tabel tetap scroll 76px di 1440 (kolom HOSTNAME 216px; hostname pendek 114px tanpa scroll). Jenis scroll tabel yang sama sudah ada di ≤ 1280 sejak sebelum M6 (134px di 1280). | Terima sebagai sisa. Opsional: batasi sel ±16ch. |
| DR-6-17 | info | `iter2/targets.json` → `focus` | Bacaan ketat DR-6-4: perubahan border `#e6e5e0` → `#f54e00` hanya 2.78:1; ring 40% 1.69:1 vs putih. Memenuhi target M6, tidak memenuhi WCAG 2.4.13 (AAA). | Opsional: `ring-ring/60` atau border 2px saat fokus. |

## Jumlah severity terbuka
critical 0, major 0, minor 0, info 9 (DR-6-9..14 ditunda DEC-022 §3, DR-6-15..17 baru). Selesai iterasi ini: DR-6-1 (major), DR-6-2..8 (minor).
