# Code review M8 (installer): iterasi 2

Verdict: PASS (tidak ada temuan critical/major terbuka; keputusan akhir di gatekeeper)

Cakupan: `1a64ffd..06517b9` (commit 3d60aa9 DEC-030 + 06517b9 perbaikan KVM iter2) pada install.sh, uninstall.sh,
deploy/*, infra/server, infra/install-vm.sh, README.md, infra/test/m8.sh, infra/test/fake-bin-m8. Dilihat juga
infra/test/m8-kvm/run.sh (CR-8-14) dan bukti `.agent/runs/m8/kvm/iter2/` (hanya dibaca).
Yang dijalankan: `bash infra/test/run.sh` (sekuensial, 3m52s) menghasilkan **169 lulus, 0 gagal, exit 0**. `bash -n` pada
semua script yang berubah: bersih. shellcheck tidak terpasang.

## Status temuan iterasi 1
| ID | Status | Bukti |
|---|---|---|
| CR-8-1 | Selesai | verify memfilter `pid=<MainPID dnsmasq.service>,`; uninstall memakai `systemctl is-active` hanya untuk ours/pre-disabled; test i2 CR-8-1/2 |
| CR-8-2 | Selesai | alamat v4/v6 dari `ip -o addr show dev $IFACE` diterima, begitu juga `%IFACE`; wildcard tanpa `%dev` tetap FAIL |
| CR-8-3 | Selesai | `pkg_pre dnsmasq` + baris aktif di /etc/dnsmasq.conf, dnsmasq.d/* (README/.dpkg-*/~ dikecualikan) menyebabkan die sebelum ada mutasi; KVM refuse-dnsmasq |
| CR-8-4 | Selesai | sama untuk exports, exports.d/*.exports, nfs.conf.d/*.conf; KVM refuse-nfs |
| CR-8-5 | Selesai | validasi `netplan generate --root-dir` sebelum dipasang, rollback di cleanup, parent dicari sebagai kunci di 4 jenis, bond/bridge yang tidak terdefinisi ditolak, nama 99- |
| CR-8-6 | Selesai | `apt-get -s purge` (Purg/Remv, arch dibuang) dibandingkan dengan manifest; simulasi gagal = tolak (fail-closed); dep dicek ulang |
| CR-8-7 | Selesai | upstream: eksplisit > DNS lain > `resolv-file` (tanpa no-resolv) > none; test render + KVM nodedns |
| CR-8-8 | Selesai | default site dihapus hanya bila nginx ours |
| CR-8-9 | Selesai | `pre-disabled` dicatat dan dipulihkan |
| CR-8-10 | Selesai | `DPkg::Lock::Timeout=600` di semua apt-get |
| CR-8-11 | Selesai | ICMPv6 ND, `nft -c -f`, peringatan FIREWALL=no |
| CR-8-12 | Selesai | drift owner diperbaiki dan CHANGED=1 (restart) |
| CR-8-13 | Selesai | BDIR dihapus di trap |
| CR-8-14 | Selesai | DB wajib ada bila ada di state-before (lihat CR-8-25) |
| CR-8-15 | Selesai | hanya `PXE_INSTALL_NODE_VERSION` + peringatan |
| CR-8-16 | Selesai | Release.gpg → gpgv → Release SHA256 → SHA256SUMS → file. File dipasang hanya setelah semua cocok |
| CR-8-17 | Selesai | `valid_iso_path` menolak path di bawah root yang bisa dihapus; uninstall juga menjaga sumber fstab |

## Verifikasi kode baru
- **gpgv VALIDSIG:** tidak bisa di-bypass. VALIDSIG hanya muncul untuk tanda tangan yang sah dari kunci di `--keyring` yang diberikan. Satu BADSIG/EXPSIG/EXPKEYSIG/REVKEYSIG saja sudah membuat penolakan. Status hanya dibaca dari fd 1. Teks yang dikendalikan penyerang (notation, uid) di-escape gpg dan tidak bisa menyuntik baris `[GNUPG:]`. Kasus ERRSIG/NO_PUBKEY ditoleransi seperti apt. Release lama yang di-replay (stable tanpa Valid-Until) tetap mungkin, tetapi itu batasan yang sama dengan apt (info, bukan temuan).
- **umount:** ekspor dilepas dan nfs ours dihentikan sebelum umount. Bila umount gagal, entri mount dan fstab di-keep, manifest ditulis, lalu exit≠0 di akhir. Rerun berhasil tuntas (diuji). --purge tidak menghapus data yang masih memuat mount (`mounted_under`).
- **vlanlink:** entri tervalidasi (`valid_iface`, `parent:vid`, tanpa karakter glob). Penghapusan hanya bila link masih `dev@parent`, `802.1Q id vid` cocok persis, dan tanpa alamat. Selain itu entri di-keep dan muncul peringatan. Aman.
- **Migrasi/rollback netplan:** 60- dibackup lalu dihapus, 99- dipasang. Bila gagal, 60- dipulihkan, 99- dihapus/dipulihkan, lalu `netplan apply`. Urutannya benar karena rollback berjalan sebelum `rm -rf $TMP` (lihat CR-8-19).
- **Preflight refusal:** dijalankan sebelum manifest/apt. Glob yang tidak cocok ditangani.
- **Owner drift:** OK. put_file kini menjalankan chown setelah mv. Celah sesaat dengan root:root 0640/0600 lebih ketat, jadi tidak masalah.

## Perubahan test lama
Tidak ada pelemahan. Perubahan yang ada mengikuti nama/argumen baru: `NODE_VERSION` → `PXE_INSTALL_NODE_VERSION`, apt `-o DPkg::Lock::Timeout=600`, 60- → 99-, `--admin-overlap-ok` untuk allowlist lab yang memang di subnet PXE, `chown` di path final. Filter log mutasi mengecualikan `netplan generate --root-dir` (read-only). Tidak ada skip. 4 test i3 baru menyasar keempat bug KVM.

## Temuan baru
| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-8-18 | minor | uninstall.sh:111-116, 186-189 | nfs-server `pre` di-restart di langkah 2 saat `/etc/nfs.conf.d/pxe-dashboard.conf` masih ada (baru dihapus di langkah 4). Langkah 5 `pre` hanya menjalankan `exportfs -ra`, sehingga nfsd admin tetap berjalan dengan `[nfsd] host=<IP PXE>` / `[mountd] port=` installer sampai restart berikutnya. Dampaknya kecil karena pre dengan ekspor lain sudah ditolak saat install. | Restart `pre` di langkah 5 (setelah NFS_CONF dihapus). Di langkah 2 cukup `exportfs -ra`. |
| CR-8-19 | minor | install.sh:470 | Rollback memulihkan 60-pxe-dashboard.yaml dengan `cp` ke path yang sudah tidak ada, sehingga file dibuat dengan mode umask (0644, bukan 0600) dan netplan memberi peringatan "too open". Jalur rollback migrasi juga tidak punya test. | `install -m 0600` / `cp -p`. Tambahkan test: migrasi 60- + `FAKE_NETPLAN_APPLY_RC=1`, lalu asersikan 60- pulih dan 99- hilang. |
| CR-8-20 | minor | install.sh:727-731 | Root sementara hanya menyalin `/etc/netplan/*.yaml`. Definisi parent di `/run/netplan` atau `/lib/netplan` (terlihat oleh `netplan get` saat deteksi parent) membuat validasi gagal palsu. Hasilnya fail-closed (install ditolak), tidak merusak. | Salin juga `/lib/netplan` dan `/run/netplan` ke root sementara. |
| CR-8-21 | minor | install.sh:748 | `vlanlink` hanya dicatat bila link dibuat run ini atau sudah tercatat. Install ulang di atas instalasi lama (60- milik installer, link sudah ada, tanpa entri vlanlink) tidak pernah mencatatnya, sehingga uninstall tetap meninggalkan link (bug KVM iter2 #3 tersisa untuk jalur upgrade). | Catat juga bila `manifest_owns NETPLAN_FILE(_OLD)` dan link adalah VLAN `vid`@`NIC`. |
| CR-8-22 | minor | uninstall.sh:482 | Cek "tanpa alamat" ikut menghitung inet6 link-local. Di host yang mempertahankan fe80 setelah netplan berhenti mengelola link, link tidak pernah dihapus (aman, hanya peringatan). | Abaikan `scope link`. |
| CR-8-23 | minor | install.sh:185-197 | Mode `resolv` tidak memeriksa apakah `/run/systemd/resolve/resolv.conf` ada (systemd-resolved dimatikan), sehingga dnsmasq diam-diam tanpa upstream. `--dns-upstream` juga diam-diam diabaikan bila `--dns` tidak memuat IP server. | `warn` atau fallback ke `/etc/resolv.conf` bila bukan stub 127.0.0.53, dan beri peringatan untuk DNS_UPSTREAM yang tidak terpakai. |
| CR-8-24 | minor | uninstall.sh:385-394 | Bila satu paket `requested` sudah dihapus admin dan tidak dikenal apt lagi, `apt-get -s purge` exit 100 dan muncul "(simulasi gagal)", sehingga `--remove-packages` terblokir permanen. | Saring `req` ke paket yang masih terpasang (`dpkg-query`) sebelum simulasi. |
| CR-8-25 | minor | infra/test/m8-kvm/run.sh (kriteria DB) | `grep … state-before-$lbl.txt 2>/dev/null`: bila file state-before tidak ada, kriteria DB terlewati tanpa jejak. Hash juga tidak dibandingkan. | Anggap state-before yang hilang sebagai FAIL dan bandingkan sha256 pxe.db. |

## Ringkasan
- critical: 0
- major: 0
- minor: 8 (CR-8-18 … CR-8-25)
- CR-8-1 … CR-8-17: semuanya selesai.
