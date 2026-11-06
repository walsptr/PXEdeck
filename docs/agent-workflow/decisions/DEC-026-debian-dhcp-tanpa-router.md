# DEC-026: Debian d-i dengan DHCP tanpa router (lanjutan DEC-025)
- Tanggal: 2026-11-06
- Milestone: 7
- Status: Accepted
## Konteks
Smoke run 3 (commit bukti `6b973a5`) menunjukkan perbaikan DEC-025 bekerja: prompt default route hilang.
Namun d-i lalu berhenti di `netcfg/get_nameservers` sebelum `preseed.cfg` diambil. Akar masalahnya sudah
dikonfirmasi dari source bookworm (`run3-debian-fix/…-root-cause-src.txt`):
- Script `udhcpc` busybox-udeb berjalan dengan `sh -e`. Tanpa opsi router, perintah
  `ip route add default via ""` gagal, sehingga script berhenti sebelum `/etc/resolv.conf` dan
  `/tmp/domain_name` ditulis.
- Akibatnya netcfg tidak melihat nameserver dan bertanya di prioritas critical. Preseed belum dimuat,
  jadi tidak bisa menjawab.

Ubuntu dan Rocky tidak terdampak. Ini keterbatasan installer Debian 12 pada VLAN PXE tanpa router.
## Keputusan
1. **Perbaikan produk dicoba sekali lagi (opsi a).** Baris perintah kernel Debian ditambah
   `netcfg/get_nameservers=<DNS jaringan PXE>`, yaitu DNS yang dibagikan DHCP. Di lab ini nilainya
   `PXE_SERVER_IP`.
   - Bila dibuktikan perlu, tambahkan juga `netcfg/get_domain=<domain>` dan jawaban netcfg lain yang
     diminta sebelum preseed dimuat. Semuanya harus berupa nilai literal dari Settings, tanpa token atau
     secret.
   - netcfg hanya menanyakan nameserver bila tidak ada nameserver dari DHCP, sehingga topologi flat
     dengan router tidak berubah perilakunya.
   - Disertai test yang merah bila di-revert.
2. **Batas.** Bila smoke Debian berikutnya masih tertahan di prompt netcfg lain sebelum preseed dimuat,
   M7 tidak mengejar prompt satu per satu.
   - Lab memakai opsi b: DHCP VLAN PXE memberi router `10.99.10.1` (alamat yang tidak dipakai, tanpa
     forwarding), khusus untuk membuktikan Debian.
   - Syarat production dicatat di `infra/README.md` dan REPORT-m7: **Debian 12 d-i membutuhkan opsi
     router DHCP di VLAN PXE.**
   - Keputusan ini cukup dicatat di report, tanpa DEC baru.
3. **Celah `verify-listen-vlan.sh` (temuan test-engineer T7/T9) ikut diperbaiki.** Verifikasi wajib
   menuntut dnsmasq benar-benar listen di `%pxe10:67`, tidak cukup "service aktif". Bila gagal,
   dnsmasq dihentikan.
4. **Regresi flat.** Karena baris perintah kernel Debian berubah untuk semua topologi, suite KVM M7
   menyertakan satu run Debian di topologi flat (`kvm-run.sh … --scenario distro`, node Debian saja)
   sebagai bukti regresi M6.
## Konsekuensi
- backend-dev mengerjakan §1 dan §3. test-engineer mengulang smoke node43, lalu menjalankan suite penuh.
