# DEC-015: Cakupan M5 — allowlist nginx sebelum login, status Offline, registrasi OS image
- Tanggal: 2026-11-05T15:00:00Z
- Milestone: 5
- Status: Accepted
## Konteks
Tiga hal di M5 menyimpang dari jadwal/SPEC dan perlu jejak decision. Opsi: `docs/design/M5-options.md`
O9, O11, O12.
## Keputusan
1. **Mitigasi SR-4-1 (O9) — syarat gate M5:** sebelum login (M6), nginx di server membatasi UI dan
   `/api/**` ke IP admin yang dikonfigurasi (`allow <admin>; deny all`); `/boot/**` dan `/media/**`
   tetap terbuka untuk klien PXE. Allowlist Host juga berlaku untuk GET `/api/**`. Login admin + rate
   limit tetap wajib di M6 dan menjadi blocker gate M6.
2. **Status Offline (O11):** tidak ada transisi otomatis ke `offline` di M5. Host yang Done lalu boot
   dari disk tidak lagi menghubungi dashboard, sehingga heuristik last-seen akan menandai semua host
   sehat sebagai Offline. Pill `Offline` tetap ada di design system; deteksi keaktifan dicatat sebagai
   pekerjaan lanjutan. Ini mengamandemen jadwal M4-plan §1.
3. **OS Images (O12):** halaman OS Images di M5 mendukung registrasi image dari path media lokal di
   server PXE. Registrasi dari URL jarak jauh (unduh ISO) ditunda ke pekerjaan lanjutan — penundaan
   sebagian SPEC §4 "registrasi ISO/URL" — karena menambah unduhan besar dan validasi integritas di luar
   cakupan uji lab.
## Konsekuensi
- AC M5 memuat cek allowlist dari node KVM (`/api` → 403, `/boot` → 200).
- Laporan akhir mencatat Offline otomatis dan registrasi URL sebagai fitur SPEC yang belum lengkap.
