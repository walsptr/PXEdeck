# Review design M5 (iterasi 2)

> Ditulis oleh Orchestrator dari laporan design-reviewer, tanpa perubahan isi. Reviewer tidak punya tool Write.

- Reviewer: design-reviewer. Worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `9328f65`.
- Perbaikan yang ditinjau: `a4874a4`, `09b7ee1`, `df765aa`, `d82937b`, `a84df63`, `c21c572`, dan DR-5-4 di `127758c`.
- Metode:
  - Build produksi baru; dua server `next start` sementara: :3260 env KVM dengan `PXE_JOB_BOOTING_TIMEOUT_MIN=1`, dan :3261 dengan `PXE_INSECURE_NO_LEASE_CHECK=1`.
  - DB sementara `dashboard/.e2e-data/design-m5-iter2/`, data dibuat lewat API nyata.
  - Dua image uji stres: `ubuntu-24.04-custom-hwe-lab` (ID 27 karakter, segmen path 57) dan `rocky-9-singlesegment` (segmen tunggal > 80 karakter), keduanya masih dalam batas validasi API.
  - Audit Playwright read-only atas 30 state di 1440×900, 1280×800, 375×812, ditambah probe di 1024, 900, 800, 768, 414.
  - Server sudah dimatikan dan data sementara dihapus.
- Bukti: `.agent/runs/m5/design-shots-iter2/` (PNG, `audit-results.json`, `probe-results.json`, script).

## Status DR-5-1 … DR-5-7
| ID | Status | Bukti terukur |
|---|---|---|
| DR-5-1 (major) | **closed** (ada temuan turunan DR-5-8) | **375×812:** kartu `display:flex`; tinggi kartu built-in 155/155/196/155/198 px (semua ≤ 200), image stres 308/342 px; halaman 1.754 px untuk 7 image (iter1: 4.032 px untuk 5); `scrollWidth` 375; kontainer tabel 325 = 325; path built-in muat 1 baris. **1440×900:** baris 120–146 px; path hanya pecah di "/"; semua mono; segmen yang lebih lebar dari kolom dipenggal di dalam segmen. |
| DR-5-2 | **closed** (desktop) | 1440: tabel 1118 = kontainer; 1280: 958 = 958; 1024: kolom Tipe disembunyikan. Nama di-truncate + `title`; fingerprint wrap mono. Mobile: lihat DR-5-10. |
| DR-5-3 | **closed** | Label host muncul sekali, mono, baik untuk install tunggal maupun bulk. |
| DR-5-4 | **closed** | 30 state: 0 hit `\bM[0-9]\b`, `tahap [0-9]`, `generator M`. |
| DR-5-5 | **closed** (catatan di I-5-10) | Pesan validasi berbahasa Indonesia; hint ID disembunyikan saat invalid. |
| DR-5-6 | **closed** | Footer sticky; tombol tetap dalam viewport di 1440×900 dan 375×812 (form kosong, error, invalid). |
| DR-5-7 | **closed** | Latar canvas-soft + border kiri ink; caption `rgb(90,88,82)` ≈ 6,9:1. |

## Cek regresi design system (30 state)
| Cek | Hasil | Status |
|---|---|---|
| `body` bg | `rgb(247, 247, 244)` 30/30 | OK |
| Judul halaman | 26px / 400 / −0.325px | OK |
| Box-shadow | 0 drop shadow (hanya ring hairline, ring invalid, ring fokus) | OK |
| Oranye | hanya tombol primary | OK |
| Pastel | hanya di `[data-status]` | OK |
| Mono data teknis | 793 elemen, 100% mono; pengecualian DR-5-11 | OK* |
| Label kolom | 11px / 600 / uppercase / 0.88px / muted | OK |
| Radius & tinggi | sesuai token | OK |
| Overflow halaman 375px | `scrollWidth` 375 di semua state | OK (overflow di dalam komponen: DR-5-8, DR-5-10) |

## Temuan baru
| ID | Severity | Halaman/elemen · bukti | Temuan | Saran |
|---|---|---|---|---|
| DR-5-8 | **major** | OS Images, kartu mobile baris 1 (ID · Dipakai · Hapus) · sel ID di `os-images-view.tsx`: `whitespace-nowrap` + `max-md:min-w-0 max-md:flex-1` · `mobile-os-images.png`, `p4.mjs` | Regresi dari perbaikan DR-5-1. Sel ID menyusut, tetapi teks tetap nowrap sehingga meluber dan menimpa "Dipakai 0 host": overlap 11 px untuk ID 21 karakter, 59 px untuk ID 27 karakter (375 px), 20 px di 414 px. API mengizinkan ID sampai 48 karakter, jadi ID dan jumlah pemakai bisa tidak terbaca. E2E hanya memakai ID pendek, jadi tidak menangkap ini. | Di `max-md`: lepas `nowrap` dan pakai `wrap-break-word`, atau `truncate` + `title`, atau taruh ID di `basis-full`. Tambah fixture E2E dengan ID ±40 karakter dan path panjang, lalu cek tidak ada overlap antar sel. |
| DR-5-9 | minor | OS Images, tabel desktop · `os-images.png`, `p3.mjs` | Dengan ID/nama panjang, tabel 1331 px di dalam kontainer 1118 px (1440): kolom Bootable, Dipakai, dan Hapus tersembunyi tanpa petunjuk; di 1280 kolom Ketersediaan ikut tersembunyi. | Batasi kolom ID/Nama dengan `max-w` + truncate + `title`, atau buat kolom aksi sticky; tambah data uji panjang di E2E 1440/1280. |
| DR-5-10 | minor | SSH Keys 375×812 · `mobile-ssh-keys.png` | Tabel 584 px di kontainer 325 px: fingerprint terpotong; kolom Dibuat, Dipakai, dan Hapus tidak terlihat tanpa petunjuk. | Pola kartu seperti DR-5-1, atau sembunyikan kolom sekunder + kolom aksi sticky. |
| DR-5-11 | minor | Kolom Ketersediaan OS Images dan kartu OS di Sheet · `os-images.png`, `bulk-partial.png` | Path di dalam kalimat alasan memakai font sans; sel setinggi 151–170 px dan meluber 5 px. | Render path dengan `type-data`/`PathText`, atau tampilkan path sekali saja di kolom Sumber. |

## Info (non-blocking)
- **I-5-9:** Klaster kanan top-bar membuat `scrollWidth` 819 px pada viewport 768–818 px. Sudah ada sebelum M5 dan di luar matriks 375/1440.
- **I-5-10:** Untuk DR-5-5 masih ada tiga hal kecil: prefix "Id:" berlebih, hint grup path tetap tampil di samping error, dan pratinjau URL ikut menampilkan path yang invalid.
- **I-5-11:** E2E DR-5-1/DR-5-2 hanya memakai data built-in yang pendek; tambah kasus ID/nama/path panjang.
- **I-5-12:** Fallback pemenggalan di dalam segmen bekerja tanpa overflow. Diterima.
- **I-5-6 (lanjutan):** Kontras token SPEC (muted 4,12/3,84:1, muted-soft 2,74:1, putih di atas oranye 3,52:1) masih butuh decision bila target WCAG AA.

## Ringkasan
critical 0 · **major 1** (DR-5-8) · minor 3 (DR-5-9, DR-5-10, DR-5-11) · info 5. Status lama: DR-5-1 … DR-5-7 closed. Laporan ini bukan approval.
