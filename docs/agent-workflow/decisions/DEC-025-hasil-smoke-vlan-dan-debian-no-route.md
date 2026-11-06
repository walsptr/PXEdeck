# DEC-025: Hasil smoke VLAN, Debian tanpa default route, dan bentuk `vlanNetworks`
- Tanggal: 2026-11-06
- Milestone: 7
- Status: Accepted
## Konteks
Smoke KVM M7-T10 (commit `b8c05e0`, bukti `.agent/runs/m7/kvm/smoke/`):
- **Ubuntu UEFI (node41) dan Rocky UEFI (node42):** keduanya Done lewat topologi trunk dengan VLAN PXE 10
  native dan VLAN management 20 ber-tag. Verifikasi lewat relay, reboot dari disk, dan MTU 1472 DF
  semuanya PASS.
- **O5-A terbukti:** installer Ubuntu pindah ke VLAN 20 di tengah instalasi, NFS pulih, dan callback
  datang dari `10.99.20.51`.
- **O6-A terbukti:** NIC native Rocky tanpa IPv4 di OS terpasang.
- **Debian UEFI (node43) gagal.** d-i berhenti di prompt "Continue without a default route?" sebelum
  `preseed.cfg` diambil, karena DHCP VLAN PXE sengaja tanpa opsi router (DEC-024 §3 / O3). Pertanyaan
  itu muncul walau `priority=critical`, dan preseed belum dimuat saat itu. Baris perintah kernel Debian
  (`boot-script.ts:129-136`) tidak menjawab `netcfg/no_default_route`.

Di production, VLAN PXE tanpa router adalah konfigurasi yang wajar. Jadi ini celah produk, bukan
artefak lab.

Terpisah dari smoke: backend-dev M7-T1 tidak mengirim key `vlanNetworks` ketika `PXE_VLAN_NETWORKS`
kosong. Ini menyimpang dari teks AC-7.2, tetapi bentuk respons tetap sama persis dengan M6, sehingga
enam asersi lama tidak perlu dimigrasi.
## Keputusan
1. **Perbaikan produk (opsi a).** Baris perintah kernel installer Debian ditambah
   `netcfg/no_default_route=true` (sebelum `---`). Dua bentuk yang diterima:
   - selalu, karena aman ketika DHCP memberi router: d-i hanya memakai jawaban ini bila tidak ada
     router; atau
   - kondisional, bila dev membuktikan perlu.

   Disertai test unit/golden yang merah bila di-revert. DHCP VLAN PXE tetap tanpa router (opsi b
   ditolak, karena bertentangan dengan desain DEC-024).
2. **Smoke Debian diulang** setelah perbaikan untuk menilai O10, yaitu dukungan VLAN ifupdown di target
   tanpa paket tambahan. Bila O10 gagal, paket `vlan` dari DVD ditambahkan secara kondisional (DEC-024
   §10).
3. **Bentuk `vlanNetworks`.** Key tidak dikirim bila tidak ada VLAN terdaftar. Klien membaca
   `vlanNetworks ?? []`. Teks AC-7.2 dibaca sesuai keputusan ini, dan test AC-7.2 mengasersi kedua
   kasus: key tidak ada dan key berisi.
4. **Temuan lain (bukan VLAN):** setelah iPXE menyerahkan ke boot lokal, firmware UEFI mencoba HTTP boot
   dan baru jatuh ke disk sekitar 80 detik kemudian. Ini juga terjadi di M6 flat. Dicatat sebagai
   carry-over di REPORT-m7, bukan perbaikan di M7.
## Konsekuensi
- backend-dev memperbaiki `boot-script.ts` beserta test-nya. test-engineer mengulang smoke node43, lalu
  menjalankan suite penuh M7-T11.
