# DEC-006: Aturan subnet untuk IP management statis
- Tanggal: 2026-11-05T06:22:00Z
- Milestone: 3
- Status: Accepted
## Konteks
Validasi server memakai subnet management tetap (`10.10.10.0/24` dari `pxe-nodes`) dan
mengabaikan `prefix` di payload; gateway tidak dicek (gap G3-1). Subnet akan bisa diatur di
halaman Settings (M4), dan lingkungan uji KVM memakai `10.99.0.0/24` (DEC-003).
## Opsi yang dipertimbangkan
1. Validasi berdasarkan `ip/prefix` dari payload — fleksibel, tetapi host bisa diberi IP di luar
   jaringan yang dilayani DHCP/PXE server.
2. Tolak bila `prefix` ≠ prefix subnet management; IP dan gateway wajib di dalam subnet management;
   aturan lain `pxe-nodes` (bukan network/broadcast/gateway/PXE server, di luar range dinamis,
   tidak bentrok) tetap.
## Keputusan
Opsi 2 (paling aman, konsisten dengan `pxe-nodes`). Subnet management diambil dari satu sumber
konfigurasi server (`MGMT_NETWORK` sekarang; Settings/ENV di M4, sehingga lingkungan KVM bisa
memakai `10.99.0.0/24` tanpa mengubah kode).
## Konsekuensi
- Payload dengan prefix lain mendapat 422 yang jelas dari server; form menampilkan error yang sama.
- M4 wajib menjadikan `MGMT_NETWORK` dapat dikonfigurasi (env/Settings).
