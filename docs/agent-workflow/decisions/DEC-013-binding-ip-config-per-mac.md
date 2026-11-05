# DEC-013: Binding IP untuk file konfigurasi dan callback per-MAC (amandemen DEC-008)
- Tanggal: 2026-11-05T14:58:40Z
- Milestone: 5
- Status: Accepted
## Konteks
DEC-008 menyebut file konfigurasi hanya untuk "IP lease dnsmasq untuk MAC itu". Implementasi M4
(APPROVED, APR-004) juga menerima `hosts.current_ip`, karena OVMF PXE dan iPXE dapat memperoleh
lease berbeda dan installer NFS-root dapat meminta lease baru (CR-4-21). Security review M4
menemukan bahwa tanpa file lease dan dengan `PXE_TRUST_PROXY=1`, `current_ip` dapat diisi IP
peminta mana pun (SR-4-2). Opsi: `docs/design/M5-options.md` §O10.
## Keputusan
File `/boot/{mac}/{token}/{file}` dilayani bila IP sumber ∈ (IP lease dnsmasq aktif untuk MAC
itu ∪ `hosts.current_ip`). Callback status (dan log installer M5) diterima bila IP sumber ∈
(himpunan tersebut ∪ IP statis konfigurasi host ∪ `hosts.mgmt_ip`). `hosts.current_ip` hanya
boleh diperbarui oleh request boot yang lolos verifikasi lease atau oleh callback yang sudah lolos
binding. Binding wajib fail-closed:
- server menolak start bila `PXE_TRUST_PROXY=1` tanpa `PXE_DNSMASQ_LEASES`, kecuali
  `PXE_INSECURE_NO_LEASE_CHECK=1` (hanya dev; diperingatkan di log start dan Settings);
- tanpa file lease dan tanpa flag itu, `/boot/{mac}.ipxe` tidak menerbitkan script installer
  maupun token (boot lokal);
- tanpa `PXE_TRUST_PROXY=1`, IP sumber tidak diketahui sehingga semua akses file/callback ditolak.
## Konsekuensi
- AC-4.23/AC-4.26 tetap berlaku; teks DEC-008 dibaca bersama amandemen ini.
- Kombinasi trust proxy × lease kosong × flag insecure wajib diuji (AC-5.2). Test M4 yang
  mengandalkan installer tanpa lease harus menyetel fixture lease atau flag secara eksplisit
  (pengetatan, bukan pelemahan).
