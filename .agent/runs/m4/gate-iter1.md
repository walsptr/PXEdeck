# Gate M4 — iterasi 1 (gatekeeper)

> Ditulis Orchestrator dari keputusan gatekeeper (agent gatekeeper tidak punya tool tulis); isi tidak diubah.

- Branch `milestone/4-backend-ipxe` @ `2b9d88e`. Kode produk identik dengan `b3a7ed4` yang diuji KVM: `git diff b3a7ed4 2b9d88e` hanya `dashboard/e2e-kvm/*` (review code), dan `deploy-dashboard.txt` mencatat commit b3a7ed4.
- Acuan: `CLAUDE.md` §Gate approval, `docs/design/M4-plan.md` (AC-4.1..4.34), DEC-007..012 (DEC-010 membatasi cakupan KVM M4 ke Ubuntu UEFI+BIOS), `.agent/runs/m3/gate-iter3.md` §Carry-over.

## Keputusan: APPROVED

## Tabel gate

| Gate | Status | Bukti |
|---|---|---|
| 1a. Typecheck | PASS (`next typegen && tsc --noEmit`, tanpa error) | .agent/runs/m4/typecheck.log |
| 1b. Lint | PASS (eslint tanpa error) | .agent/runs/m4/lint.log |
| 2a. Unit & integration | PASS: 766/766, 30 file | .agent/runs/m4/unit.log:30-31 |
| 2b. Coverage kode baru ≥ 80% | PASS: kode baru M4 lines 1512/1526 = 99.08%, branches 96.85%; semua file > 93% lines; repo 99.14%; config DEC-004 utuh (termasuk `src/app/boot/**`) | coverage-m4-new-code.txt, coverage-summary.txt/.json |
| 2c. E2E Playwright lokal | PASS: 69/69 | .agent/runs/m4/e2e.log:282 |
| 2d. Test infra (shell) | PASS: 33/0 | .agent/runs/m4/infra-test.log:35 |
| 3. Setiap AC punya ≥ 1 test | PASS: AC-4.1..4.34 (34/34) dipetakan ke test lulus; sampel AC-4.8/4.9/4.14/4.15/4.23/4.24/4.26 dicocokkan code-reviewer dengan `boot-routes.test.ts` | ac-trace.md, review-code-iter1.md §Kesesuaian AC |
| 4a. Code review | PASS: 0 critical, 0 major, 15 minor, 6 info | review-code-iter1.md |
| 4b. Security review | PASS: 0 critical, 0 major, 4 minor, 7 info | review-security-iter1.md |
| 4c. Design review | PASS: 0 critical, 0 major, 7 minor; DR-1-3 & DR-2-3 closed | review-design-iter1.md |
| 5. Bukti KVM | PASS. Run resmi 20261105T135915Z @ b3a7ed4, `kvm-run.sh m4` exit 0. UEFI node11 booting 14:00:14 → done 14:09:56 (603 s); BIOS node12 done 393 s. SSH dengan key yang di-inject (kedua node): hostname, IP/MAC, gateway, DNS, `sudo -n`, `authorized_keys` tepat 1 baris (0600), `sshd -T passwordauthentication no`, login password ditolak. Reboot kembali dari disk, kernel installer 4 → 4, status tetap done, `/boot/<mac>.ipxe` melayani skrip lokal `exit 1`/`sanboot`. AC-4.32 negatif PASS. AC-4.29 `ss -lunp` PASS. Cleanup: VM run + overlay server dihapus; `ubuntu24.04` dan network `default`/`int`/`pxe-test` identik sebelum/sesudah. | kvm/results.json, kvm/pxe-test-m4-node1{1,2}-{status,verify-ssh,negative}.txt, kvm/server-check.txt, kvm/cleanup.txt, kvm/libvirt-{before,after}.txt |
| 6. Secret/plaintext | PASS. `secret-scan.txt` bersih (177 file teks; satu hit b64 = blob sshd berisi kata "Password", bukan secret); `redact-evidence` bersih (193 file); `evidence-scan.txt` bersih (teks+base64); scan independen security-reviewer atas 535 blob `main..HEAD` bersih; I-3-14 beres di HEAD. | secret-scan.txt, kvm/evidence-scan.txt, review-security-iter1.md §Secret |
| Skip/.only/pelemahan test | PASS. Grep pola skip/only/todo/fixme/xit/xdescribe/skipIf/runIf/test.fail di `dashboard/src`, `dashboard/e2e`, `dashboard/e2e-kvm`, `infra/test` = 0 hit. 38 asersi yang dihapus ditelusuri, tidak ada yang dilemahkan (CR-4-20). Perubahan harness KVM attempt1/attempt4 mengetatkan (CR-4-16). `forbidOnly`, `retries: 0`, ambang 80/80 utuh. | review-code-iter1.md §Pemeriksaan pelemahan, test-migration.md, ac-trace.md |

Attempt1–4 dan `fix-B4/` adalah run gagal/diagnostik (B-3, B-4, B-5, bug harness) yang perbaikannya terverifikasi di run resmi; tidak dihitung sebagai bukti gate.

## Carry-over M3 → M4 (12 kewajiban): semua closed
I-3-14, SR-3-5, SR-2-1/CR-3-12, CR-3-4, CR-3-15, CR-1-7, CR-1-10 (`guard-cr-1-10.log`), DR-1-3, DR-2-3, CR-2-11, I-3-8, Gate 5 KVM.

## Temuan terbuka
- Critical: tidak ada. Major: tidak ada.
- Minor (diterima, dengan target):
  - CR-4-1 install berulang bila callback `configuring` hilang → **wajib M5** (bertabrakan dengan uji `virsh destroy`).
  - CR-4-2, CR-4-3, CR-4-21 drift plan/DEC (`exit 1`, `chain --replace`, URL callback dari `/proc/cmdline`, nama script infra, `current_ip` di DEC-008) → **amandemen wajib sebelum plan M5 final**.
  - CR-4-4 `KCMD` test manual → M5 (paling lambat sebelum KVM Debian/Rocky M6).
  - CR-4-5 `waitScript` tanpa `--replace` → M5.
  - CR-4-6 B-5 Debian/Rocky hanya teruji unit → **wajib KVM Debian 12 + Rocky 9 di M6** (termasuk target bebas token, SR-4-6).
  - CR-4-7 / SR-4-3 unattend Windows (token, AutoLogon) → wajib sebelum unattend dilayani (major bila dilayani tanpa perubahan).
  - CR-4-8 / SR-4-4 log injection `logBootDenied` → M5.
  - CR-4-9 / SR-4-5 `decodeURIComponent` ganda → 500 → M5.
  - CR-4-10 base URL IPv6 → M5.
  - CR-4-11 "tidak ada job baru" bukti tak langsung → asersi jumlah job di M5.
  - CR-4-12 log dnsmasq/nginx AC-4.30 manual → asersi otomatis di `kvm-run.sh` M5.
  - CR-4-13 `cleanup.sh server` menghapus base disk → M5.
  - CR-4-14 redact memproses biner → M5.
  - CR-4-15 / SR-4-9 `X-Forwarded-Host` tanpa `PXE_TRUST_PROXY` → M5.
  - SR-4-1 `/api/**` & UI tanpa auth → **wajib M6, blocker gate M6**; mitigasi nginx `allow 10.99.0.1; deny all` disarankan di M5.
  - SR-4-2 binding IP gagal-terbuka (leases kosong + trust proxy) → **wajib M5** (fail-fast + test + `.env.example`).
  - DR-4-1..DR-4-7 kosmetik/UX → M5 (prioritas DR-4-4, DR-4-7).
- Info: SR-4-6 (→ CR-4-6), SR-4-7, SR-4-8 (M6: HTTPS/LAN terpercaya), SR-4-10 (ganti password lab di node nyata — aksi user), SR-4-11, I-4-1..I-4-5.

## Kewajiban carry-over
**M5:** (1) CR-4-1 + test integration & KVM `virsh destroy` → Failed → install ulang; (2) SR-4-2; (3) amandemen plan/DEC CR-4-2/4-3/4-21 sebelum plan M5 final; (4) CR-4-4; (5) CR-4-11, CR-4-12; (6) CR-4-5, CR-4-8/SR-4-4, CR-4-9, CR-4-10, CR-4-13, CR-4-14, CR-4-15/SR-4-9; (7) DR-4-1..DR-4-7.

**M6:** (1) SR-4-1 login + rate limit (blocker); (2) CR-4-6 + SR-4-6 KVM Debian 12/Rocky 9 + bulk 3× UEFI Ubuntu + E2E penuh (DEC-010); (3) CR-4-7/SR-4-3 sebelum unattend dilayani; (4) SR-4-8 dokumentasi asumsi LAN / HTTPS.

## Alasan
Typecheck/lint bersih; 766/766 unit, 69/69 E2E, 33/33 infra; coverage kode baru 99.08%; 34/34 AC teruji; tanpa critical/major; bukti KVM UEFI+BIOS lengkap sampai login SSH dengan key yang di-inject dan reboot dari disk; cleanup bersih dan resource terlindungi utuh; scan secret bersih; 12 carry-over M3 closed; matriks Debian/Rocky/bulk dipindah resmi ke M6 lewat DEC-010.
