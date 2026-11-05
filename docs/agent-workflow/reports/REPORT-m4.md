# Report Milestone 4
## Ringkasan
Backend nyata menggantikan store mock: persistence SQLite (`node:sqlite`), discovery host dari lease dnsmasq dan request iPXE, script boot per-MAC `GET /boot/{mac}.ipxe` (boot lokal bila tanpa job, installer bila ada job Install), generator konfigurasi Ubuntu autoinstall / Debian preseed / Rocky kickstart / Windows unattend (Windows: generator + unit test saja), token per job (hash di DB, respons 404 seragam), callback status dari installer, `/api/server-status`, Settings dari env, dan lab KVM `infra/` (PXE server VM `pxe-test-server`, node, smoke, `kvm-run.sh`, redaksi bukti). Alur penuh terbukti di VM: PXE boot → host muncul → konfigurasi → Simpan & Install → Booting → Installing → Configuring → Done → login SSH dengan key yang di-inject → reboot dari disk tanpa reinstall, untuk UEFI dan BIOS Ubuntu 24.04.
## Acceptance criteria
| Kriteria | Status | Bukti |
|---|---|---|
| AC-4.1 – AC-4.28 (lokal: unit/integration/E2E/infra) | Lulus | .agent/runs/m4/ac-trace.md |
| AC-4.29 – AC-4.34 (KVM) | Lulus | .agent/runs/m4/kvm/results.json |
## Perubahan utama
- `dashboard/src/lib/server/{db,discovery,boot-script,provisioning,tokens,settings,install-service,config-service}`, `lib/server/installers/*`.
- `dashboard/src/app/boot/**`, `app/api/{settings,server-status,os-images,ssh-keys}`.
- UI: Settings, status server PXE nyata di top bar, OS image dari API, error install per host, Reboot ke PXE nonaktif (DEC-012).
- `infra/*` (network, server, node, cleanup, kvm-run, redact-evidence, test shell), `dashboard/e2e-kvm/*`.
## Iterasi & temuan
- Bug yang ditemukan dan diperbaiki selama Test: B-1, B-2 (test lokal); B-3, B-4, B-5 (uji KVM nyata). B-4 (iPXE `exit` tanpa status membuat firmware UEFI berhenti di menu boot) dan B-5 (token bocor ter-base64 ke console installer) adalah temuan penting yang hanya terlihat di VM sungguhan.
- Review/gate iterasi 1: APPROVED (APR-004), 0 critical/major; 26 minor diterima dengan target M5/M6.
## Risiko & utang teknis
- `/api/**` dan UI belum dilindungi login (SR-4-1) — jangan dipasang di luar jaringan lab terisolasi sampai M6.
- Installer bisa dilayani berulang bila callback hilang (CR-4-1) — wajib M5.
- Derivasi URL callback dari `/proc/cmdline` untuk Debian/Rocky baru teruji unit (CR-4-6) — wajib KVM M6.
- Unattend Windows masih menyisipkan token (CR-4-7) — belum dilayani; wajib dirancang ulang sebelum dilayani.
- Dokumen plan M4 belum mencerminkan `exit 1`, `chain --replace`, dan kontrak `/proc/cmdline` (CR-4-2/4-3/4-21) — amandemen sebelum plan M5 final.
## Blocker (jika ada)
Tidak ada.
## Housekeeping
- Network `pxe-test` dan `pxe-test-nat` masih aktif (dihapus di akhir semua milestone). Tidak ada VM `pxe-test-*` tersisa.
- Direktori sementara test awal di `/tmp/pxe-e2e-*`, `/tmp/pxe-test-{persist,srvstat,tokdb}-*` berada di luar project; perlu dihapus user.
## Langkah berikutnya
M5 (callback status & jobs): Plan oleh architect, termasuk amandemen dokumen M4 dan kewajiban carry-over di .agent/runs/m4/gate-iter1.md.
