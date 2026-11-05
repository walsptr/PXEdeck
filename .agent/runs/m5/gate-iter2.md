# Gate M5 (callback status & jobs), iterasi 2

> Ditulis oleh Orchestrator dari keputusan gatekeeper karena gatekeeper tidak punya tool Write. Isi substansi tidak diubah.

- Gatekeeper, 2026-11-06.
- Worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `9328f65`.
- Acuan: `CLAUDE.md` §Gate approval, `gate-iter1.md`, `review-{code,security,design}-iter2.md`, DEC-016.

## Keputusan: **CHANGES_REQUESTED**
Masih ada satu temuan major yang terbuka, **DR-5-8**, yang merupakan regresi dari perbaikan DR-5-1. Karena itu gate 4 FAIL. Temuan ini bisa diperbaiki tanpa menyentuh batas keras, jadi keputusannya bukan BLOCKED. Ini iterasi 2 dari maksimal 3, sehingga iterasi 3 adalah yang terakhir.

## Tabel gate
| # | Kriteria | Hasil | Bukti |
|---|---|---|---|
| 1 | Typecheck & lint | **PASS** | Log di `fb8077e` exit 0; dijalankan ulang di `9328f65` rc 0. Diff `fb8077e..9328f65` tidak mengubah kode |
| 2 | Unit/integration/E2E + coverage kode baru ≥ 80% | **PASS** | unit 1122/1122, e2e 86, infra 47/47; coverage kode baru 98.34% lines / 95.72% branches; semua di `fb8077e` (CR-5-12 closed) |
| 3 | Setiap AC punya ≥ 1 test | **PASS** | `ac-trace.md` 43/43; `test-migration.md` iterasi 2 hanya pengetatan; grep skip = 0; `mutation-iter2.txt` membuktikan setiap perbaikan merah bila di-revert |
| 4 | Tidak ada critical/major terbuka | **FAIL** | DR-5-8 major. Code review dan security review: 0 critical, 0 major |
| 5 | Bukti KVM | **PASS** | `kvm/results.json` (deploy `543cf5a`). `kvm-path-diff.txt`: jalur boot/infra tidak berubah, jadi bukti tetap berlaku sesuai DEC-016. Kalimat yang keliru di CR-5-22 tidak membatalkan kesimpulan |
| 6 | Tidak ada secret/password plaintext | **PASS** | `secret-scan.txt` @ `a668a88` bersih (hit hanya fixture atau rujukan-diri pemindai); verifikasi independen di `9328f65` juga bersih (SR-5-9 closed) |

Tidak ada test yang di-skip atau dilemahkan.

## Status temuan wajib iterasi 1
| ID | Status |
|---|---|
| DR-5-1 | Closed, tetapi menimbulkan regresi DR-5-8 |
| CR-5-12 | Closed |
| SR-5-9 | Closed |
| SR-5-1 | Closed untuk karakter kontrol tunggal; varian ANSI dicatat sebagai CR-5-18, varian `\r`/Cf sebagai SR-5-12 |
| SR-5-2 | Closed, dengan sisa di SR-5-12(a) dan SR-5-14 |
| CR-5-1 (+ SR-5-5 a) | Closed |
| CR-5-2 (decision) | Closed (DEC-016 §1) |
| SR-5-4 (decision) | Diterima sementara lewat DEC-016 §2; syarat gate M6 |

## Wajib ditutup di iterasi 3 (terakhir)
| ID | Severity | Syarat penutupan |
|---|---|---|
| **DR-5-8** | major | Perbaiki sel ID di `max-md` dengan wrap/break-word, truncate + `title`, atau `basis-full`. **Wajib ada E2E** dengan ID ±40–48 karakter dan path panjang di 375px dan 414px, yang mengasersikan bounding box sel ID, Dipakai, dan Hapus tidak saling tumpang-tindih. Asersi DR-5-1 tetap ada; setiap penyesuaian dicatat di `test-migration.md`. Ini juga menutup I-5-11. Design-reviewer meninjau ulang. |
| **CR-5-18** | minor (wajib) | Redaksi dijalankan atas salinan yang sekuens CSI/OSC-nya sudah dibuang, supaya ekspektasi AC-5.13 tetap sama (bila berubah, catat migrasinya). Tambah test `token=`, path, dan `$6$` yang disisipi `ESC[0m`. |
| **SR-5-12** | minor (wajib) | Normalisasi `\r` sebelum redaksi body, dan tambahkan kategori Unicode Cf ke `CONTROL_RE`/`CONTROL_KEEP_NL_RE`. Tambah test untuk kasus (a), (b), dan (c). |
| **SR-5-11** | minor (wajib) | Ganti `PKEY_BODY_LINE_RE` dengan pola linear dan tambah test performa (16 KB < 20 ms, atau batas setara dengan margin CI). Disarankan sekaligus menutup **CR-5-19**: baris kosong dan baris satu kata tidak ikut tertelan, dengan test. |

### Syarat bukti iterasi 3
- Jalankan ulang di HEAD final: typecheck, lint, unit + coverage, E2E penuh (`PXE_E2E_MILESTONE=5`), dan infra. Perbarui hash di setiap log dan di `ac-trace.md`.
- Jalankan ulang `secret-scan.sh` di HEAD final.
- Perbarui `kvm-path-diff.txt` dan perbaiki kalimat CR-5-22. Run KVM ulang **wajib** jika `installers/shell.ts`, `app/boot/**`, `boot-script.ts`, atau `infra/` berubah.
- Tulis `mutation-iter3` untuk setiap perbaikan. Setiap perubahan test dicatat di `test-migration.md`, tanpa skip atau pelemahan.
- Code reviewer dan security reviewer meninjau diff perbaikan. Design reviewer meninjau DR-5-8 dan regresi di 375, 414, dan 1440.

## Minor/info yang diterima atau ditunda
| ID | Keputusan | Target |
|---|---|---|
| CR-5-19 | Ditunda, kecuali ikut tertutup bersama SR-5-11 (disarankan) | M6 |
| CR-5-20 (a, b, c) | Diterima sebagai sisa risiko | M6, bersama SR-5-5(c) |
| CR-5-21, SR-5-13 | Ditunda | M6 (normalisasi encoding) |
| CR-5-22 | Diterima (info); redaksinya diperbaiki di iterasi 3 | — |
| SR-5-14 | Ditunda, opsional | M6 |
| SR-5-15 | Diterima (info) | Didokumentasikan di M6 |
| DR-5-9 | Ditunda; boleh dikerjakan bersama DR-5-8 | M6 |
| DR-5-10, DR-5-11 | Ditunda | M6 |
| I-5-9, I-5-10, I-5-12 | Diterima | — |
| I-5-11 | Tertutup lewat E2E DR-5-8 | Iterasi 3 |
| I-5-6 (lanjutan) | Butuh decision bila mengejar WCAG AA | M6 |
| Carry-over iterasi 1 (CR-5-3…CR-5-11, SR-5-3, SR-5-5(c), SR-5-6, SR-5-7, SR-5-8, SR-5-10) | Tetap ditunda | M6. SR-5-3 dan SR-5-4 menjadi **syarat gate M6**, bersama SR-4-1 |

Carry-over M4 ke M6 tetap berlaku: CR-4-6/SR-4-6, CR-4-7/SR-4-3, dan SR-4-1.

## Ringkasan
Gate 1, 2, 3, 5, dan 6 PASS; gate 4 FAIL karena DR-5-8. **CHANGES_REQUESTED**. Iterasi 3 adalah yang terakhir dan wajib menutup DR-5-8 (dengan E2E ID panjang), CR-5-18, SR-5-12, dan SR-5-11, lalu menyegarkan bukti di HEAD final. Jika setelah iterasi 3 masih ada critical/major terbuka, keputusannya BLOCKED.
