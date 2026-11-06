Decision: CHANGES_REQUESTED

# Gate M6, iterasi 1

- Gatekeeper (read-only: Read/Grep/Glob). Disimpan oleh Orchestrator dari jawaban akhir gatekeeper tanpa diubah isinya.
- Worktree `.agent/wt-m6`, branch `milestone/6-hardening`, HEAD `4fabdb4`. Log final di `105727e`. Run KVM resmi di `019502a`.
- Satu-satunya alasan gate gagal: kriteria 4, temuan **major DR-6-1** terbuka. Semua kriteria objektif lain lulus berdasarkan bukti mentah.
- Batas verifikasi: tanpa Bash, `git diff 019502a 4fabdb4 -- dashboard infra` diambil dari pemeriksaan independen code reviewer (diff kosong), konsisten dengan log commit.

## Tabel gate

| # | Kriteria | Hasil | Bukti |
|---|---|---|---|
| 1 | Typecheck & lint bersih | **PASS** | `final/typecheck.log` (`EXIT=0`); `final/lint.log` (`EXIT=0`); dikonfirmasi code reviewer |
| 2a | Unit/integration | **PASS** | `final/unit.log`: 69/69 file, 1878/1878, `exit=0` |
| 2b | Test proses | **PASS** | `final/process.log`: 13/13, `exit=0` |
| 2c | Test infra | **PASS** | `final/infra-test.log`: 76 lulus, 0 gagal |
| 2d | E2E | **PASS** | `final/e2e-run1.log`, `e2e-run2.log`: masing-masing 158 passed, retries 0, workers 1; tanpa skipped/flaky/did-not-run |
| 2e | Coverage kode baru ≥ 80% | **PASS** | `final/coverage-m6-new-code.txt`: 1843/1861 = 99.03% lines, branches 95.56%, tidak ada file < 80% (terendah `startup.ts` 88.89%) |
| 3 | Setiap AC ≥ 1 test | **PASS** | `ac-trace.md`: AC-6.1–6.53 terpetakan; AC-6.54 teardown pasca-APR (plan §4) |
| 4 | Tidak ada critical/major terbuka | **FAIL** | `review-design-iter1.md`: **DR-6-1 major**. Code dan security: 0 critical / 0 major |
| 5 | Bukti KVM PXE → Done → SSH key | **PASS** | `kvm/results.json` (`019502a`): core, bulk, distro PASS, harness exit 0, `dryRun false` |
| 6 | Tanpa secret plaintext | **PASS** | `final/secret-scan.txt`: `.agent/runs` 0 hit; hit lain fixture sintetis / positif palsu scanner; password admin E2E 0 file; private key 0 file; `kvm/*/evidence-scan.txt` bersih |
| — | Test di-skip/dilemahkan | **PASS (catatan CR-6-4)** | 0 skip/only/todo/fixme/xit; asersi 33 file lama tidak turun |

**Rincian KVM:** AC-6.44 node21 UEFI Ubuntu done 573 s, `authorized_keys` persis key yang di-inject (0600), hostname/IP/gateway/DNS/sudo OK, password ditolak, reboot tanpa reinstall (kernel 8→8), tetap done. AC-6.46 BIOS node22 destroy → timeout → install ulang → done. AC-6.48 Debian node23 dan AC-6.49 Rocky node24 done, verify 0/0. AC-6.50 bulk 3× done. AC-6.47a/b/c, AC-6.51a/b PASS. Cleanup `protectedIdentical=true`, `runDomainsRemaining=0`, `serverStopped=true`.

## Wajib untuk iterasi 2

- **R1. DR-6-1 (major, DEC-017 §9).** `jobs-table.tsx:82-83` (`job-row-failure`), `hosts/columns.tsx:121-123` (`host-failure-reason`), `config-sheet.tsx:113-114` (`sheet-last-job-failure`), `log-viewer.tsx` ("Job tidak ditemukan", "Sesi berakhir") → `text-body` (atau `text-destructive`). Asersi E2E/DOM computed color ≠ `#807d72`, merah bila di-revert, mutasi dicatat. Filter axe tidak diubah.
- **R2. DR-6-2.** `job-timeline.tsx:44` label tahap belum tercapai → `text-body`; masuk asersi R1.
- **R3. DR-6-3.** Alasan "Media … tidak tersedia" (`os-images-view.tsx:106`, `tab-os.tsx:345`): (a) `text-body` + ikon info, atau (b) DEC baru. Butuh keputusan Orchestrator.
- **R4. SR-6-1 / CR-6-3 (DEC-021).** `trusted=yes` fail-closed hanya untuk media lokal server PXE; `allow_unauthenticated` dan pembersihan `00AllowUnauthenticated` mengikuti flag yang sama. Test generator. Pertimbangkan SR-6-6 (untrust sebelum firstboot).
- **R5. SR-6-2.** `infra/README.md` §Asumsi keamanan: sisa risiko DEC-021 dan catatan DEC-019 §1; asersi di `m6-te-static.test.ts`.
- **R6. CR-6-4.** `m5-te-hooks.test.ts:218-223` kembali ke `toEqual` persis yang deterministik (stub `modprobe`/`insmod`/`udevadm`/`uname`, alihkan `/sys/module`).
- **R7. DR-6-5.** `server-status.tsx` status tidak hanya dengan warna (WCAG 1.4.1), nama layanan terlihat di semua lebar, asersi E2E.
- **R8.** `bugs.md:279` merujuk `final/SUMMARY.md` yang tidak ada.

## Bukti ulang iterasi 2
- Typecheck, lint, unit+coverage, proses, infra, E2E 2× penuh di commit baru; axe, secret scan, mutasi untuk asersi R1, R2, R4, R6, R7.
- **KVM `distro` wajib ulang** (R4 mengubah `installers/debian.ts`), dengan bukti SSH `/etc/apt/` tanpa `trusted=yes`/`AllowUnauthenticated`.
- Bukti `core`/`bulk` `019502a` boleh dipakai ulang hanya bila `git diff 019502a <HEAD baru> -- dashboard infra` terbatas pada kelas CSS komponen, file test, `infra/README.md`, `installers/debian.ts`; sertakan diff. Selain itu jalankan ulang core dan bulk.

## Minor direkomendasikan (tidak menghalangi gate)
- SR-6-4 (base64 ter-wrap) — perbaiki linear atau catat sisa risiko + fixture.
- CR-6-1 (`late_command` > `MAX_ARG_STRLEN`) — batas total byte `authorized_keys` (422) + error generator + test batas.
- SR-6-3 / CR-6-6 — peringatan start production tanpa `PXE_TRUST_PROXY`, atau dokumentasi.
- DR-6-4 — ring fokus input lebih kuat.
- DR-6-6 / DR-6-7 / DR-6-8 — kosmetik, diterima bila tidak sempat.

## Diterima
- CR-6-2 (Windows CommandLine > 1024): laten, Windows tidak dilayani; carry-over.
- CR-6-5..8, SR-6-5..12, DR-6-9..14: info, tanpa dampak terbukti.

Iterasi 1 dari maksimal 3.
