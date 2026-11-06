# DEC-021: Repo DVD Debian yang tidak bertanda tangan (BUG-M6-9)
- Tanggal: 2026-11-06T20:00:00Z
- Milestone: 6
- Status: Accepted
## Konteks
Smoke M6 attempt10 (`.agent/runs/m6/smoke/attempt10-debian-auto-failpath/`, `bugs.md` BUG-M6-9): setelah
base system terpasang dari DVD-1 lokal (DEC-018 §2), apt 2.6 di target menolak mirror DVD karena
`dists/bookworm/Release` tidak bertanda tangan (`InRelease`/`Release.gpg` 404). `allow_unauthenticated`
tidak cukup. `Release` juga menyatakan `Acquire-By-Hash: yes` padahal `by-hash/` tidak ada.
Opsi: (a) tanda tangani ulang metadata dengan key lab sekali pakai, (b) tandai repo media sebagai
tepercaya hanya untuk instalasi dari media lokal, (c) matikan mirror dan cari sumber paket lain.
## Keputusan
1. **Pilih (b), dibatasi.** Untuk image Debian yang sumbernya media lokal server PXE (DVD, metadata tidak
   bertanda tangan), generator menulis sumber apt target ke media itu sebagai `[trusted=yes]` dan
   mematikan `Acquire::By-Hash` untuk sumber tersebut, hanya selama instalasi.
2. **Setelah instalasi**, konfigurasi `trusted=yes`/override apt dihapus atau dinonaktifkan di
   `late_command`, sehingga sistem terpasang tidak menyimpan sumber tak terautentikasi. Diverifikasi
   lewat SSH (`verify-node` / suite KVM): tidak ada `trusted=yes` di `/etc/apt/` target.
3. Integritas media dijamin di host: ISO diverifikasi checksum resminya sebelum dipakai (bukti di run
   KVM). Jaringan `pxe-test` terisolasi (DEC-003). Sisa risiko (apt tanpa verifikasi tanda tangan selama
   instalasi dari server PXE) dicatat di README "Asumsi keamanan" dan REPORT-final.
4. Opsi (a) tidak dipilih: menambah private key lab, re-generate metadata, dan distribusi key ke d-i
   untuk milestone terakhir — kompleksitas dan risiko secret lebih besar dari manfaatnya di lab terisolasi.
## Konsekuensi
- `installers/debian.ts` (+ test generator, golden) dan, bila perlu, infra berubah → smoke Debian ulang
  sebelum run KVM resmi.
- Security reviewer menilai pembatasan §1–§2; bila sumber image Debian kelak berupa mirror bertanda
  tangan, `trusted=yes` tidak boleh dipakai (diuji generator).
