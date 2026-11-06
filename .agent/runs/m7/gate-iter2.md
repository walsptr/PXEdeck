Decision: APPROVED

# Gate M7 "PXE lewat VLAN", iterasi 2 (dari maks 3)

- Gatekeeper (read-only). Disimpan oleh Orchestrator dari jawaban akhir gatekeeper; isi keputusan dan disposisi tidak diubah.
- HEAD `3474682`, kode final `5220865`. Path relatif terhadap `.agent/runs/m7/`.

## Tabel gate
| # | Gate | Hasil | Bukti |
|---|---|---|---|
| 1 | Typecheck & lint | PASS | `final-iter2/typecheck.log`, `final-iter2/lint.log` EXIT=0 @5220865 |
| 2 | Semua test lulus; coverage ≥ 80% | PASS | unit 89 file / 2154, EXIT=0; process 15/15; infra `infra-test-run{1..10}.log` 10/10 EXIT=0, 116 lulus 0 gagal (test GK-7-1 baris 117-118); E2E `e2e-run1.log:606`, `e2e-run2.log:606` 203 passed `--retries=0`; axe kept non-selftest 0; coverage baris berubah 106/106, cabang 108/108, file baru 99.35%, tidak ada < 80% |
| 3 | Setiap AC ≥ 1 test | PASS | `ac-trace.md` AC-7.1–7.31; AC-7.32 teardown pasca-APR (`docs/design/M7-plan.md:494,502`) |
| 4 | Tidak ada critical/major terbuka | PASS | review code/security/design iter2 PASS 0/0; GK-7-1 ditutup |
| 5 | Bukti KVM | PASS (pakai ulang) | `kvm/results.json`: vlancore node31 UEFI + node32 BIOS Done, SSH key ter-inject, password ditolak, reboot tanpa reinstall; vlandistro Debian + Rocky; vlanneg; vlansmoke; flat-debian; cleanup PASS semua; FAIL hanya `supersededBy`/`history` |
| 6 | Tanpa secret plaintext | PASS | `final-iter2/secret-scan.txt` (`.agent/runs/m7/**`, riwayat `78e7dc7..HEAD`, working tree, HEAD): 0 secret; hit = dokumentasi pola/fixture dummy; history leak hanya username non-rahasia, password `<REDACTED-admin-password>` (SR-7-10); `kvm-evidence-rescan.txt` exit 0, `URL_CRED` 0 di 6 skenario |
| — | Skip/pelemahan | PASS | `final-iter2/skip-weakening.txt`: 0 skip; 11 file lama tidak turun; 0 file dihapus; konfigurasi dan filter axe tidak berubah sejak `339f234`; `m6-ui-iter2.spec.ts` 76 → 76; dua kasus urlcred "lolos" → "ditandai" = aturan lebih ketat |

## GK-7-1: DITUTUP
`infra/deploy-dashboard.sh:121-132`: dry-run `ssh_server … </dev/null` tanpa pipe; non-dry dibungkus `else`, isi identik (`kvm/kvm-path-diff-iter2.txt:45-51`, `kvm/reuse-diff-final.txt:942-948`); `lib.sh` `run()`/`ssh_server` tidak berubah (`reuse-diff-final.txt:940-941`). `infra/test/m7-gk71.sh` (a) dry-run penulis lambat flat+VLAN exit 0; (b) non-dry env admin via stdin tepat 3 baris, `umask 077`, tanpa hash di argv/output. Mutasi M1 (revert `339f234`) dan M2 merah "expected '0' got '141'"; M3–M5 merah di (b). 10/10 run berurutan hijau (+3 dev, +1 code reviewer).

## "Tanpa run KVM ulang": DITERIMA
`kvm/reuse-diff-final.txt` (`d9d5308`, `6a26cc6`, `339f234` → `5220865`), diverifikasi code reviewer (`review-code-iter2.md:45-48`): daftar file terlarang kosong (`reuse-diff-final.txt:937-941`); `apply-profile.sh` 0 baris non-komentar; `login-form.tsx` identik tanpa komentar, label selector Username/Password sama (`:973-998`); `plan-table.tsx`/`passwords-dialog.tsx` hanya `scrollRegionLabel`, tidak dirujuk `e2e-kvm/m7-*` (grep gatekeeper: hanya `m6-bulk`/`m6-core`, selector `table` tidak berubah); scanner hanya memindai, dijalankan ulang 0 temuan, mutasi 6/6 merah; mutasi UI iter2 merah, E2E 2× lulus, axe bersih.

## Carry-over (REPORT-m7, tidak memblok)
| ID | Severity | Disposisi |
|---|---|---|
| DR-7-2 | minor (sejak M3; dampak axe critical) | Aksesibilitas tab Credentials — **prioritas pertama pekerjaan lanjutan**; ditunda karena tab dipakai spec KVM |
| CR-7-1 / SR-7-1 | minor | Masking `error_log` nginx; defense-in-depth; jalur KVM |
| SR-7-2 | minor | Filter nftables VLAN (dokumentasi selesai); sertakan SR-7-9 (lockd/NLM, `ct helper` TFTP) |
| DR-7-1 | minor | Ringkasan error tab Network |
| DR-7-3 | minor | Fokus checkbox |
| DR-7-9 | minor | Label region preview CSV ganda (`tab-credentials.tsx:417-418`); gabung dengan DR-7-2 |
| CR-7-7 | minor | `scanEvidence` latin1 vs `…`; false positive fail-closed; tambahkan bentuk latin1 + test Buffer |
| CR-7-8, SR-7-7 | info | False negative scanner di luar cakupan (double-encoding, `&amp;`, `;`, nilai terbelah baris) |
| SR-7-8 | info | `\|\| true` bisa fail-open bila awk error; pisahkan exit code |
| SR-7-3, -4, -6, -9, -10 | info | Diterima |
| CR-7-5, CR-7-6, DR-7-4..8, DR-7-10 | info | Diterima |
| safe-bin paralel | info | Jalankan `infra/test/run.sh` berurutan |
| AC-7.32 | — | Teardown setelah APR; lindungi `default`/`int` |

Ditutup di iter2: GK-7-1, CR-7-2/SR-7-5, CR-7-3, CR-7-4, dokumentasi SR-7-2.

Item wajib: tidak ada. Lanjut APR-m7, merge `main` lokal, tag `m7-approved`, teardown T12 (AC-7.32).
