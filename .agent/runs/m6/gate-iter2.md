Decision: APPROVED

# Gate M6, iterasi 2

- Gatekeeper (read-only: Read/Grep/Glob, tanpa Bash). Disimpan oleh Orchestrator dari jawaban akhir gatekeeper tanpa diubah isinya.
- Worktree `.agent/wt-m6`, branch `milestone/6-hardening`, HEAD `6e877ea`. Kode produk `18913b5`. Unit, proses, infra, mutasi, secret-scan di `fdc0abf`. Typecheck, lint, E2E run3/run4 di `0fa1f0c`. Run KVM resmi di `18913b5`.
- Batas verifikasi: tanpa `git diff`. Klaim `fdc0abf..0fa1f0c` hanya mengubah `dashboard/e2e/{helpers.ts,m5-library,m3-sheet,iter2-ui}.spec.ts` dan `18913b5..HEAD -- dashboard/src infra` kosong diambil dari empat sumber konsisten: `final-iter2/flaky-dr55-diagnosis.txt`, `test-migration.md` §Flake, `final-iter2/SUMMARY.md`, pemeriksaan independen reviewer code/security/design. Tidak ada bukti yang bertentangan.

## Tabel gate

| # | Kriteria | Hasil | Bukti (di `.agent/runs/m6/`) |
|---|---|---|---|
| 1 | Typecheck & lint bersih | **PASS** | `final-iter2/typecheck.log`, `lint.log` (EXIT=0 @fdc0abf); `typecheck-flakefix.log`, `lint-flakefix.log` exit=0 @0fa1f0c |
| 2a | Unit + integration | **PASS** | `final-iter2/unit.log`: 73/73 file, 1947/1947, exit=0 |
| 2b | Test proses | **PASS** | `final-iter2/process.log`: 15/15, exit=0 |
| 2c | Test infra | **PASS** | `final-iter2/infra-test.log`: 76 lulus, 0 gagal. Run pertama (`infra-test-relpath-invocation-error.log`, 15 gagal: `sha256sum`/`bsdtar: command not found`, exit 127 di server-up) = salah panggil (path sandbox relatif), bukan cacat produk; path absolut di HEAD sama 76/76. |
| 2d | E2E | **PASS** | `final-iter2/e2e-run3.log`, `e2e-run4.log` @0fa1f0c: masing-masing 186 passed, exit=0, `--retries=0 --workers=1`, tanpa failed/flaky/skipped/did-not-run. Run2 (183 passed, 1 failed, 2 did not run) tetap disimpan, ditangani di bawah. |
| 2e | Coverage kode baru ≥ 80% | **PASS** | `final-iter2/coverage-m6-new-code.txt`: lines 98.95%, branches 95.62%, baris berubah 99.62%, tidak ada file < 80% (terendah `startup.ts` 88.89%) |
| 2f | axe (filter tidak berubah) | **PASS** | `final-iter2/axe-summary-run3.txt`, `axe-summary-run4.txt`: kept 0 (16 + 26 audit); self-test sintetis tetap menangkap 5 |
| 3 | Setiap AC ≥ 1 test | **PASS** | `ac-trace.md`: AC-6.1–6.53 terpetakan; AC-6.54 teardown pasca-APR (plan §4). Iterasi 2: R1–R8, CR-6-1, CR-6-9, CR-6-10, SR-6-3/4/6, DR-6-4/6/7/8 ke file test nyata; nama test cocok dengan `final-iter2/mutation.txt`. |
| 4 | Tidak ada critical/major terbuka | **PASS** | `review-code-iter2.md` PASS (0/0); `review-security-iter2.md` PASS (0/0, minor 0); `review-design-iter2.md` PASS (DR-6-1 major Resolved, minor 0) |
| 5 | Bukti KVM PXE → konfigurasi → Done → SSH key | **PASS** | `kvm/results.json` (commit 18913b5, iterasi 2): core, bulk, distro PASS, harness exit 0, `dryRun false`. `kvm/core/pxe-test-m6core-node21-verify-ssh.txt`: hostname/IP/gateway/DNS/sudo OK, authorized_keys persis key yang di-inject, password ditolak, reboot kernel 8→8, tetap done. `kvm/distro/pxe-test-m6distro-node23-verify-ssh.txt` (Debian): `apt_dir=ADA trusted_rc=1 allow_file=TIDAK allow_grep_rc=1` dan verify 0 gagal setelah reboot. Cleanup ketiga run: `protectedIdentical=true`, `runDomainsRemaining=0`, `serverStopped=true`. |
| 6 | Tanpa secret plaintext | **PASS** | `final-iter2/secret-scan.txt`: `.agent/runs` 1176 file, 0 hit; hit git hanya fixture sintetis atau kutipan pola (positif palsu); private key `.agent/keys` 0 file; `kvm/{core,bulk,distro}/evidence-scan.txt` bersih; `*-admin.pass` dihapus. |
| — | Test di-skip/dilemahkan | **PASS** | `final-iter2/skip-weakening.txt`: 0 skip/only/fixme/todo; 32 file lama vs main, 0 asersi turun; `m6-smoke-fixes.test.ts` 113→110 (file baru M6) = penggantian `mediaSigned` yang dihapus dengan test fail-closed, tercatat §CR-6-10, mutasi R4a/R4c merah. |

### Penilaian perbaikan flake (run2 → run3/run4)
- Penyebab terbukti: dua `boundingBox()` terpisah selama animasi `zoom-in-95` 100 ms; repro CDP `setPlaybackRate` lama 15/15 gagal, baru 0/60; pengukuran atomik selalu rata (≤ 3e-5 px). Tidak ada cacat produk yang tertutupi.
- Tidak melemahkan: `e2e/helpers.ts:151-166` `waitForLocatorAnimations` memakai `expect.poll(...).toBe(0)` timeout 5 s (gagal bila animasi tak selesai); `m5-library.spec.ts:577-598` tetap `≤ 900` dan `flush() ≤ 1` di kedua titik; jumlah `expect(` m5-library 185, m3-sheet 73, iter2-ui 82 tetap; hanya penantian sebelum pengukuran.
- run3 + run4 memenuhi "semua E2E lulus" dan "E2E 2× penuh di commit baru": berurutan, commit test final, kode produk sama dengan KVM, 186/186 dua kali. Run1/run2 disimpan sebagai riwayat.

## Status R1–R8

| R | Status | Bukti |
|---|---|---|
| R1 DR-6-1 | Selesai | Design Resolved 8 lebar (`#5a5852`); mutasi jsdom 2 merah, E2E 4 situs merah; axe tidak diubah |
| R2 DR-6-2 | Selesai | `m6-iter2-ui.test.tsx`, `e2e/m6-ui-iter2.spec.ts:132`; mutasi A:R2, B:R2 merah |
| R3 DR-6-3 | Selesai (DEC-022 §1 opsi a) | Design Resolved; migrasi muted→body mempertahankan `not.toBe(HEX.failed)`, jumlah asersi sama |
| R4 SR-6-1/CR-6-3 | Selesai | `isLocalMedia`/`requireLocalMedia` + 422; mutasi R4a/b/c merah; KVM Debian `/etc/apt` bersih (`apt-trust.ts`, 7 test); security Closed |
| R5 SR-6-2 | Selesai | `infra/README.md:94-112`; diasersi `m6-iter2-be.test.ts`; mutasi dev M10–M12 |
| R6 CR-6-4 | Selesai | `m5-te-hooks.test.ts` `toEqual` persis 4 panggilan + 13 stub, sandbox; 66→67; mutasi R6a/R6b merah |
| R7 DR-6-5 | Selesai | Glyph per state, nama layanan 8 lebar; mutasi B:R7 merah di 8 lebar |
| R8 | Selesai | `bugs.md:279` merujuk berkas yang ada di `final/` |
| Bukti ulang | Selesai | Ketiga run KVM diulang di `18913b5` (DEC-022 §4) |

## Temuan terbuka dan disposisi (carry-over ke REPORT-final)
Tidak ada critical/major terbuka.

| ID | Severity | Disposisi |
|---|---|---|
| CR-6-2 | minor | Carry-over (DEC-022 §3); Windows tidak dilayani, laten |
| CR-6-9 | minor | Tertutup (E2E `m6-ui-iter2.spec.ts:341`, mutasi B:CR-6-9 merah) |
| CR-6-10 | minor | Tertutup (`test-migration.md` §CR-6-10) |
| CR-6-5, -7, -8, -11, -12 | info | Carry-over; laten |
| SR-6-5, SR-6-7..12, SR-6-13, SR-6-14 | info | Carry-over; tidak ada jalur bocor terbukti |
| DR-6-9..14, DR-6-15, DR-6-16, DR-6-17 | info | Carry-over (DEC-022 §3) |

## Catatan non-blocking
- Dua PNG untracked `screenshots/m6-session-expired-{db,logout}.png`: halaman login kosong, tanpa data/secret. Tidak memengaruhi gate.
- `ac-trace.md` baris 74/78/79 masih durasi KVM iterasi 1 (573/599/692 s); `kvm/results.json` iterasi 2: 570/608/713 s. Selaraskan di REPORT-m6.
- Sisa `dashboard/.e2e-data` (`run-CP6GR0`, `run-T09BA4`) gitignored; bersihkan saat teardown.

Iterasi 2 dari maksimal 3. Semua gate PASS → APR, merge ke `main` lokal, tag `m6-approved`. AC-6.54 (teardown network `pxe-test`) setelah APR.
