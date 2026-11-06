# DEC-024: Topologi uji VLAN dan validasi IP per VLAN (M7)
- Tanggal: 2026-11-06
- Milestone: 7
- Status: Accepted
## Konteks
`docs/design/M7-plan.md` dan `M7-options.md` (architect) memecah DEC-023 menjadi 12 task dan 32 AC.
Plan itu juga mengajukan opsi O1–O10. Celah produk yang pasti: validasi IP statis (DEC-006) terikat ke
satu subnet management, sehingga IP di VLAN management ditolak oleh server dan form
(`lib/net.ts:111-172`, `config-service.ts:367-388`, `tab-network.tsx:54-55`).
## Keputusan
Semua rekomendasi architect diterima.
1. **O1-A.** Trunk server terpisah di network `pxe-test-trunk`. Segmen admin `pxe-test` (untagged,
   `10.99.0.0/24`, tanpa DHCP) tetap dipakai host untuk Playwright dan ssh ke `10.99.0.2`/`.3`.
   Port node `pxe-test-port1` berisi VLAN 10 native dan VLAN 20 ber-tag. Port uji negatif
   `pxe-test-port2`. Ketiga network baru tanpa `<ip>`, `<forward>`, dan `<dhcp>`.
2. **O2-A.** VM `pxe-test-switch` memakai bridge `vlan_filtering=1` yang dikonfigurasi script iproute2
   dan unit oneshot, dari cloud image Ubuntu yang sudah ada di `.agent/media`, tanpa NAT.
3. **O3-A.** Profil VLAN server diterapkan saat runtime (`server-up.sh --topology vlan`).
   - Switch dan node baru dibuat setelah `verify-listen-vlan.sh` PASS.
   - Bila verifikasi gagal, dnsmasq dihentikan.
   - Jendela dnsmasq flat sebelum profil aktif hanya terjadi di segmen terisolasi `pxe-test` tanpa
     node, sehingga dapat diterima. Bila reviewer menilai sebaliknya, cadangannya O3-B.
4. **O4-B.** Env `PXE_VLAN_NETWORKS="<vlan>:<cidr>:<gateway>[;…]"`.
   - IP statis dengan VLAN terdaftar divalidasi terhadap CIDR VLAN itu: dalam subnet, bukan
     network/broadcast, ≠ gateway, prefix sama, gateway di CIDR, dan tidak bentrok dengan host lain
     maupun lease.
   - VLAN tidak terdaftar atau `null` tetap memakai aturan DEC-006 tanpa perubahan.
   - Ini **memperluas** DEC-006, tidak menggantinya. Test lama tidak boleh berubah perilakunya.
5. **O5-A.** Server dapat dijangkau dari VLAN management: `mgmt20` = gateway `10.99.20.1`,
   `ip_forward=0`, nginx dan ekspor NFS read-only mencakup subnet VLAN 20. Generator Ubuntu tidak
   berubah. Syarat production ini dicatat di `infra/README.md` §Topologi VLAN. Bila smoke (M7-T10)
   membuktikan instalasi Ubuntu macet setelah perpindahan network, perubahan ke O5-B **wajib** lewat
   decision baru, tidak diam-diam di dev.
6. **O6-A.** Interface native (VLAN PXE) di OS terpasang tidak mendapat IPv4. Rocky diperbaiki lewat
   `%post` hanya bila `vlan ≠ null`, dan dibuktikan dengan unit test dan KVM.
7. **O7-A.** Verifikasi SSH memakai relay terbatas di VM server sesuai DEC-023 §4. Key node disalin per
   run dengan mode 0600 dan dihapus saat `finish`. Ada asersi statis bahwa host tidak pernah menyasar
   `10.99.10.*`/`10.99.20.*`: host tidak punya route ke subnet itu, sehingga paket bisa keluar ke LAN
   fisik.
8. **O8-A.** Skenario KVM: `vlansmoke` (dini), `vlanneg`, `vlancore` (UEFI dan BIOS Ubuntu, wajib gate),
   dan `vlandistro` (Debian, Rocky). Bulk tidak diulang di KVM.
9. **O9-A.** Bukti negatif berupa capture DHCP saja (tanpa HTTP, jadi tanpa token di pcap), plus log
   dan counter.
10. **O10.** Dukungan VLAN Debian di target ditentukan dari bukti smoke. Paket `vlan` dari DVD
    ditambahkan secara kondisional hanya bila diperlukan, dengan test.
11. Base disk server sudah dihapus di M6-T16, jadi M7 mem-provision ulang dengan `server-base.sh`.
## Konsekuensi
- Urutan task mengikuti plan: (T1 ∥ T2 ∥ T3) → T4 → T5 → T10 smoke → T6 → (T7 ∥ T9) → T8 → T11 →
  review/gate → APR → T12.
- Gate sama dengan CLAUDE.md. AC-7.21 (UEFI Ubuntu) dan AC-7.22 (BIOS Ubuntu) wajib gate. Semua AC KVM
  wajib untuk DEC-023 §5.
