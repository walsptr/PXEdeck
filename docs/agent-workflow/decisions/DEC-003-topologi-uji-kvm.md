# DEC-003: PXE server test berjalan di VM `pxe-test-server`, bukan di host
- Tanggal: 2026-11-05T05:45:00Z
- Milestone: 4
- Status: Accepted
## Konteks
Hasil pemeriksaan awal (Orchestrator, read-only):
- KVM dan `virsh -c qemu:///system` tersedia tanpa sudo (user di grup `libvirt`). RAM tersedia
  ±9,6 GB → maksimal 2 VM paralel. OVMF tersedia. iPXE standalone (`ipxe.efi`/`undionly.kpxe`)
  **tidak** terpasang di host; hanya ROM NIC QEMU.
- dnsmasq perlu root untuk bind port 67/69 (`ip_unprivileged_port_start=1024`, tanpa
  capability). Agent dilarang memakai sudo.
- firewalld zona `libvirt` (virbr*) menolak koneksi guest→host kecuali dhcp/dns/ssh/tftp, jadi VM
  tidak bisa menjangkau dashboard yang berjalan di host. Host→guest diizinkan.
- Sudah ada VM user `pxe-test-node01` (network `int`) dan `ubuntu24.04` (PXE server lab asli)
  yang harus dilindungi walau namanya berprefix serupa.
## Opsi yang dipertimbangkan
1. dnsmasq + dashboard di host pada `virbr-pxe` — butuh sudo dan perubahan firewall host → dilarang.
2. DHCP/TFTP bawaan libvirt (`<dhcp><bootp/>` + `<tftp/>`) — tanpa sudo, tetapi aturan meminta DHCP
   libvirt dimatikan dan DHCP disajikan PXE server project; tetap tidak menyelesaikan masalah
   guest→host untuk HTTP/callback.
3. VM `pxe-test-server` (Ubuntu 24.04 cloud image) di network `pxe-test` (10.99.0.2) menjalankan
   dnsmasq (DHCP+TFTP, bind hanya ke NIC pxe-test) + dashboard (Next.js production) + media HTTP.
   Host menjangkau dashboard di `http://10.99.0.2:3000`. Untuk memasang paket/Node di VM server,
   VM itu punya NIC kedua di network NAT terpisah `pxe-test-nat` (192.168.199.0/24, DHCP libvirt
   aktif hanya di network itu). Node test tetap hanya di `pxe-test` yang terisolasi tanpa forward.
## Keputusan
Opsi 3, yang juga mencerminkan deployment nyata (dashboard berjalan di PXE server).
- Media instalasi diunduh sekali ke `.agent/media/` dari mirror resmi, disalin ke VM server, dan
  disajikan lewat HTTP di 10.99.0.2 sehingga installer tidak butuh internet: Ubuntu live-server
  ISO (autoinstall offline), Debian 12 netboot kernel/initrd + DVD-1 sebagai mirror lokal, Rocky 9
  minimal ISO sebagai `inst.repo`.
- Boot chain: iPXE dari ROM NIC QEMU (BIOS) atau `ipxe.efi`/`snponly.efi` dari paket `ipxe` resmi
  Ubuntu (archive.ubuntu.com) untuk UEFI; dnsmasq mendeteksi user-class iPXE lalu memberi URL
  `http://10.99.0.2:3000/boot/<mac>.ipxe` (SPEC §5).
- Lab produksi (GRUB/shim + Secure Boot) tidak diubah; GRUB-over-HTTP per-MAC untuk Secure Boot
  dicatat sebagai pekerjaan lanjutan.
## Konsekuensi
- `pxe-test-nat` satu-satunya jalur internet, hanya untuk VM server. Wajib diverifikasi bahwa
  dnsmasq server tidak listen di NIC NAT.
- Server VM butuh ±3–4 GB RAM → node paralel efektif 1; bulk 3 VM dijalankan bertahap bila RAM
  tidak cukup (dicatat di bukti).
- Secure Boot tidak diuji di matriks KVM (iPXE tidak bertanda tangan Microsoft).
