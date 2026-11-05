# DEC-002: Kode M1–M3 yang sudah ada diperlakukan sebagai baseline yang wajib lolos gate
- Tanggal: 2026-11-05T05:42:00Z
- Milestone: 1, 2, 3
- Status: Accepted
## Konteks
Sebelum workflow ini dibuat, UI milestone 1–3 (layout + tokens, tabel host mock, sheet
konfigurasi & bulk, API mock in-memory) sudah ditulis dalam satu sesi tanpa test otomatis dan
tanpa review terpisah (hanya verifikasi manual di browser). Aturan workflow: kode ditulis,
diuji, dan direview oleh subagent; Orchestrator tidak menulis kode produk.
## Opsi yang dipertimbangkan
1. Tulis ulang M1–M3 dari nol oleh dev agent — paling murni, tetapi membuang kode yang sudah
   berjalan; biaya tinggi tanpa nilai tambah.
2. Terima kode apa adanya tanpa gate — melanggar aturan approval.
3. Perlakukan kode sebagai baseline: commit di branch `milestone/1-3-baseline`, lalu jalankan
   Plan → Test → Review → Gate per milestone (1, 2, 3) dengan AC terpisah. Semua perbaikan oleh
   frontend-dev/backend-dev; kepemilikan kode berpindah ke dev agent.
## Keputusan
Opsi 3. Satu branch untuk ketiga milestone karena kodenya saling terkait; tiap milestone tetap
punya plan, AC, gate, APR, dan tag sendiri (`m1-approved`, `m2-approved`, `m3-approved`).
## Konsekuensi
- Riwayat git tidak memisahkan M1/M2/M3 per commit awal; jejaknya ada di plan/gate/approval.
- Reviewer menilai kode lengkap, bukan diff kecil.
- Tag M1 dan M2 bisa menunjuk commit yang sudah mengandung kode M3 (dicatat di APR).
