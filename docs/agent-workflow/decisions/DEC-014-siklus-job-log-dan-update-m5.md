# DEC-014: Siklus hidup job, log installer, dan update otomatis (M5)
- Tanggal: 2026-11-05T15:00:00Z
- Milestone: 5
- Status: Accepted
## Konteks
M5 mewujudkan SPEC §3.1 (update otomatis), §4 (Provisioning Jobs: timeline + log streaming) dan §5
(callback status, host kembali ke boot lokal). Gate M4 mewajibkan CR-4-1 (installer dilayani
berulang selama `installing`) dan uji KVM `virsh destroy` → Failed → install ulang. Opsi lengkap:
`docs/design/M5-options.md` O1–O8, O13, O14.
## Keputusan
1. **Batas penyajian installer (O8, CR-4-1):** script installer hanya dilayani selama job `booting`,
   maksimal 3 kali per job (`jobs.installer_boots`). Selama `installing`/`configuring`, `/boot/{mac}.ipxe`
   melayani boot lokal tanpa rotasi token, sehingga callback yang sah tetap diterima. Lewat batas →
   job `failed` dengan `failure_reason = installer-boot-limit`.
2. **Watchdog (O6/O7):** sweep timeout dijalankan secara lazy pada setiap baca status (API/boot) plus
   timer in-process (`instrumentation.ts`); tanpa endpoint HTTP. Timeout absolut per tahap
   booting/installing/configuring = 60/120/60 menit (dapat diatur env; KVM installing 15 menit).
   TTL token ≥ jumlah ketiganya. Callback yang tiba setelah job `failed` ditolak. Job `failed` dapat
   di-install ulang (job baru).
3. **Model log (O3/O4):** tabel `job_events` (append-only, `seq` per job) + kolom `jobs.failure_reason`,
   `jobs.installer_boots`, `jobs.event_seq`. Ini perluasan model SPEC §5: `jobs.stages[]` diturunkan
   dari event, `jobs.logs` tidak dipakai. Retensi: maks 5000 event per job, 20 job final per host.
4. **Sumber log (O5):** event sisi server + endpoint `POST /boot/{mac}/{token}/log` (token & binding
   IP DEC-013, batas ukuran/laju, redaksi secret di server). Jalur sukses hanya mengirim penanda
   tetap dari generator; tail log installer hanya dikirim saat gagal. Tanpa webhook subiquity/syslog.
5. **Update otomatis (O1/O2):** tabel host dan daftar job memakai polling 5 detik (SPEC §3.1 mengizinkan);
   SSE hanya untuk `GET /api/jobs/:id/logs` (tail DB tiap 1 detik), dengan mode JSON dan fallback
   polling di UI.
6. **Pengujian (O13/O14):** timeout di E2E lokal diuji lewat webserver Playwright kedua dengan timeout
   pendek, tanpa seam test di kode produk. KVM M5: node UEFI `virsh destroy` saat Installing → start →
   boot lokal tanpa installer kedua → Failed `timeout-installing` → install ulang → Done → SSH; node BIOS
   jalur positif dengan log live, token acak ditolak, dan cek allowlist nginx dari node.
## Konsekuensi
- Test M4 yang mengasumsikan installer dilayani pada setiap boot diganti test perilaku baru ini
  (perubahan perilaku lewat decision, bukan pelemahan); dicatat di `test-migration.md`.
- Timeout terlalu pendek dapat menggagalkan install sah — nilai default konservatif, KVM memakai nilai
  khusus yang dicatat di bukti.
