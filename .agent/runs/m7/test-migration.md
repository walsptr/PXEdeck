# Migrasi test M7

## DEC-025 §1: Debian `netcfg/no_default_route=true` (backend-dev, T2b)

Alasan: DHCP di VLAN PXE sengaja tidak memberi router (DEC-024 §3). Tanpa jawaban ini, d-i netcfg
berhenti di "Continue without a default route?" sebelum `preseed.cfg` diambil. Buktinya ada di
`.agent/runs/m7/kvm/smoke/run2-debian/pxe-test-m7vlansmoke-node43-console-screen.txt`. Parameter ini
selalu dikirim. netcfg hanya membaca template `netcfg/no_default_route` bila DHCP tidak memberi
gateway, jadi topologi flat M6 (ada router) tidak terpengaruh. Asersi lama tidak dilemahkan: setiap
golden tetap berupa string lengkap yang persis, dan hanya ditambah satu token atau satu baris.

### 1. Golden cmdline Debian: `dashboard/src/lib/server/boot-script.test.ts` ("Debian: netboot + preseed/url")
- Sebelum: `kernel http://10.99.0.2/media/debian-netboot/linux initrd=initrd auto=true priority=critical url=${BASE.configUrl}preseed.cfg interface=auto netcfg/dhcp_timeout=60 console=ttyS0,115200n8 console=tty0 ---`
- Sesudah: `kernel http://10.99.0.2/media/debian-netboot/linux initrd=initrd auto=true priority=critical url=${BASE.configUrl}preseed.cfg interface=auto netcfg/dhcp_timeout=60 netcfg/no_default_route=true console=ttyS0,115200n8 console=tty0 ---`

### 2. Inline snapshot: `dashboard/src/app/boot/boot-routes.test.ts` ("Debian (preseed) dan Rocky (kickstart) sesuai §2.3 (snapshot)")
- Sebelum: `... interface=auto netcfg/dhcp_timeout=60 console=ttyS0,115200n8 console=tty0 ---`
- Sesudah: `... interface=auto netcfg/dhcp_timeout=60 netcfg/no_default_route=true console=ttyS0,115200n8 console=tty0 ---`

### 3. Golden preseed: `dashboard/src/test/golden/installers/debian-preseed.cfg` dan `debian-preseed-auto-disk.cfg`
- Ditambah satu baris setelah `d-i netcfg/choose_interface select auto`:
  `d-i netcfg/no_default_route boolean true`
- Alasannya: preseed dibuat konsisten dengan cmdline untuk kasus netcfg dijalankan ulang setelah preseed
  dimuat. Baris lain tidak berubah.

### Tidak diubah
- Fixture `KCMD.preseed` di `installers/installers.test.ts`. Fixture ini adalah input evaluasi URL
  callback, bukan asersi output `installerScript`.
- Fixture log sintetis `src/test/installer-logs/synthetic/di-syslog.log`.

Test baru: `dashboard/src/lib/server/m7-debian-no-route.test.ts` (4 test). Log mutasi ada di
`.agent/runs/m7/mutation-dev-T2b.txt`.
