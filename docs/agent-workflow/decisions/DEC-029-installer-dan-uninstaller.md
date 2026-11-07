# DEC-029: Script install dan uninstall PXE server + dashboard (M8)
- Tanggal: 2026-11-07
- Milestone: 8 (permintaan user setelah M7)
- Status: Accepted
## Konteks
User meminta script bash untuk memasang dan mencopot seluruh sistem di server sungguhan: PXE server
(dnsmasq, TFTP/iPXE, nginx, NFS, media) beserta dashboard. Sampai M7, deploy hanya tersedia sebagai
tooling lab (`infra/server-base.sh`, `provision-root.sh`, `deploy-dashboard.sh`, `install-dashboard.sh`)
yang terikat ke VM `pxe-test-server` dan alamat `10.99.0.*`.
## Keputusan
1. **Artefak.** `install.sh` dan `uninstall.sh` di root repo, dijalankan sebagai root di server
   Ubuntu 24.04 target. Template konfigurasi diambil dari `infra/server/` dan diparametrisasi, bukan
   disalin ulang. Dokumentasi pemakaian masuk ke README §Deploy.
2. **Install** wajib:
   - Konfigurasi bisa interaktif (prompt) atau non-interaktif (flag/env/file config). Parameter:
     NIC provisioning, IP server/CIDR, range DHCP, gateway, DNS, admin username + password (password
     di-hash lewat stdin, tidak pernah ada di argv/log), dan opsional topologi VLAN
     (`PXE_VLAN_NETWORKS`, sub-interface VLAN PXE).
   - Paket apt (dnsmasq, nginx, nfs-kernel-server, ipxe, dan lain-lain). Node 22 dari nodejs.org dengan
     verifikasi SHA256.
   - User `pxe`, direktori `/srv/pxe/*`, biner iPXE, build dashboard standalone (atau tarball rilis),
     rilis di `/opt/pxe-dashboard/releases/<ts>` + `current`.
   - `/etc/pxe-dashboard.env` mode 0640 root:pxe, unit systemd, site nginx, dnsmasq **terikat ke NIC
     yang dipilih** (`interface=` + `bind-interfaces`), ekspor NFS read-only.
   - Opsional: mount ISO media (Ubuntu/Debian/Rocky).
   - Verifikasi di akhir: `ss -lunp` dnsmasq hanya di NIC itu, `/login` 200, `/api/settings` tanpa sesi
     401. Bila gagal, dnsmasq dihentikan.
   - Idempoten (aman diulang, termasuk upgrade dashboard), punya `--dry-run`, dan mencatat manifest
     file yang dipasang.
   - Menolak berjalan bila bukan root, OS bukan Ubuntu 24.04, NIC tidak ada, atau terdeteksi DHCP lain
     di segmen itu (kecuali dipaksa eksplisit).
3. **Uninstall:**
   - Menghentikan dan menonaktifkan layanan, lalu menghapus semua file yang tercatat di manifest
     (config dnsmasq/nginx/NFS/systemd, rilis, env).
   - Default **mempertahankan data**: DB, `/srv/pxe/media`, ISO. `--purge` ikut menghapus data, user
     `pxe`, dan `/srv/pxe`. `--remove-packages` opsional.
   - Tidak menyentuh file yang tidak tercatat di manifest. Punya `--dry-run`.
4. **Uji wajib:**
   - Test shell dry-run.
   - **KVM:** VM Ubuntu 24.04 bersih berprefix `pxe-test-` (bukan base server lab yang sudah
     diprovision) → `install.sh` non-interaktif → satu node UEFI PXE boot → install Ubuntu lewat
     dashboard → Done + SSH key → `install.sh` diulang (idempoten) → `uninstall.sh` (layanan mati, port
     tertutup, file manifest hilang, data tetap) → `uninstall.sh --purge`.
   - Semua batas keras CLAUDE.md tetap berlaku (lab terisolasi, tanpa sudo di host).
5. **Review dan gate** mengikuti CLAUDE.md, dengan code review dan security review.
## Konsekuensi
- Branch `milestone/8-installer`. Commit atas nama user tanpa atribusi AI.
