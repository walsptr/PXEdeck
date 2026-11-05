# Gate M5 (callback status & jobs), iterasi 3 (terakhir)

> Ditulis oleh Orchestrator dari keputusan gatekeeper. Gatekeeper tidak punya tool Write. Substansi tidak diubah, hanya dipadatkan.

- Gatekeeper, 2026-11-06. Worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `a10ebf0`.
- Kode produk final: `40ef24d`.
- Test final: `909e2e7`, hanya menambah `document.fonts.ready`. Commit sesudahnya hanya berisi bukti.
- Acuan: `CLAUDE.md` §Gate approval, `gate-iter2.md`, `review-{code,security,design}-iter3.md` (termasuk tinjauan lanjutan), DEC-016, bukti di `.agent/runs/m5/`.

## Keputusan: **APPROVED**

- Keenam gate PASS.
- Semua temuan wajib iterasi 3 tertutup: DR-5-8 (dengan E2E ID panjang), CR-5-18, SR-5-12, dan SR-5-11.
- Regresi yang muncul dari perbaikan iterasi ini juga tertutup: SR-5-16, SR-5-17, CR-5-23, CR-5-24, CR-5-25, CR-5-26, DR-5-12, DR-5-13, CR-5-31.
- Ketiga reviewer melaporkan 0 critical dan 0 major pada tinjauan terakhir.
- Tidak ada test yang di-skip atau dilemahkan.
- Sisa temuan hanya minor/info, semuanya ditunda ke M6 dengan alasan tertulis.

## Tabel gate
| # | Kriteria | Hasil | Bukti |
|---|---|---|---|
| 1 | Typecheck & lint | **PASS** | `typecheck.log`, `lint.log` @ `909e2e7` exit 0; dijalankan ulang oleh code reviewer di `40ef24d` |
| 2 | Unit/integration/E2E + coverage kode baru ≥ 80% | **PASS** | unit 1266/1266 (48 file). E2E dua run penuh `PXE_E2E_MILESTONE=5`: masing-masing 90/0/0 dengan daftar test identik (tidak flaky). Run 3 m5-library 11/11. infra 47/47. Coverage kode baru lines **98.43%** (1564/1589), branches 95.95%, tidak ada file < 80%. `retries: 0` |
| 3 | Setiap AC punya ≥ 1 test | **PASS** | `ac-trace.md` 43/43 @ `909e2e7`. `mutation-iter3.txt`: setiap perbaikan merah bila di-revert, lalu dipulihkan dengan sha256 identik. `test-migration.md` iter3 hanya berisi penambahan/pengetatan. AC-5.13 tidak berubah. grep skip/only = 0. `fonts.ready` dipasang di 6 titik |
| 4 | Tidak ada critical/major terbuka | **PASS** | code (lanjutan @ `40ef24d`), security (lanjutan @ `0ed047b`; backend tidak berubah sesudahnya), design (iter3b @ `40ef24d`): masing-masing 0 critical / 0 major. DR-5-8 closed |
| 5 | Bukti KVM | **PASS** | **Run resmi** `kvm/results.json` (`20261105T164801Z` @ `543cf5a`): AC-5.38..5.43 + CR-4-12 PASS. Node11 UEFI: destroy → Failed → install ulang → Done. Node12 BIOS juga diuji. **Run konfirmasi atas kode final** `kvm-confirm/results.json` (`20261105T194821Z`, deploy @ `079d39c`, `git diff 40ef24d 079d39c -- dashboard/src infra` kosong): node12 BIOS Done dalam 394 s, 12 event seq 1..12 lewat jalur ingest yang berubah (CR-5-29). SSH dengan key yang di-inject berhasil; login password ditolak; reboot boot dari disk tanpa reinstall. Cleanup lengkap dan resource terlindungi utuh. `kvm-path-diff.txt`: jalur boot/installer/infra tidak berubah |
| 6 | Tidak ada secret/password plaintext | **PASS** | `secret-scan.txt` @ `f1271a0`: bukti, riwayat `main..HEAD` (41 commit), working tree, dan `kvm/` (85 file bersih). Semua hit terklasifikasi sebagai fixture/rujukan-diri. `kvm-confirm-redact-rerun.txt` 32 file bersih; `kvm-confirm-scan-rerun.txt` 0 temuan |

Catatan verifikasi: angka "worktree clean: N perubahan tracked" di header log berasal dari screenshot E2E di `.agent/runs/m5/screenshots/`, bukan kode produk. Mutasi baru dimulai setelah E2E run 2 selesai.

## Status temuan wajib iterasi 3
| ID | Severity | Status |
|---|---|---|
| DR-5-8 (+ E2E ID panjang) | major | **Closed**: overlap 0 di 375–1279; E2E ID 48/42 karakter lulus di kedua run dan merah saat di-revert; asersi DR-5-1 tetap; batas 520 px untuk kartu image panjang tercatat; I-5-11 tertutup |
| CR-5-18 | minor (wajib) | **Closed**: AC-5.13 tetap; mutasi 53 merah |
| SR-5-12 (a, b, c) | minor (wajib) | **Closed**: mutasi `\r` 3 merah, `\p{Cf}` 18 merah |
| SR-5-11 | minor (wajib) | **Closed**: pola linear; perf < 20 ms dan < 50 ms (pola lama 268–1072 ms); mutasi 3 merah |
| CR-5-19 (disarankan) | minor | **Closed**: mutasi 56 merah |
| Syarat bukti | — | **Terpenuhi**, ditambah run KVM konfirmasi |

### Regresi iterasi 3 yang tertutup di iterasi yang sama
| ID | Status |
|---|---|
| SR-5-16 / CR-5-24 | Closed: gabungan `plain`/`bare`, mutasi 14 merah |
| SR-5-17 / CR-5-23 | Closed: `longAbove` + adjacency, mutasi 44 merah, kalimat sisa risiko dikoreksi |
| CR-5-25 | Closed: terbaik dari 5 run, batas 50 ms tetap |
| CR-5-26 | Closed: cleanup diverifikasi lewat API dan UI |
| DR-5-9 → DR-5-12 | Closed: 958/958 di 1280; merah saat di-revert |
| DR-5-13 | Closed: 325/325 di 375; merah saat di-revert |
| I-5-15, CR-5-29, CR-5-22 | Closed |
| CR-5-31 | Closed di `909e2e7` |

## Minor/info yang diterima atau ditunda
| ID | Keputusan | Target |
|---|---|---|
| CR-5-30, SR-5-19 | Ditunda. Bukan regresi; butuh payload escape ganda yang disusun sengaja oleh pemegang token; hanya terlihat admin; sisa risiko tercatat di `test-migration.md` | M6 |
| SR-5-18, SR-5-20 | Ditunda | M6, bersama SR-5-13 |
| DR-5-14 | Ditunda (hanya keterbacaan) | M6, bersama DR-5-11 |
| CR-5-27, CR-5-28, CR-5-32…CR-5-36, I-5-13, I-5-14, I-5-16 | Diterima / opsional | M6 (opsional) |
| Celah cakupan E2E 768–1279 (mutasi `xl`→`md` tetap hijau) | Ditunda; bukan pelemahan | M6 |
| Margin DR-5-1 1 px (199/200) | Diterima; batas tidak boleh dinaikkan tanpa decision | M6 (pantau) |
| Docstring `job-events.ts:106` (klaim terlalu luas) | Ditunda; koreksi ada di `test-migration.md` | M6 |
| `kvm-confirm/results.json` tanpa entri AC-5.43 | Diterima; bukti cleanup dan scan ada di file terpisah | M6 (harness) |
| Item gate-iter2 yang tetap ditunda: CR-5-20 (a, b, c), CR-5-21/SR-5-13, SR-5-14, SR-5-15, DR-5-10, DR-5-11, I-5-6, I-5-9 | Tetap ditunda | M6 |

## Kewajiban carry-over ke M6
### Syarat gate M6
1. **SR-4-1**: login admin + rate limit.
2. **SR-5-3**: batasi log penolakan `/boot/*` (rate limit/ringkasan, atau `limit_req` nginx).
3. **SR-5-4 / DEC-016 §2**: server menolak start bila `NODE_ENV=production` dan `PXE_INSECURE_NO_LEASE_CHECK=1` tanpa konfirmasi kedua; disertai test.
4. Semua gate objektif `CLAUDE.md`, termasuk E2E penuh dan matriks KVM M6.

### Wajib di M6 (dengan test yang merah bila di-revert)
- **CR-5-30 + SR-5-19**:
  - batasi alternatif ke-4 `ANSI_RE` ke `\x1b[ -/]+[0-~]`;
  - `TOKEN_KV_RE` parsial `{8,43}` (bersama CR-5-21);
  - salinan ketiga khusus SGR/OSC 8;
  - test (a)–(d);
  - perbaiki docstring `job-events.ts:106`.
- **SR-5-18 / SR-5-20 / SR-5-13 / CR-5-21**: normalisasi encoding dengan `\p{Default_Ignorable_Code_Point}`, surrogate tunggal, dan `\p{Co}`.
- **CR-5-20 (a, b, c) + SR-5-5(c)**: sisa risiko redaksi blob/key; uji dengan fixture log installer nyata.
- **SR-5-14** (opsional), **SR-5-15** (dokumentasikan).
- Carry-over M5 iterasi 1: **CR-5-3 … CR-5-11, SR-5-6, SR-5-7, SR-5-8, SR-5-10**.
- Carry-over M4: **CR-4-6/SR-4-6** (KVM Debian 12 + Rocky 9 + bulk 3× UEFI) dan **CR-4-7/SR-4-3** (unattend Windows).

### Design/UI (M6)
- **DR-5-14, DR-5-10, DR-5-11**.
- **I-5-9**: overflow di 768.
- **I-5-6**: perlu decision bila mengejar WCAG AA.
- **E2E OS Images 768–1279**: tambahkan test agar breakpoint kartu `xl` terasersi.
- **Margin DR-5-1**: pantau.
- Opsional: I-5-13, I-5-14, I-5-16, CR-5-32, CR-5-34, CR-5-35, CR-5-36, CR-5-27.

### Infra/proses (M6)
- Harness KVM selalu menulis entri cleanup ke `results.json`, termasuk pada run parsial.
- Network `pxe-test` dan `pxe-test-nat` dihapus di akhir semua milestone.
- Resource terlindungi tetap tidak disentuh; bukti libvirt sebelum dan sesudah run tetap wajib.

## Ringkasan
Semua gate PASS. Temuan wajib dan regresi iterasi 3 tertutup dan dibuktikan dengan mutasi. Bukti KVM resmi berlaku, dan run konfirmasi atas kode final juga PASS. Tidak ada secret, dan tidak ada test yang dilemahkan. **APPROVED.** Orchestrator boleh menulis APR, merge ke `main` lokal, dan memberi tag `m5-approved`. Carry-over di atas wajib masuk plan M6.
