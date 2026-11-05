# DEC-010: Sumber status, perilaku boot, Windows, dan cakupan matriks KVM M4
- Tanggal: 2026-11-05T07:08:00Z
- Milestone: 4 (berdampak ke 5 dan 6)
- Status: Accepted
## Konteks
Gate M4 butuh status host mencapai Done di VM nyata, sementara jobs/log/timeout lengkap adalah
M5. Matriks KVM CLAUDE.md berisi 5 skenario; satu instalasi butuh 10–15 menit dan RAM hanya
cukup ~2 VM paralel termasuk VM server. Opsi: `docs/design/M4-options.md` §O7–O9, O12.
## Opsi yang dipertimbangkan
1. Semua skenario KVM di M4 — risiko waktu tinggi × 3 iterasi gate.
2. M4: UEFI + BIOS Ubuntu 24.04 (single host, lewat dashboard, verifikasi SSH, reboot tanpa
   reinstall); M5: uji `virsh destroy` → Failed setelah timeout; M6: Debian, Rocky, bulk 3×, dan
   negatif sisanya.
## Keputusan
Opsi 2. Ditambah:
- Status minimum M4: `booting` saat script iPXE installer dilayani, `installing` saat konfigurasi
  di-fetch, `configuring` dari late-commands (sekaligus job pindah ke boot lokal), `done` dari unit
  first-boot di OS terpasang. Jobs, log, dan timeout lengkap di M5.
- `/boot/{mac}.ipxe` untuk host tanpa job aktif → boot lokal (exit ke firmware/sanboot). Harness
  KVM memakai `virsh reset` setelah klik Install.
- Windows: generator `unattend.xml` + unit test saja (SPEC); akses Windows key-only, install
  Windows lewat dashboard ditolak 422 sampai ada media/pengujian.
- RAM node 2 GB sesuai CLAUDE.md; bila subiquity terbukti gagal di 2 GB (bukti log), naikkan ke
  3 GB lewat decision baru.
## Konsekuensi
- Gate M4 hanya menilai bukti KVM Ubuntu UEFI+BIOS; skenario lain menjadi syarat gate M5/M6.
