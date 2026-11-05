# Review keamanan M3 — iterasi 1

- Reviewer: security-reviewer · Branch `milestone/1-3-baseline` @ `8f4b2d7`
- Acuan: SPEC §6, `docs/design/M3-plan.md` (AC-3.3, 3.5, 3.8, 3.9, 3.14; risiko "password di
  memori/log"), DEC-005, DEC-006
- Scope M3: sheet konfigurasi & bulk, `PATCH /api/hosts/[id]`, `POST /api/hosts/bulk`,
  `POST /api/hosts/[id]/install`, `POST /api/hosts/bulk/install`, `GET /api/hosts/[id]/config`,
  `POST /api/credentials/import`, `GET /api/ssh-keys`, generator password, CSV, SSH key.

## Temuan

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| SR-3-1 | major | dashboard/src/lib/credentials.ts:26-27; dashboard/src/components/host-config/passwords-dialog.tsx:49-57; credentials.ts:85-93 (`toCsv`) | **CSV/formula injection pada unduhan password sekali-tampil.** Alfabet `generatePassword` (64 karakter) memuat `-`, `+`, `=`, `@`; `toCsv` tidak menetralkan sel berawalan karakter formula. Peluang password diawali salah satunya = 4/64 = 6,25% per host (3 host ≈ 18%, 20 host ≈ 72%). Dibuka di Excel/LibreOffice, sel seperti `=Kx7…`/`+23…`/`-ab…`/`@x…` dievaluasi sebagai formula → tampil `#NAME?`/angka, dan bila file disimpan ulang nilai aslinya hilang. Karena password acak **hanya ditampilkan sekali** (SPEC §6) dan CSV adalah satu-satunya salinan, ini menyebabkan kehilangan credentials (harus generate ulang). Data tidak dikendalikan penyerang (username/hostname/MAC tervalidasi tanpa awalan formula), jadi bukan eksekusi formula berbahaya — tetapi melanggar integritas rahasia sekali-tampil. | Pilih salah satu (lebih disukai keduanya): (a) karakter pertama password selalu alfanumerik; (b) `toCsv` untuk file unduhan menetralkan sel yang diawali `= + - @ \t \r` (mis. awali `'` — untuk password lebih aman opsi (a) agar nilai tidak berubah). Tambah unit test: 10.000 password tidak ada yang diawali `[=+\-@]`, dan `toCsv` menetralkan sel formula. |
| SR-3-2 | minor | dashboard/src/lib/server/http.ts:37-49; dashboard/src/app/api/hosts/[id]/install/route.ts:10-18; dashboard/src/app/api/hosts/bulk/route.ts:6-12; dashboard/src/app/api/hosts/bulk/install/route.ts:5-10 | **CSRF lintas-origin tanpa preflight.** `readJson` memanggil `req.json()` tanpa memeriksa `Content-Type`, sehingga `fetch` mode `no-cors`/form `text/plain` dari situs mana pun dapat mengirim body JSON ke `POST /api/hosts/bulk` (ganti credentials/SSH key ke milik penyerang) dan `POST /api/hosts/bulk/install`; `POST /api/hosts/[id]/install` bahkan tanpa body. Install = wipe disk host. Saat ini mock dan auth adalah scope M6, tetapi M4 menjadikan endpoint ini nyata sebelum auth ada. | Tolak `Content-Type` selain `application/json` di `readJson` (415), dan tolak `Origin` asing di semua handler pengubah state. Tambahkan test. Wajib selesai paling lambat M4. |
| SR-3-3 | minor | dashboard/src/lib/server/http.ts:41 | Tidak ada batas ukuran body sebelum parse: `req.json()` membaca seluruh body ke memori; batas zod (`csv` 200 KB, `customStorage` 20 KB, `publicKey` 16 KB, 500 host) baru berlaku setelah parse. Endpoint tanpa auth → DoS memori mudah. | Cek `Content-Length` dan/atau baca stream dengan batas (mis. 1 MB) → 413 sebelum `JSON.parse`. |
| SR-3-4 | minor | dashboard/src/lib/server/config-service.ts:96-114 | `checkCredentialsCsv` mengembalikan `mac: rawMac.trim()` apa adanya bila MAC tidak valid. Baris CSV dengan urutan kolom salah atau hanya 1 kolom (mis. user menempel `password` saja) membuat **plaintext password terpantul** di respons `POST /api/credentials/import` dan di tabel preview, bertentangan dengan AC-3.9 "respons tidak memuat password". | Untuk MAC invalid kembalikan nilai tersamar/terpotong (mis. `""` atau 17 karakter pertama yang hanya `[0-9a-f:.-]`), atau jangan echo sama sekali; tambah test baris 1-kolom berisi password. |

## Verifikasi yang lulus (info)

- I-3-1 **Hash SHA-512 crypt**: `config-service.ts` memakai `unixcrypt.encrypt(password)` per
  host di dalam loop (mode same/random/csv) → `$6$` dengan salt acak (`node:crypto.randomInt`,
  diverifikasi di `node_modules/unixcrypt/dist/index.js`). Test `config-routes.test.ts:208-221`
  memverifikasi `verify()` dan salt berbeda antar host untuk password sama. Rounds default 5000
  (setara `openssl passwd -6`) — memadai untuk crypt installer.
- I-3-2 **Plaintext tidak disimpan**: store hanya menyimpan `passwordHash`; `toPublicConfig`
  membuang hash (`hasPassword` saja); test `config-routes.test.ts:272` memastikan respons GET
  config tanpa `$6$`. Tidak ada `console.*` di `src/` (tidak ada logging password).
- I-3-3 **Password acak sekali**: `generatedPasswords` hanya ada di respons sukses mode `random`
  (`applyConfigPrepared`), tidak disimpan server; dialog klien hanya memegangnya di state sampai
  ditutup. Generator: `crypto.getRandomValues` + rejection sampling (seragam), panjang 12–64.
- I-3-4 **Validasi server**: zod struktural (`host-config.ts`, batas `LIMITS`) + semantik di
  `config-service.ts`: IPv4 ketat (tolak oktet ber-nol-depan), subnet/prefix/gateway DEC-006,
  network/broadcast/gateway/PXE/range dinamis/bentrok; hostname RFC1123 huruf kecil; username
  `^[a-z_][a-z0-9_-]{0,31}$` + user sistem; password 8–128 tanpa CR/LF; disk `^/dev/[A-Za-z0-9/_-]+$`;
  iface `^[a-zA-Z0-9._-]{1,15}$`; SSH key: tipe whitelist, blob base64 dicek tipe internalnya,
  private key ditolak, opsi `authorized_keys` (`command=`…) tertolak karena token pertama wajib
  tipe, `normalized` menggabung ulang dengan spasi tunggal (tanpa newline). Penerapan atomik
  sinkron. Pesan error zod hanya `path + message` (nilai input tidak dipantulkan).
- I-3-5 **XSS**: semua data host/CSV/key dirender lewat JSX; tidak ada sink HTML mentah. Unduhan
  memakai `Blob` + `URL.createObjectURL` lalu `revokeObjectURL`.
- I-3-6 **Bukti `.agent/runs/m3/**`**: log tidak memuat password/hash. Screenshot
  `ac-3.14-passwords-dialog.png` kolom password di-mask. `ac-3.14-csv-preview.png` menampilkan
  `DUMMY_PASSWORD` (`Fixture-Pass-7319`) dan `pendek` di textarea CSV — nilai dummy fixture
  (diizinkan plan M3 §risiko), bukan secret. Catatan: pernyataan `ac-matrix.md:22` hanya mencakup
  log, bukan screenshot.
- I-3-7 **Untuk M4 (template installer)**: field bebas yang akan masuk ke user-data/kickstart/
  preseed — `customStorage` (≤ 20 KB, tanpa validasi isi), nama key SSH (≤ 64, charset bebas),
  komentar key, password (boleh karakter kontrol selain CR/LF) — wajib di-escape/serialisasi
  aman (YAML lib, bukan string concat). Pertimbangkan menolak karakter kontrol di password.
- I-3-8 **Auth & token per-MAC**: belum ada (M4/M6). Tidak ada kode M3 yang mengklaim
  perlindungan auth.
- I-3-9 `npm audit --omit=dev`: 0 critical/high (lihat SR-1-1).

## Ringkasan

| Severity | Jumlah |
|---|---|
| critical | 0 |
| major | 1 (SR-3-1) |
| minor | 3 |
| info | 9 |

Tidak meng-approve; keputusan ada di gatekeeper.
