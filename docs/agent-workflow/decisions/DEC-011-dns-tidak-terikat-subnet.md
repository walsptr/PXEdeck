# DEC-011: Server DNS tidak wajib berada di subnet management
- Tanggal: 2026-11-05T09:30:00Z
- Milestone: 4
- Status: Accepted
## Konteks
AC-4.5 (`docs/design/M4-plan.md`) menulis "gateway/DNS/server di luar subnet → error" untuk
validasi env. Implementasi M4-T1 juga menerapkannya ke DNS per host di payload, sehingga test M3
yang memakai DNS `1.1.1.1` gagal. SPEC §3.2 hanya meminta "DNS (multiple)" dengan validasi
format; lab asli memakai DNS forwarder `192.168.122.1`/`1.1.1.1` di luar subnet provisioning.
## Opsi yang dipertimbangkan
1. DNS wajib di subnet management (env dan payload) — mematahkan konfigurasi wajar (DNS publik
   lewat gateway NAT) dan regresi terhadap M3 yang sudah APPROVED.
2. DNS cukup IPv4 valid (bukan 0.0.0.0, bukan broadcast/multicast/loopback), tanpa batas subnet,
   untuk env maupun payload. Gateway dan PXE server tetap wajib di subnet (DEC-006).
## Keputusan
Opsi 2. Bagian "DNS di luar subnet" pada AC-4.5 dibatalkan; sisa AC-4.5 tetap. Test M3 yang ada
tidak boleh diubah untuk mengakomodasi aturan lama.
## Konsekuensi
- `validateStaticNetwork`/settings env menolak DNS hanya karena format atau alamat khusus.
- Di lingkungan KVM terisolasi DNS default tetap `10.99.0.2`/`10.99.0.1`, jadi uji KVM tidak berubah.
