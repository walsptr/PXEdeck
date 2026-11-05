# DEC-016: Timeout Booting absolut dan flag insecure lease di production
- Tanggal: 2026-11-06T01:30:00Z
- Milestone: 5
- Status: Accepted
## Konteks
Gate M5 iterasi 1 (`.agent/runs/m5/gate-iter1.md`) meminta dua decision.
- **CR-5-2:** timeout tahap Booting dihitung dari entri stage `booting` terakhir. Setiap kali installer
  dilayani, entri baru ditambahkan, sehingga batas efektifnya (N+1)×timeout. DEC-014 §2 menyebut
  timeout "absolut", sementara M5-plan §2.3 bisa dibaca sebaliknya.
- **SR-5-4:** `PXE_INSECURE_NO_LEASE_CHECK=1` tetap diterima saat `NODE_ENV=production` dan hanya
  memunculkan peringatan. Kalau flag ini aktif bersama `PXE_TRUST_PROXY=1`, risiko SR-4-2 terbuka kembali.
## Keputusan
1. **CR-5-2: timeout Booting absolut, dikerjakan di M5 iterasi 2.** Batas tahap Booting dihitung dari entri
   `booting` **pertama** pada job tersebut. Penyajian ulang installer tidak mereset timer, tetapi tetap
   tercatat sebagai event. Tahap Installing dan Configuring tetap dihitung dari entri pertama tahapnya
   (tidak berubah). Wajib ada test dengan ≥ 2 penyajian installer yang membuktikan timeout dihitung dari
   penyajian pertama.
2. **SR-5-4: ditunda ke M6 sebagai risiko yang diterima sementara.** Di M6 server wajib menolak start bila
   `NODE_ENV=production` dan `PXE_INSECURE_NO_LEASE_CHECK=1`, kecuali ada konfirmasi kedua yang eksplisit
   (pola yang sama dengan `PXE_SEED=demo`). Ini menjadi syarat gate M6, bersama SR-4-1 (login + rate
   limit) dan SR-5-3. Sampai M6, dashboard hanya dipasang di lab terisolasi (REPORT-m4, Risiko).
## Konsekuensi
- M5 iterasi 2 menambah perubahan kecil di `job-lifecycle`/watchdog beserta test-nya. Jalur boot dan
  installer tidak berubah, jadi bukti KVM M5 tetap berlaku.
- Mengoreksi DEC-014 §2: "absolut" berarti sejak pertama kali job memasuki tahap tersebut.
