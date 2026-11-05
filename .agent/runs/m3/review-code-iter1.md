# Review kode M3 — iterasi 1 (code-reviewer)

- Branch `milestone/1-3-baseline` @ 8f4b2d7 · Lingkup: Sheet konfigurasi, bulk, validasi server, API M3 (AC-3.1–3.15)
- Dibaca: `docs/SPEC.md`, `docs/design/M3-plan.md`, DEC-004/005/006, `.agent/runs/m3/*`
- Dijalankan ulang: typecheck 0, lint 0, unit 243/244 (gagal hanya AC-2.2). E2E dari `e2e.log`.
- Bukti tambahan CR-3-1: `planIps` (src/lib/net.ts) dijalankan langsung dengan Node
  `--experimental-strip-types`, 3 host, mode increment, `skipUsed=true`: start `10.10.9.0` → 2 ms,
  `10.9.0.0` → 115 ms, `10.0.0.0` → 889 ms per panggilan (linear terhadap jarak ke subnet).

## Temuan

| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-3-1 | major | dashboard/src/lib/net.ts:171-207 (dipanggil dari src/components/host-config/form-state.ts:200-218, 238, 287, 371 dan tab-network.tsx:46) | `planIps` tidak membatasi titik awal ke subnet: bila IP awal valid tetapi di bawah alamat network dan `skipUsed=true` (default UI), loop memeriksa setiap IP satu per satu sampai masuk subnet. Diukur ~0,9 s per panggilan untuk `10.0.0.0`; untuk `1.1.1.1` ≈ 150 juta iterasi (puluhan detik). `ipPlan` dipanggil beberapa kali per render (preview, `sectionErrors`, `hostnamePlan`), jadi mengetik/menempel IP awal di luar subnet membekukan tab browser. | Tolak lebih awal bila `start` (dan `end`) di luar subnet ("IP awal di luar subnet …"), atau clamp `cur` ke `network+1`; batasi jumlah iterasi. Tambah unit test start di luar subnet. |
| CR-3-2 | major | dashboard/src/components/host-config/form-state.ts:18, :142, :149-151, :205, :216, :296; dashboard/src/components/host-config/tab-network.tsx:47-50, :101 | Server memakai subnet dari env `PXE_MGMT_*` (`lib/server/net-config.ts`, diuji AC-3.7 "subnet env"), tetapi form selalu memvalidasi/mengisi default dengan `MGMT_NETWORK` hard-coded (10.10.10.0/24, start `10.10.10.11`). Saat env dipakai (KVM 10.99.0.0/24, DEC-003/006) UI menandai setiap IP valid sebagai "Di luar subnet" dan menonaktifkan simpan, sementara IP 10.10.10.x lolos UI lalu ditolak 422. Melanggar konsekuensi DEC-006 ("form menampilkan error yang sama") dan prinsip AC-3.7/3.13 "UI dan API sama-sama menolak". | Ekspos parameter subnet aktif ke klien (mis. `GET /api/settings/network` atau prop dari server component) dan teruskan `net` ke `planIps`/`validateIpAssignments`/`validateStaticNetwork`/default form. Bila ditunda ke M4, catat di decision dan matikan override env sampai klien ikut. |
| CR-3-3 | minor | dashboard/src/lib/server/config-service.ts:282-300, :487, :497 | Mode CSV: host terpilih yang tidak ada di CSV tidak diubah (UI memberi tahu), tetapi respons tetap `updated: hosts.length` dan `updatedAt` semua host di batch diperbarui → toast "Konfigurasi N host disimpan" berlebih. | Hitung `updated` dan set `updatedAt` hanya untuk host yang benar-benar berubah. |
| CR-3-4 | minor | dashboard/src/lib/server/config-service.ts:240; dashboard/src/app/api/hosts/[id]/config/route.ts:15; dashboard/src/lib/server/mock-hosts.ts:358-365 | `getConfig` membuat konfigurasi default secara lazy, termasuk di fase validasi (sebelum keputusan atomik) dan di handler GET. Tidak teramati di store mock, tetapi di M4 (DB) ini menjadi write pada jalur baca/validasi. | Pisahkan `peekConfig` (tanpa side effect) untuk validasi/GET. |
| CR-3-5 | minor | dashboard/src/components/host-config/form-state.ts:317-321; dashboard/src/components/host-config/tab-ssh.tsx:36-49 | Klien tidak memblokir simpan untuk key baru yang gagal di-parse (hanya cek kosong/nama), sehingga teks private key yang ditempel tetap dikirim ke server saat simpan (server menolak 422). Teks itu juga menjadi query key react-query (`["ssh-key-info", publicKey]`) dan tinggal di cache. | Jadikan error parse key sebagai `sectionErrors` (blokir simpan) dan jangan memakai isi key mentah sebagai query key (pakai hash atau `useMemo`/state). |
| CR-3-6 | minor | dashboard/src/components/host-config/passwords-dialog.tsx:64-69, :118 | Tombol "Tutup tanpa mengunduh"/"Selesai" memanggil `onClose()` langsung, sehingga `setDownloaded(false)` tidak terjadi (Radix tidak memanggil `onOpenChange` saat prop `open` berubah) → dialog berikutnya menampilkan "Selesai" sebelum mengunduh. Escape/klik overlay juga menutup dialog tanpa konfirmasi, padahal ini satu-satunya kesempatan melihat password. | Reset state saat `passwords` berubah; cegah tutup via Escape/overlay sebelum unduh atau minta konfirmasi. |
| CR-3-7 | minor | dashboard/src/lib/credentials.ts:26-27, :83-91 | Alfabet password acak memuat `= + - @`; ±6 % password diawali karakter itu dan `toCsv` tidak menetralkannya, sehingga CSV yang dibuka di spreadsheet dievaluasi sebagai formula (tampil `#NAME?`/terubah). | Jangan pakai `=+-@` sebagai karakter pertama (atau keluarkan dari alfabet), atau beri prefiks/quote aman saat ekspor. |
| CR-3-8 | minor | dashboard/src/components/host-config/form-state.ts:273-277 | Bulk mode "same" dengan password kosong selalu ditolak di klien, sedangkan server menerima bila semua host sudah punya password (AC-3.8) — UI lebih ketat dari API. | Teruskan info `hasPassword` per host (atau biarkan server memutuskan) untuk bulk. |
| CR-3-9 | minor | dashboard/src/lib/net.ts:96-99, :131 | IP host hanya ditolak bila sama dengan gateway/PXE server dari konfigurasi server, bukan gateway dari payload; gateway payload juga boleh berada di range DHCP dinamis atau sama dengan IP host lain. | Tolak IP host = gateway payload; validasi gateway terhadap range dinamis. |
| CR-3-10 | minor | dashboard/e2e/m3-bulk.spec.ts:33-39, :48-49 | Komentar "Urutan host di Sheet = urutan tampilan tabel", tetapi kedua sisi di-`sort()` sebelum dibandingkan sehingga urutan tidak diuji (asersi lemah, AC-3.14 tetap terbukti oleh pemetaan IP). | Bandingkan urutan baris preview dengan urutan baris tabel tanpa sort. |
| CR-3-11 | minor | dashboard/e2e/m3-bulk.spec.ts:188, :224 | "Batal tidak mengirim request" dibuktikan dengan `waitForTimeout(300)` lalu cek daftar request — bisa lolos palsu bila request terkirim > 300 ms kemudian. | Tunggu kondisi stabil (mis. `expect.poll` selama ±1 s, atau `page.waitForLoadState('networkidle')`) sebelum assert kosong. |
| CR-3-12 | minor | dashboard/src/lib/server/mock-hosts.ts:244-258, :274-275 | Seed menyimpan hash dengan komentar yang menyebut password plaintext lab ("ubuntu") dan public key admin nyata (`wals@wal`); host seed otomatis punya credentials sehingga bisa di-install tanpa admin mengatur password. Dinilai lebih lanjut oleh security-reviewer (aturan "tanpa password plaintext di repo"). | Hapus plaintext dari komentar; pakai key/hash fixture dummy; pastikan default ini tidak terbawa ke persistence M4. |
| CR-3-13 | minor | dashboard/src/components/host-config/config-sheet.tsx:115, :135-145 | Bila `GET /api/hosts/:id/config` gagal, form tetap dirender dengan nilai default tanpa pesan error (mis. `hasPassword=false` → meminta password ulang). | Tampilkan state error + tombol coba lagi; jangan render form dari default saat load gagal. |

## Kesesuaian AC (ringkas)
AC-3.1–3.11 diuji langsung di unit/integration dengan asersi ketat (pesan error persis,
SHA-512 crypt + `unixcrypt.verify`, salt berbeda, atomisitas dengan snapshot before/after, race
G3-2 paralel, fingerprint = `ssh-keygen`). AC-3.12–3.15 E2E memeriksa payload request, status
respons, toast, perubahan tabel, unduhan CSV, dan tidak bocornya password. Tidak ada test yang
di-skip/dilemahkan. Dua bug nyata (CR-3-1, CR-3-2) belum tertangkap test.

## Ringkasan
| Severity | Jumlah |
|---|---|
| critical | 0 |
| major | 2 (CR-3-1, CR-3-2) |
| minor | 11 |
