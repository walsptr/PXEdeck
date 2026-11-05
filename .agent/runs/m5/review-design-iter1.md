# Review design M5 (iterasi 1)

> Ditulis oleh Orchestrator dari laporan design-reviewer, tanpa perubahan isi; reviewer tidak punya tool Write.

- Reviewer: design-reviewer. Worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `96eb489`.
- Metode:
  - Build produksi; dua server `next start` sementara: :3260 env KVM dengan timeout booting 1 menit, :3261 dengan `PXE_INSECURE_NO_LEASE_CHECK=1`.
  - DB sementara di `dashboard/.e2e-data/design-m5/` (sudah dihapus); data dibuat lewat API nyata: discovery, install, simulasi callback/log, timeout watchdog, library key.
  - Audit Playwright read-only atas 39 state pada 1440×900 dan 375×812.
  - Kedua server sudah dimatikan.
- Bukti: `.agent/runs/m5/design-shots/*.png` (40 PNG), `audit-results.json`, dan script seed/audit. Screenshot test-engineer ditinjau tetapi tidak ditimpa.
- Acuan: SPEC §1–4, `docs/design/M5-plan.md` §2.8 dan AC-5.22–5.32, `.agent/runs/m4/review-design-iter1.md`.

## Status carry-over DR-4-*
| ID | Status | Bukti |
|---|---|---|
| DR-4-1 hostname/MAC di judul Sheet/AlertDialog | closed | `sheet-title-host` mono (`sheet-failed-host.png`, `sheet-mac-title.png`, `install-confirm.png`) |
| DR-4-2 bobot judul Sheet | closed | 16px / 600 |
| DR-4-3 toast menutupi footer Sheet | closed | Alert di Sheet, tanpa toast (`install-rejected-single.png`); isi Alert lihat DR-5-3 |
| DR-4-4 bulk gagal sebagian menutup Sheet | closed | Sheet tetap terbuka, Alert berisi ringkasan (`bulk-partial.png`) |
| DR-4-5 "tidak tersedia" merah | closed | `#807d72` + ikon info |
| DR-4-6 kontras alasan Reboot ke PXE | closed | `#5a5852` ≈ 7:1 (`row-menu-reboot.png`) |
| DR-4-7 placeholder "dibangun di tahap" | closed | halaman berisi konten nyata; sisa referensi milestone lihat DR-5-4 |

## Hasil pengukuran objektif (39 state)
| Cek | Hasil | Status |
|---|---|---|
| `body` bg | `rgb(247, 247, 244)` 39/39 | OK |
| Judul halaman | 26px / 400 / −0.325px | OK |
| Box-shadow | 0 drop shadow (hanya ring hairline dan ring fokus) | OK |
| Oranye | hanya tombol primary | OK (I-5-1) |
| Pastel | hanya di `[data-status]`, sesuai SPEC | OK |
| Mono | semua data teknis mono; satu pengecualian di DR-5-3 | OK* |
| Label kolom tabel | 11px / 600 / uppercase / 0.88px / muted | OK |
| Radius & tinggi | tombol 8px/40px; input 44px/8px; Card/dialog 12px | OK |
| Overflow 375px | `scrollWidth` 375 di semua halaman | OK (DR-5-1) |

## Temuan
| ID | Severity | Halaman/elemen · bukti | Temuan | Saran |
|---|---|---|---|---|
| DR-5-1 | **major** | OS Images, kolom Sumber, 375px · `os-images-view.tsx:60,74` · `mobile-os-images.png`, `mobile-os-images-scrolled.png`, `os-images.png` | `wrap-anywhere` memampatkan kolom Sumber menjadi 94px. Path pecah 2–3 karakter per baris, tinggi tiap baris 751px, halaman 4.032px untuk 5 image; data inti praktis tidak terbaca di mobile. Di 1440px path juga terpotong di tengah kata. | Beri kolom `min-w-56`/`min-w-64` dan pakai `wrap-break-word`, atau pecah di `/`. Layout kartu di bawah `md`. Tambah cek E2E untuk tinggi baris di 375px. |
| DR-5-2 | minor | SSH Keys, tabel desktop · `ssh-keys.png`, `ssh-keys-1280.png` | Di 1440 tabel 1248px dalam container 1118px; kolom "Dipakai" dan tombol Hapus tersembunyi tanpa petunjuk. | Truncate Nama, izinkan fingerprint wrap, sembunyikan Komentar/Tipe di bawah `xl`, atau buat kolom aksi sticky. |
| DR-5-3 | minor | Sheet, Alert `install-errors` · `config-sheet.tsx:445-447`, `install-service.ts:42-52` | Label host muncul dua kali, dan salinan kedua tidak mono. | Pisahkan `reason` dari `message`, atau buang prefix di UI; tambah asersi di test. |
| DR-5-4 | minor | Copy OS Images dan kartu OS di Sheet · `os-images.ts:116`, `install-service.ts:50` | Teks UI masih menyebut "di M4" dan "generator M4". | Kalimat netral; perluas cek statis ke pola `\bM[0-9]\b` dan `tahap [0-9]`. |
| DR-5-5 | minor | Dialog Daftarkan OS image · `os-register-errors.png` | Pesan zod mentah berbahasa Inggris; hint dan error ID tampil duplikat. | Petakan ke pesan Indonesia; sembunyikan hint saat field invalid. |
| DR-5-6 | minor | Footer dialog Daftarkan OS image · `register-image-dialog.tsx:124` | Dialog setinggi 868px; tombol submit tidak terlihat tanpa scroll di 1440×900. | Footer sticky, atau form dua kolom. |
| DR-5-7 | minor | Jobs, baris terpilih · `jobs-history-done.png` | Background `#efeee8` membuat caption muted hanya mencapai kontras 3.55:1. | Pakai `canvas-soft #fafaf7` + indikator kiri, atau caption `text-body`. |

## Info (non-blocking)
- **I-5-1:** Dua tombol oranye di OS Images wajar; saat dialog terbuka hanya satu CTA yang aktif.
- **I-5-2:** Di tampilan Riwayat, baris job sulit dibedakan; tambahkan waktu absolut atau nomor urut.
- **I-5-3:** Judul dialog hapus key kosong selama animasi tutup.
- **I-5-4:** Di Sheet 375px, tab "SSH Keys" terpotong (kemungkinan sudah ada sejak M3).
- **I-5-5:** Alasan Failed di kolom Status yang sempit wrap menjadi 3 baris.
- **I-5-6:** Token SPEC `muted` hanya 4.12:1 di atas putih dan 3.84:1 di atas kanvas; sistemik dari SPEC, perlu decision bila ingin memenuhi WCAG AA.
- **I-5-7:** Peringatan insecure lease sudah sesuai.
- **I-5-8:** Kolom OS di daftar Jobs terpotong; tambahkan `title`.

## Ringkasan
critical 0 · **major 1** (DR-5-1) · minor 6 (DR-5-2 … DR-5-7) · info 8. Carry-over DR-4-1 … DR-4-7: semuanya closed.
