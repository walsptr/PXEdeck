# DEC-008: Token per job untuk file konfigurasi dan callback per-MAC
- Tanggal: 2026-11-05T07:06:00Z
- Milestone: 4
- Status: Accepted
## Konteks
SPEC §6: file konfigurasi per host berisi hash password dan hanya boleh diambil MAC/IP yang
sesuai, idealnya dengan token sekali pakai. cloud-init, d-i, dan anaconda mengambil beberapa file
dari prefix yang sama dan bisa mengulang fetch. Opsi: `docs/design/M4-options.md` §O2.
## Opsi yang dipertimbangkan
1. Token sekali pakai per request/file — merusak multi-fetch installer.
2. Token per job (sekali pakai per instalasi) + binding MAC/IP + jendela tahap + TTL.
3. URL bertanda tangan HMAC — tidak bisa dicabut tanpa daftar cabut; kunci bocor = semua URL palsu.
## Keputusan
Opsi 2: token 32 byte acak (base64url) dibuat saat install; DB hanya menyimpan `sha256(token)`.
File di `/boot/{mac}/{token}/{file}` dilayani hanya bila hash cocok dengan job aktif, MAC path =
MAC host, job `booting|installing`, belum lewat TTL (default 6 jam), dan IP sumber termasuk IP
lease dnsmasq untuk MAC itu. Callback status diterima sampai `done|failed` dari IP lease ∪ IP
management host. Token dicabut saat done/failed/install ulang/hapus host/expiry. Semua penolakan
→ 404 seragam; alasan dicatat tanpa token.
## Konsekuensi
- Token tidak boleh muncul di log server, log nginx, log console yang di-commit, maupun bukti;
  test-engineer wajib memindai bukti (`grep` pola token) sebelum commit.
- Autentikasi admin dashboard dan API tetap pekerjaan M6.
