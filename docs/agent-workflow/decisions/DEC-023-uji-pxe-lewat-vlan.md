# DEC-023: Milestone 7, uji PXE boot lewat VLAN
- Tanggal: 2026-11-06
- Milestone: 7 (tambahan atas permintaan user, setelah M1–M6 APPROVED)
- Status: Accepted
## Konteks
Semua uji KVM M4–M6 berjalan di satu segmen L2 tanpa VLAN (`pxe-test`, untagged). User meminta
uji yang mewakili production, di mana PXE boot punya VLAN sendiri, dan meminta hasilnya dipastikan
berhasil. Jawaban user (2026-11-06, lewat AskUserQuestion):
- **Topologi production:** "Trunk, PXE native". Port node adalah trunk: VLAN PXE native (untagged),
  VLAN management ber-tag. Server PXE berada di port trunk dengan sub-interface ber-tag. OS terpasang
  memakai IP static di VLAN ber-tag lewat field VLAN di dashboard.
- **Izin network:** "Boleh, pxe-test-*". VM switch dan network libvirt terisolasi tambahan berprefix
  `pxe-test-` boleh dibuat, tanpa interface fisik dan tanpa `<forward>`.

SPEC §Network sudah memuat "VLAN opsional", dan generator Ubuntu/Debian/Rocky sudah menulis konfigurasi
VLAN. Namun belum pernah dibuktikan di VM, dan validasi subnet dashboard mungkin terikat ke subnet PXE.
## Keputusan
1. **Milestone 7 "PXE lewat VLAN"** mengikuti alur CLAUDE.md: Plan → Decide → Build → Test → Review →
   Gate (maks 3 iterasi) → Approve. Branch `milestone/7-vlan`.
2. **Topologi uji.** Switch disimulasikan oleh VM `pxe-test-switch` (Linux bridge dengan
   `vlan_filtering` di dalam VM; root hanya di dalam VM).
   - Trunk sisi server: VLAN PXE ber-tag ke `pxe-test-server`, yang memakai sub-interface ber-tag.
   - Port node: trunk dengan VLAN PXE native (untagged) dan VLAN management ber-tag.
   - Nomor VLAN dan subnet ditentukan architect di plan.
3. **Pelonggaran batas keras (disetujui user).** "PXE/DHCP/TFTP hanya di jaringan virtual terisolasi
   `pxe-test`" diperluas menjadi: hanya di network libvirt terisolasi berprefix `pxe-test-`.
   - Semua network itu tanpa `<forward>`, tanpa `<dhcp>` libvirt, dan tanpa interface fisik.
   - dnsmasq tetap hanya di VM `pxe-test-server`, wajib `bind-interfaces` pada interface VLAN PXE.
     Wajib diverifikasi dengan `ss -lunp`.
   - Semua batas keras lain tetap berlaku: tanpa sudo di host, resource terlindungi, cleanup, curl/wget.
4. **Akses ke node di VLAN ber-tag.** Host tidak bisa membuat sub-interface VLAN tanpa sudo, dan hook
   `guard_bash.py` hanya mengizinkan ssh dari host ke `10.99.0.*`. Hook tidak diubah. Verifikasi SSH ke
   node dijalankan dari dalam `pxe-test-server`:
   - Host menjalankan `ssh -i .agent/keys/<infra> <user>@10.99.0.2 'bash -s' < verify-vlan.sh`.
   - Script itu memakai key sekali pakai node yang disalin ke VM server khusus untuk run tersebut, lalu
     dihapus saat cleanup.
   - Tujuan akhirnya hanya subnet VLAN uji di network `pxe-test-*`.
   - Tanpa `ProxyJump` dari host.
5. **Cakupan uji minimum.** Topologi ini wajib dibuktikan dengan alur E2E dashboard yang sama dengan M6:
   PXE boot → host muncul → konfigurasi (IP static di VLAN management + field VLAN) → Simpan & Install →
   Done → SSH dengan key yang di-inject → reboot dari disk.
   - Matriks: UEFI Ubuntu 24.04, BIOS Ubuntu 24.04, UEFI Debian 12, UEFI Rocky 9.
   - Uji negatif isolasi: node di port tanpa VLAN PXE tidak mendapat DHCP. dnsmasq tidak menjawab di
     segmen untagged/admin.
6. **Perubahan produk boleh.** Bila uji menemukan celah (misalnya validasi IP static terikat subnet PXE,
   atau generator VLAN salah), perbaikan masuk M7 dengan test. Rancangan perubahan dibuat architect.
7. **Teardown.** Di akhir M7 semua network dan VM `pxe-test-*` milik M7 dihapus, sama seperti M6-T16.
## Konsekuensi
- CLAUDE.md tidak diubah oleh agent. Pelonggaran §3 hanya berlaku lewat decision ini, untuk M7.
- Bila topologi tidak bisa dibangun tanpa sudo di host, M7 ditandai BLOCKED dan dijelaskan di report.
