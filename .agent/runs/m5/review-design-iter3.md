# Review design M5 (iterasi 3)

> Ditulis oleh Orchestrator dari laporan design-reviewer tanpa mengubah isinya. Reviewer tidak punya tool Write.

- **Reviewer:** design-reviewer. Worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `0c61ed8`.
- **Lingkup:** `os-images-view.tsx` dan E2E `m5-library.spec.ts`.
- **Build:** `.next` yang sudah ada; `BUILD_ID` lebih baru dari semua sumber.
- **Server:** satu `next start` di :3260 (env KVM + lease fixture), sudah dimatikan.
- **Data:** di `dashboard/.e2e-data/design-m5-iter3/`, sudah dihapus.
- **Image stres** didaftarkan lewat API, berbeda dari fixture E2E:
  - `ubuntu-24.04-custom-hwe-lab-rack07-node-image-02`: ID 48 karakter ber-hyphen, nama 64 karakter, media tidak ada, segmen path 68 karakter.
  - `rocky9customlabimagebuildnumber00000000000000001`: ID 48 karakter tanpa titik pecah, nama 59 karakter tanpa spasi, segmen path ±110 karakter.
  - `debian-12.7-bookworm-netinst-lab-cluster-b-arm`: tidak bootable.
- **Probe isolasi di 1280:** varian dicoba satu per satu, termasuk nama ber-underscore 40 karakter.
- **Bukti:** `.agent/runs/m5/design-shots-iter3/` (`geo-results.json`, `pages-results.json`, PNG, script).

## Status DR-5-8 dan DR-5-9
| ID | Status | Bukti terukur |
|---|---|---|
| DR-5-8 (major) | **closed** | Mode kartu diuji di 375, 414, 768, 1024, 1279 dengan 8 image (termasuk 3 image stres). **Overlap sel ID ↔ Dipakai ↔ Hapus = 0** di semua baris dan lebar. ID tampil utuh tanpa ellipsis, mono, dan turun baris di selnya sendiri. `scrollWidth` dokumen sama dengan viewport, kecuali 768 → 819 (I-5-9, masalah lama). Kartu bawaan 154–197 px; kartu stres 177–485 px. Ada irisan 1,4 px antara kotak tombol Hapus dan baris nama, tidak terlihat (I-5-15). Luberan hanya terjadi pada data tanpa titik pecah (DR-5-13). |
| DR-5-9 (minor) | **closed sebagian**, sisanya menjadi DR-5-12 | **1440:** tabel 1118 = kontainer 1118 dengan semua data stres; Dipakai dan Hapus berada di dalam kontainer; overlap dan luberan 0. **1280:** tabel muat untuk data bawaan, ID 48 ber-hyphen, dan segmen 120 tanpa titik pecah. Tabel meluber pada: ID 48 tanpa hyphen (973/958), nama 64 tanpa spasi (985/958), nama ber-underscore 40 karakter (983/958, Hapus terpotong 9 px), dan gabungan data stres (1037/958). |

## Kolom "Platform" dan breakpoint kartu `< xl`
- **Kelengkapan:** nama, versi, arsitektur, metode, dan status bootable tetap tampil di tabel maupun kartu (SPEC §4).
- **Keterbacaan:** arsitektur ditulis mono 13px dan metode memakai warna body. "tidak bootable" berwarna muted. Teks bootable sekarang sama di kartu dan tabel.
- **Breakpoint `< xl`:** di 768–1279 kartu selebar 446–957 px dengan tinggi wajar. Baris "repo" tersembunyi (lihat I-5-14).
- **Penilaian:** sesuai SPEC.

## Cek regresi design system
Halaman yang dicek: OS Images di 7 lebar, ditambah Hosts, SSH Keys, Settings, dan Jobs (list, live, failed, done) di 1440 dan 375.

| Cek | Hasil |
|---|---|
| bg `rgb(247,247,244)` | OK |
| Judul 26/400/−0.325 | OK |
| Drop shadow | 0, OK |
| Oranye | Hanya di CTA primary, OK |
| Pastel di luar `[data-status]` | 0, OK |
| Mono untuk data teknis | OK (2 elemen non-mono hanyalah chrome UI log) |
| Label kolom | 11px uppercase muted, OK |
| Radius card | 12px, OK |
| Overflow halaman | Sama dengan viewport (768 → I-5-9, masalah lama), OK |

DR-5-10 tidak berubah. DR-5-11 membaik: alasan sekarang dibungkus, tetapi path di dalamnya masih sans.

## Temuan baru
| ID | Severity | Halaman/elemen · bukti | Temuan | Saran |
|---|---|---|---|---|
| DR-5-12 | minor | OS Images, tabel 1280 · `os-images-1280.png`, `crop-1280-a.png`, `underscore-name-1280.png`, `iso1280.mjs` | Sisa DR-5-9. Di tabel `table-layout: auto`, `wrap-break-word` tidak mengurangi lebar min-content. Akibatnya token tanpa titik pecah membuat tabel 973–1037 px di kontainer 958. Kasus realistis: nama ber-underscore 40 karakter membuat Hapus terpotong 9 px. Data masih bisa dicapai lewat scroll. E2E tidak menangkap kasus ini. | Pakai `wrap-anywhere` pada span ID dan nama, atau `table-fixed`. Tambah varian E2E di 1280: nama ber-underscore ±40 karakter dan ID 48 tanpa hyphen. |
| DR-5-13 | minor | OS Images, mode kartu 375–1024 · `crop-375-a.png`, `geo-results.json` | Nama tanpa spasi (59 karakter) dan segmen path ±110 karakter meluber dari kartu. Kontainer tabel menjadi 841/325, sehingga seluruh daftar bisa digeser horizontal. Penyebabnya, sel kartu `basis-full` tidak punya `min-w-0`. Hanya terjadi pada data ekstrem; data tidak hilang. | Tambah `max-xl:min-w-0` pada sel Nama, Sumber, dan Ketersediaan, atau `wrap-anywhere`. |

## Info (non-blocking)
- **I-5-13:** Header "Platform" kurang pas untuk metode installer dan status bootable. Pertimbangkan "Arsitektur · Metode".
- **I-5-14:** Di 768–1279 baris "repo" ikut tersembunyi. Masih bisa diterima karena URL sudah memuat path repo.
- **I-5-15:** Irisan 1,4 px antara kotak tombol Hapus dan baris nama. Tidak terlihat.
- **I-5-9, I-5-6 (lanjutan):** tidak berubah.

## Ringkasan
critical 0 · major 0 · minor 2 (DR-5-12, DR-5-13) · info 3 baru.

DR-5-8 **closed**. DR-5-9 **closed sebagian**; sisanya menjadi DR-5-12. DR-5-10 dan DR-5-11 tetap ditunda ke M6 dan tidak memburuk.

Laporan ini bukan approval.

---

## Tinjauan lanjutan (iter3b) @ `40ef24d`

> Ditulis oleh Orchestrator dari laporan design-reviewer, isinya tidak diubah. Reviewer tidak punya tool Write.

- **Lingkup:** `128bdbe` (`os-images-view.tsx`).
- **Build:** `.next` yang sudah ada, lebih baru dari semua sumber.
- **Server:** `next start` di :3260 (env M4), sudah dimatikan.
- **Data:** data ekstrem sama dengan iter3 (`stress.mjs`, `iso1280.mjs`); ketiga image stres sudah dihapus lewat API.
- **Lebar:** 375, 414, 768, 1024, 1279, 1280, 1440.
- **Bukti:** `.agent/runs/m5/design-shots-iter3b/` (script, `geo-results.json`, `breaks-*.json`, PNG).

### Status temuan lama
| ID | Status | Bukti terukur |
|---|---|---|
| DR-5-12 | **closed** | Setiap varian ekstrem diuji terpisah: 1280 → 958/958, 1440 → 1118/1118, tanpa overflow. Gabungan data stres: 958/958 (iter3: 1037/958). Kolom Aksi berada di dalam kontainer. Overlap 0, luberan 0. |
| DR-5-13 | **closed** | Kontainer kartu: 375 → 325/325 (iter3: 841/325), 414 → 364/364, 768 → 446/446, 1024 → 702/702, 1279 → 957/957. Overlap 0, luberan 0. ID utuh dan mono. Tinggi kartu rocky-stres 446 px di 375, wajar untuk data ekstrem. |
| I-5-15 | **closed** | Jarak tombol Hapus ke sel nama minimal 0 px (tanpa irisan). Tombol 32×32 dan rata dengan baris pertama ID. |

### Keterbacaan `wrap-anywhere` (`breaks.mjs`, pembanding lewat suntikan CSS)
- **Data bawaan saja:** baris identik sebelum dan sesudah perbaikan di ketujuh lebar, 0 pecahan di tengah kata. `ubuntu-24.04` tetap 1 baris di semua lebar dan skenario. Path bawaan pecah hanya di "/".
- **ID/nama ber-hyphen atau berspasi:** tetap pecah di "-" atau spasi.
- **Token tanpa titik pecah:** dipenggal per karakter, memang tujuan perbaikan.

### Cek design system OS Images
Semua lolos di 7 lebar dengan data stres: bg, judul, drop shadow 0, oranye hanya pada CTA, pastel 0, mono 0 gagal, radius 12, overflow halaman sama dengan viewport (768 → I-5-9, masalah lama). DR-5-10 dan DR-5-11 tidak berubah, ditunda ke M6.

### Temuan baru
| ID | Severity | Halaman/elemen · bukti | Temuan | Saran |
|---|---|---|---|---|
| DR-5-14 | minor | Tabel OS Images 1280, kolom Ketersediaan · `crop-1280-ubuntu-22.04.png`, `table-under-1280.png`, `table-hyph-1280.png`, `breaks-under.json`, `breaks-hyph.json` | Efek samping `wrap-anywhere` pada span alasan. Begitu ada image ber-ID atau bernama panjang, kolom menyempit ke 153–160 px, dan alasan **bawaan** `ubuntu-22.04` dipenggal di tengah nama file (`vml|inuz`, `vmli|nuz`). `Media ubuntu-|22.04` juga terbelah. Isi tetap lengkap, hanya keterbacaannya turun. Di 1440 dan pada data bawaan saja tidak terjadi. | Kembalikan `wrap-break-word` pada span alasan, atau beri `xl:min-w-[22ch]`, atau render path dengan `PathText` (sekaligus DR-5-11). Tambahkan asersi E2E di 1280. |

### Info
- **I-5-16:** tinggi baris stres 303–399 px di 1280/1440, bisa diterima untuk data ekstrem.
- I-5-9, I-5-13, I-5-14 tidak berubah.

### Ringkasan (tinjauan lanjutan)
critical 0 · major 0 · minor 1 (DR-5-14) · info 1 (I-5-16). DR-5-12, DR-5-13, dan I-5-15 **closed**. Laporan ini bukan approval.
