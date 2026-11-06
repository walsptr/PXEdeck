# DEC-022: Cakupan iterasi 2 M6 dan teks "media tidak tersedia"
- Tanggal: 2026-11-06T23:00:00Z
- Milestone: 6
- Status: Accepted
## Konteks
Gate M6 iterasi 1 (`.agent/runs/m6/gate-iter1.md`) memberi CHANGES_REQUESTED karena DR-6-1 (major). Gatekeeper
mewajibkan R1–R8 dan meminta keputusan Orchestrator untuk R3 (DR-6-3). Ada konflik antara DR-4-5 (alasan "media
tidak tersedia" sengaja `muted` karena itu keterbatasan, bukan error) dan DEC-017 §9 (informasi penting dan label
status tidak boleh `muted`).
## Keputusan
1. **R3 / DR-6-3 → opsi (a).** Alasan "Media … tidak tersedia" memakai `text-body` dengan ikon info, tidak merah.
   DR-4-5 tetap berlaku dalam arti "bukan error": tidak memakai warna destructive. Tidak ada pengecualian baru
   terhadap DEC-017 §9.
2. **DEC-021 ditegakkan fail-closed (R4).** `[trusted=yes]`, `allow_unauthenticated` dan pembersihan
   `00AllowUnauthenticated` hanya berlaku bila sumber media Debian adalah server PXE lokal (host media =
   `PXE_SERVER_IP`). Selain itu generator tidak mengeluarkan `trusted=yes` atau `allow_unauthenticated true`, dan
   install Debian dengan media eksternal yang tidak bertanda tangan ditolak (422) dengan pesan jelas. Pembersihan
   dijalankan sebelum langkah firstboot (SR-6-6).
3. **Cakupan iterasi 2.** Wajib: R1–R8 dari gate. Ikut dikerjakan karena murah dan berisiko rendah:
   - SR-6-4: gabungkan baris base64 ter-wrap, tetap linear (SR-5-11). Bila tidak bisa linear, catat sebagai sisa
     risiko + fixture.
   - CR-6-1: batas total byte `authorized_keys` per host (422 di UI dan API) dan error generator di atas batas
     aman `late_command`.
   - SR-6-3 / CR-6-6: peringatan start saat production tanpa `PXE_TRUST_PROXY=1` + catatan README.
   - DR-6-4: ring fokus input lebih kuat.
   - DR-6-6, DR-6-7, DR-6-8.
   Ditunda (carry-over di REPORT-final): CR-6-2 (Windows tidak dilayani) dan semua temuan info.
4. **Bukti ulang.** Mengikuti gate-iter1 §"Bukti ulang iterasi 2". Karena cakupan §3 menyentuh validasi config,
   redaksi dan startup (di luar batas reuse gatekeeper), **ketiga run KVM `core`, `bulk`, `distro` dijalankan ulang**
   di commit final iterasi 2.
## Konsekuensi
- Frontend, backend dan test-engineer bekerja paralel dengan pembagian file yang tidak tumpang tindih.
- Setiap perbaikan disertai test yang merah bila di-revert (DEC-018 §6).
