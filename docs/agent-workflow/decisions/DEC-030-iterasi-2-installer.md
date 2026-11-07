# DEC-030: Cakupan iterasi 2 M8 (installer)
- Tanggal: 2026-11-07
- Milestone: 8
- Status: Accepted
## Konteks
Review iterasi 1 M8 sama-sama memberi CHANGES_REQUESTED:
- code review: 7 major, 10 minor (`.agent/runs/m8/review-code-iter1.md`);
- security review: 1 major, 5 minor, 4 info (`review-security-iter1.md`).

Gate tidak mungkin APPROVED selama ada major terbuka. Karena itu iterasi 1 dianggap selesai dengan
CHANGES_REQUESTED tanpa memanggil gatekeeper terpisah, dan gatekeeper menilai di iterasi 2.
## Keputusan
1. **Wajib diperbaiki** (semua major):
   - **SR-8-1:** `..`/non-kanonik di semua tipe manifest. Uninstall me-resolve path dan membatasi
     `rm -rf` ke root yang diizinkan.
   - **CR-8-1 / CR-8-2:** verify hanya memeriksa socket milik `dnsmasq.service` kita dan menerima semua
     alamat yang ada di NIC terpilih (v4/v6).
   - **CR-8-3 / CR-8-4:** dnsmasq atau nfs-server yang sudah ada sebelum install ("pre") dengan config
     lain yang aktif → install **menolak** dengan pesan jelas (opsi `--force-shared` boleh ada bila aman,
     tetapi defaultnya menolak). Opsi global tidak boleh mengubah perilaku layanan milik admin.
   - **CR-8-5:** VLAN. Netplan divalidasi pada salinan sementara sebelum dipasang dan dibersihkan bila
     gagal. Parent dicari di ethernets/bonds/bridges/vlans. Nama ber-titik ditangani.
   - **CR-8-6:** simulasi `apt-get -s purge` dijalankan lebih dulu. Bila akan menghapus paket di luar
     manifest, uninstall menolak.
   - **CR-8-7:** bila tidak ada DNS upstream, dnsmasq memakai resolver host (atau peringatan + flag).
     Node harus bisa me-resolve nama eksternal pada konfigurasi default.
2. **Ikut diperbaiki (minor, murah):**
   - SR-8-2: default allowlist admin bukan subnet PXE; overlap atau `/0` butuh konfirmasi.
   - SR-8-4: `pkg requested` hanya untuk nama di daftar paket installer.
   - SR-8-5 / CR-8-17: ISO sumber tidak pernah dihapus.
   - SR-8-6 / CR-8-16: verifikasi Debian netboot lewat rantai `Release.gpg` dengan `gpgv` dan
     `debian-archive-keyring`.
   - SR-8-7: pemilik file password harus root; `read -s` di TTY.
   - SR-8-8: bersihkan `policy-rc.d` sisa yang punya marker installer.
   - CR-8-8 … CR-8-13, CR-8-15.
   - CR-8-14: kriteria DB di harness otomatis.
3. **Didokumentasikan, tidak diubah di M8:**
   - SR-8-3: server PXE harus single-tenant (user lokal bisa mengakses `127.0.0.1:3000`). Unix socket
     dicatat sebagai pekerjaan lanjutan.
   - SR-8-9, SR-8-10 (info).
4. **Uji ulang KVM:** skenario M8 penuh tanpa workaround, ditambah:
   - mode **VLAN** di VM nyata (sub-interface ber-tag lewat switch lab M7, node PXE lewat VLAN);
   - `--firewall`;
   - kasus "pre" dnsmasq/nfs harus ditolak.
## Konsekuensi
- backend-dev memperbaiki dengan test merah-bila-revert. test-engineer menguji ulang di KVM. Setelah
  itu review iterasi 2, gatekeeper, merge ke `main`, lalu push. Commit tanpa atribusi AI.
