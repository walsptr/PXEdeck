# DEC-018: Cakupan M6, matriks KVM, dan adaptasi E2E
- Tanggal: 2026-11-06T09:05:00Z
- Milestone: 6
- Status: Accepted
## Konteks
M6 adalah milestone terakhir. Rencana: `docs/design/M6-plan.md` (T1–T16, AC-6.1–6.54). Opsi:
`docs/design/M6-options.md` O9, O11, O12, O13.
## Keputusan
1. **Fitur yang ditunda DEC-015 (O9, A).** Status Offline otomatis dan registrasi OS image dari URL
   tetap di luar cakupan. `REPORT-final.md` wajib memuat §"Deviasi SPEC" untuk keduanya.
2. **Media KVM Debian 12 / Rocky 9 (O11, A + cadangan C).** Offline dari media lokal di `.agent/media`;
   node tetap di `pxe-test` terisolasi, tanpa NAT. Bila smoke membuktikan paket kurang (bukti log
   installer), host boleh mengunduh paket tambahan dari mirror resmi Debian/Rocky ke
   `.agent/media/extra-*` dengan verifikasi checksum/GPG, disajikan nginx sebagai repo lokal. Perubahan
   bentuk MAC di path boot (bila parser `inst.ks=`/`url=` menolak `:`) **butuh DEC baru**.
3. **Adaptasi E2E (O13, A).** `storageState` per server; tanpa env bypass auth (bypass = pelemahan =
   critical). Setiap perubahan spec lama dicatat di `test-migration.md`; jumlah asersi per file tidak
   boleh turun.
4. **Struktur run KVM (O12, B).** Tiga run terpisah di `.agent/runs/m6/kvm/<run>/`, diringkas ke
   `.agent/runs/m6/kvm/results.json`:
   - `core`: UEFI + BIOS Ubuntu 24.04, alur penuh dashboard dengan login, verifikasi SSH, semua uji
     negatif CLAUDE.md, perimeter, rate limit.
   - `distro`: UEFI Debian 12 (preseed) + UEFI Rocky 9 (kickstart).
   - `bulk`: 3× UEFI Ubuntu dengan satu aksi bulk di UI; node dinyalakan bergelombang sebesar
     `max_nodes` = clamp((RAM bebas − 4 GB)/2 GB, 1, 3). `PXE_JOB_BOOTING_TIMEOUT_MIN` boleh dinaikkan
     di env KVM bila perlu, nilainya dicatat di `results.json`.
   Harness selalu menulis entri cleanup ke `results.json` (termasuk run parsial) dan bukti libvirt
   sebelum/sesudah. Bila jalur boot/installer berubah setelah run resmi, wajib run konfirmasi.
5. **Teardown akhir (T16).** Setelah APR M6: hapus network `pxe-test` dan `pxe-test-nat`, base disk
   server, dan key sekali pakai; media dipertahankan. Bukti di `.agent/runs/m6/teardown.log`, wajib
   selesai sebelum `REPORT-final.md`. Resource terlindungi (`ubuntu24.04`, `pxe-test-node01`, network
   `default`, `int`) tidak disentuh.
6. **Aturan kerja (pelajaran M5).** Dev mengaudit sendiri dengan data ekstrem (8 lebar layar) sebelum
   serah terima; setiap perbaikan reviewer disertai test yang merah bila di-revert.
## Konsekuensi
- Durasi KVM ±3 jam total; skenario gagal diulang sendiri tanpa mengulang run lain.
- Windows tetap hanya generator + unit test (CLAUDE.md).
