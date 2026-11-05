# M5 — bug produk yang ditemukan test-engineer (M5-T11..T15)

Kode produk TIDAK diubah oleh test-engineer. Setiap butir memuat repro; Orchestrator menugaskan dev.

## BUG-M5-1 (minor, UI/API) — jumlah "dipakai" pada 409 hapus OS image tidak sama dengan `usedBy`

- Lokasi: `dashboard/src/lib/server/db/repos/os-images.ts` `imageUsage()` (dipakai
  `library-service.ts` `removeOsImage` → pesan `OS image dipakai ${used} host/job`) vs
  `imageHostCount()` (dipakai `usedBy` di `GET /api/os-images`).
- `imageUsage` menjumlahkan tiga `count(*)` (hosts.os_assigned + host_configs.os_profile + job
  aktif) sehingga SATU host yang punya config dengan image itu dan `os_assigned` yang sama dihitung
  2×; `imageHostCount` memakai `UNION` (host unik) → 1.
- Dampak: tabel OS Images menampilkan "dipakai 1 host", dialog hapus menampilkan 409 "OS image
  dipakai 2 host/job" untuk host yang sama. Plan M5 §2.8 menyebut 409 "dipakai N host" tampil;
  N saat ini tidak konsisten dengan kolom tabel. Tidak ada dampak keamanan/data (penghapusan tetap
  ditolak dengan benar).
- Repro (E2E `m5-library`, server DB kosong):
  1. `POST /api/ssh-keys` lalu satu host dikonfigurasi `PATCH /api/hosts/525400990061` dengan
     `os.osImageId = "ubuntu-24.04"` (helper `makeHost` di `dashboard/e2e/m5-support.ts`).
  2. `GET /api/os-images` → `ubuntu-24.04.usedBy = 1`.
  3. `DELETE /api/os-images/ubuntu-24.04` → 409 `{"error":"OS image dipakai 2 host/job"}`.
- Test: `e2e/m5-library.spec.ts` › AC-5.27 "Daftarkan image…" mengasersikan pesan 409 sesuai AC-5.27
  (`/OS image dipakai \d+ host/`), bukan angka; kesenjangan angka dicatat di sini (bukan disembunyikan).
  Saran perbaikan: hitung pemakaian dengan `UNION` host unik (seperti `imageHostCount`) atau tampilkan
  `usedBy` di pesan, lalu tambahkan asersi angka = `usedBy` di test itu.
- Asal: fungsi `imageUsage` sudah ada di M4 (`main`), tetapi baru terlihat di UI sejak halaman OS
  Images M5 menampilkan kedua angka berdampingan.
- **Status: fixed in commit "fix(m5): BUG-M5-1 …" (hash: `git log --grep=BUG-M5-1 -1 --format=%h`)** (backend-dev): `imageUsage()` kini = `imageHostCount()`
  (UNION host unik), sehingga N di 409 = `usedBy`. Regresi: `db.test.ts` › "imageUsage menghitung host
  unik = imageHostCount/usedBy", `m4-api-routes.test.ts` › "409 hapus: N di pesan = usedBy …"
  (keduanya merah pada kode lama: 6≠4 dan "dipakai 7"≠"dipakai 5"), dan `e2e/m5-library.spec.ts` ›
  AC-5.27 mengasersikan angka 409 = kolom `usedBy` (test-migration #17).

## Catatan (bukan bug, info)

- I-1: `ORDER BY created_at DESC, id` di `listJobs`/`listJobsForHost` — dua job satu host dengan
  `created_at` identik (milidetik sama) diurutkan menurut UUID acak. Tidak terjadi pada alur nyata
  (install ulang hanya setelah job sebelumnya final), tetapi test yang membuat job pada jam injeksi
  yang sama harus memajukan jam (dilakukan di `m5-te-lifecycle-routes.test.ts`).
- I-2: `callbackCmd` (perilaku M4) tetap memanggil `curl` dengan URL kosong bila cmdline tidak cocok
  (MAC lain / token bukan 43 karakter); tidak ada request jaringan (curl gagal "no URL"), exit 0.
  Hook log M5 (`logCmd`/`logTailCmd`) dijaga `[ -n "$b" ]` sehingga tidak memanggil curl sama
  sekali. Diuji di `m5-te-hooks.test.ts`.
- I-3: `logTailCmd` mengirim `tail -n 60 | cut -c1-240` per file, plan §2.5 menyebut 100 baris
  sebagai kandidat ("backend-dev memverifikasinya … memilih file yang ada"). Bukan pelanggaran AC.

## Iterasi 2 — catatan test-engineer (info, bukan bug; arah aman/fail-closed)

Diamati saat meninjau `redact.ts` @ `fb8077e`, dengan probe vitest sementara yang sudah dihapus.
Kode produk tidak diubah.
- I-4 (over-redaksi footer yatim): `redactOrphanKeyTail` ikut menelan baris pendek alfanumerik atau
  kosong yang mendahului `-----END … PRIVATE KEY-----` tanpa BEGIN, walau baris itu bukan isi key.
  Contoh: `"langkah 3\nok\n\n-----END OPENSSH PRIVATE KEY-----\nselesai"` →
  `"langkah 3\n[REDACTED PRIVATE KEY]\nselesai"`, sehingga baris `ok` hilang. Dampaknya hanya
  kehilangan konteks log; tidak ada kebocoran.
- I-5 (over-redaksi segmen path): `TOKEN_PATH_PARTIAL_RE` (`{8,43}`) juga cocok dengan segmen bukan
  token setelah MAC. Contoh: `GET /boot/52:54:00:99:00:11/user-data 200` →
  `GET /boot/52:54:00:99:00:11/[REDACTED] 200`. Rute nyata selalu memuat token di posisi itu, jadi
  dampaknya hanya kosmetik.
- Sisa risiko yang diterima oleh desain CR-5-1 opsi (a): prefiks token terpotong < 8 karakter tidak
  diredaksi. Ini sudah diasersikan sebagai kasus negatif di `m5-iter2-redact-timeout.test.ts`.
