# Report Milestone 7: PXE lewat VLAN
## Ringkasan
User meminta uji yang mewakili production, di mana PXE boot punya VLAN sendiri. M7 membuktikan dashboard bekerja penuh pada topologi berikut di VM KVM sungguhan (DEC-023, DEC-024):
- **Port node:** trunk dengan VLAN PXE 10 native (untagged) dan VLAN management 20 ber-tag.
- **Server PXE:** di trunk dengan sub-interface ber-tag. dnsmasq hanya listen di VLAN 10, DHCP tanpa router, dan server tidak meneruskan paket (`ip_forward=0`).
- **Switch:** disimulasikan VM `pxe-test-switch` (Linux bridge dengan `vlan_filtering`). Semua network berada di `pxe-test-*` yang terisolasi.

| Uji | Hasil |
|---|---|
| Ubuntu 24.04 UEFI (node31) dan BIOS (node32), alur UI penuh | Done dalam 668 s dan 487 s. IP statis di VLAN 20, SSH dengan key yang di-inject, login password ditolak, MTU 1472 dengan DF, reboot dari disk tanpa reinstall |
| Debian 12 UEFI (node33), Rocky 9 UEFI (node34) | Done dalam 601 s dan 497 s. VLAN `enp1s0.20` hidup di Debian tanpa paket `vlan`, NIC native Rocky tanpa IPv4 |
| Uji negatif | Node di segmen admin tidak mendapat DHCP. DISCOVER ber-tag VLAN 20 tidak dijawab. Frame VLAN 10 ber-tag tidak sampai ke trunk. Node tidak bisa mengakses API (403) maupun host |
| Validasi | IP bentrok, IP di luar subnet VLAN, dan VLAN tidak terdaftar ditolak (422) di UI dan API |
| Regresi topologi flat M6 | Debian Done 583 s dengan perubahan cmdline |

Beberapa hal juga terbukti di tingkat jaringan:
- DHCP berjalan ber-tag VLAN 10 di trunk.
- Installer Ubuntu pindah ke VLAN 20 di tengah instalasi, dan NFS pulih setelahnya.
- Callback terakhir datang dari IP VLAN 20.
- OS terpasang tidak lagi meminta DHCP.

## Acceptance criteria
| Kriteria | Status | Bukti |
|---|---|---|
| AC-7.1 – AC-7.19, AC-7.31 (unit/integration/E2E/shell/static) | Lulus | .agent/runs/m7/ac-trace.md, .agent/runs/m7/final-iter2/ |
| AC-7.20 – AC-7.30 (KVM) | Lulus | .agent/runs/m7/kvm/results.json |
| AC-7.32 (teardown) | Lulus | .agent/runs/m7/teardown.txt |

## Perubahan utama
- **Produk:**
  - Env `PXE_VLAN_NETWORKS` (`<vlan>:<cidr>:<gateway>;…`) dengan validasi IP statis per VLAN terdaftar. Single dan bulk, konflik global, transaksional. VLAN tidak terdaftar tetap memakai aturan DEC-006.
  - API mengirim `vlanNetworks` hanya bila ada isinya (DEC-025 §3).
  - Tab Network kini paham VLAN: petunjuk, isi otomatis prefix/gateway, pratinjau bulk. Settings mendapat kartu "VLAN management".
  - Generator Rocky: NIC native tanpa IPv4.
  - Debian: `netcfg/no_default_route=true` dan `netcfg/get_nameservers=<PXE_MGMT_DNS[0]>`. Tanpa ini, d-i macet di DHCP tanpa router, karena script udhcpc busybox berhenti sebelum menulis resolv.conf (DEC-025, DEC-026).
- **Keamanan (DEC-027), juga berlaku untuk `main` sebelumnya:**
  - Form login bisa terkirim sebagai GET dengan password di URL bila disubmit sebelum hydration. Password run sekali pakai sempat tercatat di log nginx, lalu sudah diredaksi.
  - Sekarang form memakai POST ke `/login/submit` (303, body tidak dibaca), dan tombol nonaktif sampai hydration.
  - Access log nginx tidak lagi mencatat query string, kecuali `/boot/<mac>.ipxe`.
  - Scanner bukti menolak kredensial di URL, termasuk bentuk ter-encode.
- **Aksesibilitas:** region scroll tabel preview dan password kini bisa difokus dengan keyboard dan diberi label (F-T8-1, CR-7-4).
- **Infra:**
  - 3 network baru (`pxe-test-trunk`, `-port1`, `-port2`).
  - VM switch.
  - Profil VLAN untuk server (`server-up.sh --topology vlan`).
  - `verify-listen-vlan.sh`, fail-closed. Mewajibkan `%pxe10:67`.
  - `infra/vlan/relay.sh`, untuk verifikasi SSH dari dalam server.
  - Skenario `kvm-run.sh`: `vlansmoke`, `vlanneg`, `vlancore`, `vlandistro`.
  - README §Topologi VLAN, termasuk syarat production dan perimeter.
  - Bug SIGPIPE dry-run `deploy-dashboard.sh` (sejak M6) diperbaiki.

## Iterasi & temuan
- **Build dan smoke:** smoke menemukan dua celah Debian secara berurutan.
  - Pertama, prompt default route.
  - Kedua, prompt nameserver.
  - Akar masalahnya dikonfirmasi dari source bookworm, lalu diperbaiki di produk.
- **Suite KVM:** kebocoran kredensial login di URL ditemukan (DEC-027) dan diperbaiki.
- **Iterasi 1: CHANGES_REQUESTED.** Hanya GK-7-1: suite infra hijau 8/10 karena race SIGPIPE. Semua review PASS (0 critical/major).
- **Iterasi 2: APPROVED.**
  - Test infra 10/10 hijau.
  - Perapian scanner dan UI.
  - Dokumentasi perimeter dikoreksi.
  - Run KVM tidak perlu diulang. Diff membuktikan jalur KVM tidak berubah.

## Syarat production yang terbukti
- Bila VLAN PXE tidak punya router, VLAN management harus bisa menjangkau `PXE_SERVER_IP`:
  - lewat HTTP, untuk callback status;
  - lewat NFS untuk Ubuntu, karena installer Ubuntu pindah ke VLAN management di tengah instalasi.

  Di lab, server menjadi gateway VLAN 20 tanpa forwarding.
- Debian 12 d-i di VLAN PXE tanpa router butuh dua parameter cmdline yang kini dikirim dashboard. DNS pertama di `PXE_MGMT_DNS` harus DNS yang dapat dijangkau dari VLAN PXE.
- Port node bisa berupa trunk dengan VLAN PXE native. Firmware PXE/UEFI tidak perlu mendukung tag VLAN.

## Risiko & carry-over
Rincian lengkap ada di `.agent/runs/m7/gate-iter2.md` §Carry-over.
- **DR-7-2 (prioritas pertama).** Tab Credentials bulk: input file CSV dan Switch tidak punya nama aksesibel (axe critical). Sudah ada sejak M3, label ganda pada region CSV (DR-7-9).
- **SR-7-1 / CR-7-1.** `error_log` nginx masih mencatat query mentah pada error upstream.
- **SR-7-2 / SR-7-9.** rpcbind, mountd, statd, sshd, dan lockd di server PXE listen di wildcard, sehingga dapat dijangkau dari VLAN. Untuk production direkomendasikan filter nftables per interface VLAN, termasuk `ct helper` TFTP yang eksplisit. Rinciannya di README.
- **Minor lain:**
  - DR-7-1: CIDR di ringkasan error tidak mono.
  - DR-7-3: fokus checkbox.
  - CR-7-7: scanner latin1 vs `…`.
- **Temuan info:** CR-7-5, CR-7-6, CR-7-8, SR-7-3, SR-7-4, SR-7-6, SR-7-7, SR-7-8, SR-7-10, DR-7-4..8, DR-7-10.
- **Dari DEC-025 §4.** Setelah iPXE menyerahkan ke boot lokal, firmware UEFI mencoba HTTP boot sekitar 80 s sebelum jatuh ke disk. Ini juga terjadi di M6.

## Teardown (AC-7.32)
PASS (commit `68f3841`, `.agent/runs/m7/teardown.txt`). Kelima network `pxe-test`, `pxe-test-nat`, `pxe-test-trunk`, `pxe-test-port1` dan `pxe-test-port2` sudah dihapus. Base disk server dan switch juga dihapus, dan `.agent/keys` kosong. `ubuntu24.04`, `default` dan `int` identik sebelum dan sesudah teardown (sha256 XML sama). `.agent/media/` dipertahankan.

Sisa yang perlu dibersihkan user (agent tidak diizinkan atau tidak berwenang):
- Direktori cache `.agent/vms/pxe-test-debian-disk-modules/` (±115 KB, penghapusannya ditolak sistem izin).
- Entri basi di pool libvirt `vms`. Bukan resource `pxe-test-`; bersihkan dengan `virsh pool-refresh vms`.

## Blocker
Tidak ada.
