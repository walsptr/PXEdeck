# DEC-019: Idle sesi saat polling, kontras pill Done, dan filter axe
- Tanggal: 2026-11-06T12:00:00Z
- Milestone: 6
- Status: Accepted
## Konteks
Laporan frontend-dev M6 (commit `c731383`) mengangkat tiga hal yang belum diatur DEC-017:
1. Polling 5 dtk di halaman dashboard lewat `requireSession` selalu memperpanjang idle, sehingga sesi tidak
   pernah habis karena idle selama tab terbuka. AC-6.32 (sesi habis → redirect sekali) tidak bisa dicapai
   lewat idle.
2. Pill Done (teks putih di atas `#c08532`, 3,2:1) diwajibkan SPEC tetapi tidak ada di daftar pengecualian
   kontras DEC-017 §9.
3. axe menghitung warna campuran di dalam Sheet (kemungkinan efek `backdrop-filter` overlay) walau
   elemen tidak memakai opacity/overlay.
## Keputusan
1. **Idle sesi.** Setiap request ber-sesi, termasuk polling, tetap memperpanjang idle (perilaku sekarang
   dipertahankan; tidak ada perubahan backend). Batas absolut `PXE_SESSION_MAX_HOURS` (default 12 jam)
   adalah batas atas yang menjamin sesi berakhir. AC-6.32 diuji lewat pencabutan sesi di sisi server
   (logout dari konteks lain, kedaluwarsa absolut dengan jam injeksi di integration, atau baris sesi
   dihapus), bukan lewat menunggu idle. Ini dicatat di README "Asumsi keamanan".
2. **Kontras pill Done.** Pasangan teks putih di atas token status Done SPEC ditambahkan ke daftar
   pengecualian 1.4.3 DEC-017 §9. Label teks pill tetap wajib ada (warna bukan satu-satunya penanda).
   Pengecualian tidak berlaku untuk kombinasi lain.
3. **Filter axe Sheet.** Test E2E boleh mengecualikan temuan `color-contrast` axe **hanya** untuk elemen di
   dalam Sheet yang warna komputasinya (getComputedStyle + `elementsFromPoint`) terbukti memenuhi
   ≥ 4,5:1 atau termasuk pasangan pengecualian. Filter harus berupa fungsi bernama dengan test sendiri,
   dan jumlah temuan yang difilter dicatat di bukti. Mengecualikan aturan axe secara keseluruhan dilarang
   (= pelemahan test).
## Konsekuensi
- Tidak ada perubahan kode backend untuk idle sesi.
- `test-migration.md` dan bukti axe M6 mencatat filter #3 beserta jumlahnya.
