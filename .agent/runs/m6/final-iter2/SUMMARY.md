# Ringkasan gate lokal M6 iterasi 2

Disimpan oleh Orchestrator dari laporan akhir test-engineer (subagent tidak dapat menulis file ringkasan). Diuji di HEAD `fdc0abf` (kode produk `18913b5`) + E2E CR-6-9; bukti di-commit `cf4a476`.

| # | Cek | Hasil | Angka | File mentah |
|---|---|---|---|---|
| 1a | Typecheck | PASS | EXIT=0 (juga setelah test CR-6-9) | `typecheck.log`, `typecheck-with-cr69.log` |
| 1b | Lint | PASS | EXIT=0 (juga setelah test CR-6-9) | `lint.log`, `lint-with-cr69.log` |
| 2a | Unit + integration | PASS | 73/73 file, 1947/1947 | `unit.log`, `coverage-summary.txt/.json` |
| 2b | Coverage kode baru M6 (base 31c506e) | PASS | lines 2166/2189 = 98.95%, branches 95.62%, baris berubah 99.62%; tidak ada file < 80% (terendah `startup.ts` 88.89%) | `coverage-m6-new-code.txt` |
| 3a | `test:process` | PASS | 15/15 | `process.log` |
| 3b | Infra | PASS | 76/76 (run pertama salah path relatif, dilabeli) | `infra-test.log`, `infra-test-relpath-invocation-error.log` |
| 4a | E2E penuh run 1 | PASS | 186 passed, 0 failed/skipped/flaky/did-not-run | `e2e-run1.log` |
| 4b | E2E penuh run 2 | **FAIL** | 183 passed, 1 failed, 2 did not run | `e2e-run2.log` |
| 4c | axe | PASS | 0 pelanggaran di luar filter, filter tidak berubah | `axe-summary-run{1,2}.txt` |
| 5 | Secret scan | PASS | runs 1176 file, 0 hit; git: fixture sintetis + positif palsu | `secret-scan.txt` |
| 6 | Mutasi R1, R2, R4, R6, R7, CR-6-9 | PASS | unit 8/8 merah, E2E 6/6 merah, dipulihkan sha256 identik | `mutation.txt` |
| 7 | Perf | PASS | 170/170; kasus wrapped-base64 50 ms terukur 9.5–10.5 ms; ambang SR-5-11 tidak berubah | `perf-redact.log`, `perf/` |
| 8 | Skip/pelemahan | PASS | 0 skip; 32 file lama berubah, 0 asersi berkurang | `skip-weakening.txt` |
| 9 | ac-trace iterasi 2 | PASS | R1–R8, CR-6-1, SR-6-3/4/6, DR-6-4/6/7/8, CR-6-9, CR-6-10 terpetakan | `../ac-trace.md` |

## Kegagalan run 2
`e2e/m5-library.spec.ts:566` (DR-5-5/DR-5-6, footer sticky 1440×900): baris 582 `flush() ≤ 1` mendapat 1.27 px; 2 test berikutnya (serial) tidak jalan. Lulus di run 1, kedua run iterasi 1, dan 8/8 run terisolasi (`e2e-diag-m5-library-dr55.log`). Dugaan: diukur saat animasi buka dialog masih berjalan (belum dikonfirmasi). Ditindaklanjuti Orchestrator: lihat bukti E2E ulang.
