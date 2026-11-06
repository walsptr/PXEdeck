Decision: CHANGES_REQUESTED

# Gate M7 "PXE lewat VLAN", iterasi 1 (dari maks 3)

- Gatekeeper (read-only). Disimpan oleh Orchestrator dari jawaban akhir gatekeeper; isi keputusan dan disposisi tidak diubah.
- HEAD `f5f0441`, kode produk `339f234`, fix test E2E `9f64843`.

## Tabel gate
| # | Gate | Hasil | Bukti |
|---|---|---|---|
| 1 | Typecheck & lint | PASS | `final/typecheck.log`, `final/lint.log` EXIT=0 @9f64843 |
| 2 | Semua test lulus; coverage kode baru ≥ 80% | **FAIL** | Lulus: `unit.log` 2123/2123; `test-process.log` 15/15; `e2e-run1/2.log` 203 masing-masing; `coverage-m7-new-code.txt` 106/106 baris, 108/108 branch, file baru 99.35%. Gagal: `infra/test/run.sh` hijau 8/10 (`infra-test-run4.log:91-92,131-133`, `infra-test-run8.log:68,117-119`, exit 141 stage=deploy); diagnosis `flaky-ac717.txt` |
| 3 | Setiap AC ≥ 1 test | PASS | `ac-trace.md` AC-7.1–7.31 ke file test yang ada + `kvm/results.json`; AC-7.32 pasca-APR |
| 4 | Tidak ada critical/major terbuka (review) | PASS | code 0/0 (4 minor, 2 info); security 0/0 (2 minor, 4 info); design 0/0 (3 minor, 5 info). Major gatekeeper GK-7-1 masuk gate 2 |
| 5 | Bukti KVM | PASS | `kvm/results.json`: vlancore (`d9d5308`) node31 UEFI 668 dtk + node32 BIOS 487 dtk Done, `…-node31-verify.txt` key ter-inject, authorized_keys 1 baris, password ditolak, VLAN 20 di parent, parent tanpa IPv4, root dari disk, `capture-trunk0-install.txt` DISCOVER `vlan 10`; vlandistro (`6a26cc6`) Debian node33 + Rocky node34 PASS; vlanneg, vlansmoke (run1+run4), flat-debian PASS; cleanup PASS semua (`protectedIdentical`, `switchStopped`, `relayClean`) |
| 6 | Tanpa secret plaintext | PASS | `final/secret-scan.txt` 0; `AC-7.30-scan` PASS tiap run; history leak teredaksi |
| — | Skip/pelemahan | PASS | `final/skip-weakening.txt`; `9f64843` asersi sama (`test-migration.md:113-139`) |

## Pemakaian ulang bukti `d9d5308` (DEC-027 §4): DITERIMA
`kvm/reuse-diff-d9d5308.txt` (`d9d5308..68ee54c`) hanya: form login + route fallback, map access log nginx flat/VLAN, `redact-evidence.sh` (scan lebih ketat), test. `6a26cc6..68ee54c` hanya pola scan + test. Diff berhenti di `68ee54c` (kode final `339f234` = commit bukti/test; dikonfirmasi `review-code-iter1.md:19`) — perbarui di iterasi 2.

## Wajib iterasi 2
**GK-7-1 (major, gate 2):** `infra/deploy-dashboard.sh:121-125` `{ printf … } | ssh_server "umask 077 && cat > …/admin.env"`; di dry-run `ssh_server`/`run` tidak membaca stdin → SIGPIPE → exit 141 dengan `pipefail` (±1 dari 5 run suite). Perbaikan: jalur dry-run tidak mem-pipe ke konsumen yang tidak membaca stdin (mis. `is_dry` → `</dev/null`, atau `run()` dry-run menguras stdin); jalur non-dry identik. Test regresi merah bila di-revert (penulis lambat menuntut exit 0); mutasi di `.agent/runs/m7/mutation-iter2.txt`.

## Carry-over (dicatat di REPORT-m7, tidak memblok)
| ID | Severity | Disposisi |
|---|---|---|
| CR-7-1 / SR-7-1 | minor | `error_log` nginx; defense-in-depth. Bila diperbaiki di iter2 → perubahan nginx (jalur KVM) → run ulang KVM |
| SR-7-2 | minor | rpcbind/mountd/statd wildcard dari VLAN; lab; backlog hardening; minimal koreksi komentar/README. nftables = jalur KVM → run ulang |
| CR-7-2 / SR-7-5 | minor/info | Pengecualian placeholder scan longgar; boleh di iter2 bila scanner dijalankan ulang atas `.agent/runs/m7/**` |
| CR-7-3, CR-7-4 | minor | Kosmetik/a11y ringan; opsional |
| DR-7-1 | minor | Disarankan iter2 (UI) |
| DR-7-2 | minor (sejak M3) | Wajib dicatat; disarankan diperbaiki bersama audit axe tab Credentials |
| DR-7-3 | minor | Carry-over |
| CR-7-5, CR-7-6, SR-7-3, SR-7-4, SR-7-6, DR-7-4..8 | info | Diterima |
| safe-bin paralel (flaky-ac717) | info | Jalankan `run.sh` berurutan |

## Bukti ulang iterasi 2 (`.agent/runs/m7/final-iter2/`)
1. `infra/test/run.sh` 10× berurutan, 10/10 EXIT=0, termasuk test regresi SIGPIPE + mutasi.
2. Typecheck, lint, vitest + coverage, `test:process`. Bila `dashboard/` tidak berubah cukup diff `339f234..<final> -- dashboard` kosong; bila berubah: semua + E2E penuh 2×, axe, `skip-weakening.txt`.
3. `secret-scan.txt` ulang atas `.agent/runs/m7/**` + riwayat git.
4. Diff pemakaian ulang diperbarui `d9d5308..<final>` dan `6a26cc6..<final>` (stat + isi file non-test) → `kvm/reuse-diff-final.txt`/`kvm-path-diff.txt`.
5. KVM ulang ditentukan diff: tanpa run ulang bila hanya cabang `is_dry` + UI di luar komponen yang dipakai spec `e2e-kvm/m7-*` + test/dok (dengan bukti diff non-dry identik dan test shell bahwa jalur non-dry tetap mengirim env admin lewat stdin; tanpa perubahan `lib.sh run()` non-dry, `ssh_server`, nginx, profil server/switch, relay, generator, validasi, boot/iPXE). `vlancore` + `flat-debian` bila jalur deploy non-dry/`lib.sh`/`ssh_server` berubah. `vlancore` + `vlandistro` + `vlanneg` (+ `flat-debian` bila flat berubah) bila nginx, profil server/nftables, generator/validasi, atau komponen yang disentuh spec KVM berubah.
6. `ac-trace.md` ke commit final; review iter2 (code, security; design bila UI berubah) atas `339f234..<final>`.

Iterasi tersisa 2 (maks 3); iter3 gagal → BLOCKED.
