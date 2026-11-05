# Gate M5 (callback status & jobs), iterasi 1

> Ditulis oleh Orchestrator dari keputusan gatekeeper; gatekeeper tidak punya tool Write. Isi substansi tidak diubah.

- Gatekeeper, 2026-11-06.
- Worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `96eb489`.
- Acuan: `CLAUDE.md` §Gate approval, `docs/design/M5-plan.md` (AC-5.1..AC-5.43), DEC-013/014/015, `.agent/runs/m4/gate-iter1.md`.

## Keputusan: **CHANGES_REQUESTED**
Ada satu temuan **major** yang masih terbuka, DR-5-1, sehingga gate 4 FAIL. Temuan ini bisa diperbaiki tanpa melanggar batas keras, jadi bukan BLOCKED. Ini iterasi 1 dari maksimal 3.

## Tabel gate
| # | Kriteria | Hasil | Bukti |
|---|---|---|---|
| 1 | Typecheck & lint | **PASS** | `typecheck.log` dan `lint.log` exit 0; dijalankan ulang di HEAD `96eb489` oleh Orchestrator dan code-reviewer: rc 0 |
| 2 | Unit/integration/E2E + coverage kode baru ≥ 80% | **PASS dengan syarat (bukti basi)** | `unit.log` 1078/1078, `e2e.log` 82, `infra-test.log` 47/47, coverage kode baru lines 98.24%. Semuanya dari `ae3b7c1`; di HEAD terverifikasi 1080/1080 dan E2E 82/82, tetapi log di HEAD belum disimpan (CR-5-12) |
| 3 | Setiap AC punya ≥ 1 test | **PASS** | `ac-trace.md` 43/43; `test-migration.md` #1–#17 tanpa pelemahan; grep skip/only = 0 |
| 4 | Tidak ada critical/major terbuka | **FAIL** | DR-5-1 major (`review-design-iter1.md`). Code review dan security review: 0 critical, 0 major |
| 5 | Bukti KVM | **PASS** | `kvm/results.json` AC-5.38..5.43 + CR-4-12 PASS; `kvm-run.txt` exit 0; Playwright KVM 4/4; verify-ssh untuk node11 dan node12; destroy → Failed → install ulang → Done; cleanup OK. Deploy dari `543cf5a`; perubahan sesudahnya hanya `imageUsage` (CR-5-13) |
| 6 | Tidak ada secret/password plaintext | **PASS dengan syarat (bukti basi)** | `secret-scan.txt` @ `fcc6a4e` bersih; scan independen SR-5-9 bersih; perlu dijalankan ulang di HEAD. Celah redaksi SR-5-1, SR-5-2, CR-5-1 menyangkut kriteria ini |

## Wajib ditutup sebelum gate iterasi 2
| ID | Alasan |
|---|---|
| **DR-5-1** (major) | Layout kolom Sumber OS Images. Tambah E2E yang membatasi tinggi baris dan tinggi halaman di 375px, lalu design-reviewer meninjau ulang |
| **CR-5-12** | Jalankan ulang typecheck, lint, coverage (`coverage-m5-new-code.txt`), E2E penuh, dan infra di HEAD final; perbarui log, hash, dan `ac-trace.md` |
| **SR-5-9** | Jalankan ulang `secret-scan.sh` di HEAD final |
| **SR-5-1** | Urutan sanitasi/redaksi; tambah unit test dengan karakter kontrol di dalam token/hash |
| **SR-5-2** | Redaksi private key multi-baris; tambah test multi-baris |
| **CR-5-1** (+ SR-5-5 a) | Disarankan opsi (a): redaksi token parsial `/boot/<mac>/[A-Za-z0-9_-]{8,43}` dan `$6$…` di server, dengan test token terpotong. Opsi (b), yang mengubah `shell.ts`, mewajibkan run KVM ulang |

Semua test yang ada tetap lulus tanpa skip atau pelemahan, dan setiap perubahan test dicatat di `test-migration.md`. Ketiga reviewer menulis `review-*-iter2.md`; code dan security cukup meninjau diff perbaikan.

## Minor/info yang diterima atau ditunda
| ID | Keputusan | Target |
|---|---|---|
| CR-5-2 | Tunda; wajib dibuat decision | M6 (decision di iter2 bila sempat) |
| CR-5-3 … CR-5-9, CR-5-11 | Tunda | M6 |
| CR-5-10 | Tunda | M6, sebelum matriks KVM Debian/Rocky/bulk |
| CR-5-13 … CR-5-17 | Diterima (info) | — |
| SR-5-3 | Tunda | **M6, wajib bersama rate limit/login** |
| SR-5-4 | Tunda; wajib decision | M6 |
| SR-5-5 (b, c), SR-5-6, SR-5-7, SR-5-8, SR-5-10 | Tunda | M6 (SR-5-6 masuk cek allowlist KVM; SR-5-10 masuk uji infra start-fail) |
| DR-5-2 … DR-5-7 | Tunda (boleh dikerjakan bersama DR-5-1); DR-5-4 dan DR-5-7 disarankan sekalian | M6 |
| I-5-1 … I-5-8 | Diterima | — (I-5-6 butuh decision bila mengejar WCAG AA) |

## Status carry-over M4
| Kewajiban | Status |
|---|---|
| (1) CR-4-1 + KVM destroy → Failed → install ulang | Closed (AC-5.7/5.10, AC-5.39/5.40) |
| (2) SR-4-2 | Closed (AC-5.2); sisa risiko di SR-5-4 dan SR-5-10 |
| (3) Amandemen CR-4-2/4-3/4-21 | Closed (`M4-plan.md` §7, DEC-013) |
| (4) CR-4-4 | Closed (AC-5.20) |
| (5) CR-4-11, CR-4-12 | Closed |
| (6) CR-4-5, CR-4-8/SR-4-4, CR-4-9, CR-4-10, CR-4-13, CR-4-14, CR-4-15/SR-4-9 | Closed |
| (7) DR-4-1..DR-4-7 | Closed |
| SR-4-1 mitigasi M5 | Terpenuhi; login + rate limit tetap blocker gate M6 |

Carry-over M6 yang tetap berlaku: CR-4-6/SR-4-6 (KVM Debian 12 + Rocky 9 + bulk), CR-4-7/SR-4-3 (unattend Windows), dan SR-4-1 (auth).

## Ringkasan
Gate 1, 3, dan 5 PASS. Gate 2 dan 6 PASS secara substansi, tetapi buktinya basi. Gate 4 FAIL. **CHANGES_REQUESTED**. Iterasi 2 wajib menutup DR-5-1, CR-5-12, SR-5-9, SR-5-1, SR-5-2, dan CR-5-1.
