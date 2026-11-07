Decision: CHANGES_REQUESTED

# Gate M8 (installer produksi), iterasi 2 dari 3

- Gatekeeper (read-only). Disimpan oleh Orchestrator dari jawaban akhir gatekeeper; keputusan, item wajib, dan disposisi tidak diubah.
- Kode produk `06517b9`.

## Alasan
Tidak ada log lint/typecheck untuk kode saat ini: `lint-dev.txt` dan `tsc-dev.txt` lebih tua dari perubahan terakhir `dashboard/e2e-kvm/m8-vlan.spec.ts` dan `m8-installer.spec.ts` (dicakup `tsconfig.json` dan `eslint.config.mjs`). Gate lain PASS berdasarkan bukti; produk tidak perlu diubah, hanya bukti diulang.

## Tabel gate
| # | Gate | Hasil | Bukti |
|---|---|---|---|
| 1 | Typecheck & lint | **FAIL (tanpa bukti untuk kode saat ini)** | `lint-dev.txt`, `tsc-dev.txt` bersih tetapi lebih tua dari spec e2e-kvm m8; shell `bash -n` lulus (kedua review); shellcheck tidak terpasang |
| 2 | Semua test lulus; coverage ≥ 80% | PASS (catatan) | `infra-test-dev-iter3.txt` 169/0; mutasi `mutation-dev-iter2.txt` 28/28, `mutation-dev-iter3.txt` 11/11; KVM Playwright `kvm/iter3/playwright-kvm.log` 3 lulus. Kode baru bash (tanpa alat line-coverage): proxy = test regresi per perbaikan + mutasi + KVM, seperti M6/M7. Catatan A: dashboard M7 berlaku bila `dashboard/src` tidak berubah. Catatan B: `infra/test/m8-kvm/*` berubah setelah run `run.sh` terakhir. |
| 3 | Setiap AC ≥ 1 test | PASS | DEC-029 §2/§3 `infra-test-dev-iter3.txt:118-147,132-134,146,154`; §4 `kvm/iter3/results.json`; DEC-030 §1 :148-155, §2 :156-165 (+CR-8-10 `mutation-dev-iter2.txt:25`, CR-8-14 kriteria DB harness), §3 :166, §4 gate 5; tanpa skip/fixme; tidak ada test dilemahkan (`review-code-iter2.md`) |
| 4 | Tidak ada critical/major | PASS | code iter2 0/0 (CR-8-1..17 selesai, 8 minor baru); security iter2 0/0 (SR-8-1 closed, 1 minor + 2 info); tanpa perubahan UI |
| 5 | Bukti KVM | PASS | `kvm/results.json`, `kvm/iter3/results.json` @`06517b9`: VM bersih → `install.sh --firewall` → node51 UEFI booting→installing→configuring→done 648 s; `verify-ssh` hostname/IP/gateway/DNS, sudo, authorized_keys persis key ter-inject, password ditolak, reboot dari disk tetap done; idempoten; uninstall (port tertutup, file manifest hilang, data tetap); purge 1-4; rollback; cleanup/protected. VLAN PASS @`06517b9` (info). Penolakan "pre" dan `neg-overlap` terbukti KVM di `kvm/iter2` (`3d60aa9`) dan unit test @`06517b9` (`infra-test-dev-iter3.txt:151,156`), jalur tidak berubah — diterima. |
| 6 | Tanpa secret plaintext | PASS | `kvm/iter3/redact.txt` 258 bersih, scan Playwright, `iter3/vlan/redact.txt`, scan `review-security-iter2.md`; satu-satunya hit M8 hash dummy `infra/test/m8.sh:9` |

## Item wajib iterasi 3 (bukti saja)
1. `npm run lint` dan typecheck di `dashboard/` pada HEAD → `.agent/runs/m8/lint-iter3.txt`, `tsc-iter3.txt` (dengan exit code), bersih termasuk `e2e-kvm/m8-*.spec.ts`.
2. `git diff main...HEAD --stat -- dashboard/src` → `.agent/runs/m8/dashboard-src-diff.txt`, wajib kosong.
3. `bash infra/test/run.sh` di HEAD → `.agent/runs/m8/infra-test-iter3-head.txt`: 0 gagal, ≥ 169 lulus.
4. Bila ada perubahan kode, alur penuh lagi.

## Carry-over (diterima)
curl tanpa `--connect-timeout`/`--max-time` (minor, robustness; sangat disarankan milestone berikut); CR-8-18..25 (minor); SR-8-11 (minor); SR-8-12, SR-8-13 (info); SR-8-3, SR-8-9, SR-8-10 (DEC-030 §3).

## Catatan proses
Keputusan user men-skip VLAN perlu dicatat di DEC baru (VLAN iter3 tetap PASS @`06517b9` sebagai info).
