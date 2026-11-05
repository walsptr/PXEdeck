# M6 — migrasi test lama (backend-dev, T1–T3, T5)

Alasan umum: sejak M6 semua `/api/**` (kecuali `POST /api/auth/login`) butuh sesi admin (DEC-017 §4).
Test lama yang memanggil handler API kini membawa **sesi sungguhan**: admin test (username
`testadmin`, password acak per worker, hash scrypt dihitung saat runtime — tidak ada hash/password di
repo) dipasang oleh `isolateEnv`, dan cookie dibuat lewat `createSession` di DB lalu divalidasi oleh
guard produksi. **Tidak ada env/flag bypass auth**; guard tidak punya jalur khusus test.

Penegakan sesi diletakkan SETELAH pemeriksaan Host/Origin/Content-Type, sehingga test lama yang
mengasersi 403/415 tanpa cookie tidak perlu diubah dan tetap menguji perilaku yang sama.

## Helper (bukan file test, tapi memengaruhi semua test node)

| File | Perubahan | Alasan |
|---|---|---|
| `dashboard/src/test/auth.ts` (baru) | `TEST_ADMIN_*`, `testAdminHash()`, `sessionCookie()`, `authHeaders()` | sesi sungguhan untuk test |
| `dashboard/src/test/env.ts` | `isolateEnv` memasang env admin test sebagai default (dapat ditimpa `defaults`), reset rate limiter, throttle log `/boot`, penghitung SSE per test | state in-memory per proses tidak bocor antar test; env admin wajib untuk sesi |
| `dashboard/src/test/route.ts` | `getReq`/`jsonReq` menyertakan cookie sesi sungguhan (kecuali header `cookie` diberikan); `anonGetReq`/`anonJsonReq` baru untuk request tanpa sesi | semua route API butuh sesi |
| `dashboard/src/lib/server/db/reset.ts` (kode) | `resetDb` juga mengosongkan `sessions` | isolasi antar test |

## File test lama yang berubah

Hitungan asersi = jumlah `expect(` + `expectTypeOf(` (HEAD `31c506e` → working tree).
Perintah: `git show HEAD:<f> | grep -o 'expect(\|expectTypeOf(' | wc -l` vs file kerja.

| File | Sebelum | Sesudah | Perubahan & alasan |
|---|---:|---:|---|
| `src/app/api/iter2-routes.test.ts` | 75 | 75 | helper `rawReq` + request stream 1 MB menyertakan `authHeaders()` (sesi) — pemeriksaan 413/415/422 sesudah guard tetap teruji |
| `src/app/api/m4-api-routes.test.ts` | 74 | 75 | ekspektasi `toEqual` respons `/api/settings` ditambah `insecureConfirmed` + blok `auth` (AC-6.1); asersi baru: respons tidak memuat hash admin |
| `src/app/api/m5-jobs-api.test.ts` | 44 | 45 | (a) CR-5-6 / AC-6.21 (perubahan perilaku yang diputuskan plan §2.6): resume `Last-Event-ID: 1` kini mengirim ulang event 1 **tepat sekali** sebagai frame pertama; asersi lama `not.toContain("id: 1\n")` diganti `match(/\nid: 1\n/g)` panjang 1 + urutan sebelum id 2 (lebih ketat); (b) request SSE mentah + `authHeaders()` |
| `src/app/api/m5-te-api.test.ts` | 140 | 140 | request mentah (`new Request`) + `authHeaders()`; data frame SSE yang dibandingkan `toEqual` ditambah `lastAt` (CR-5-7, field kontrak baru); test resume `Last-Event-ID: 3` kini mengharapkan `[3, 4, …]` (CR-5-6) — nama test disesuaikan |
| `src/app/boot/boot-routes.test.ts` | 182 | 182 | test "log server tidak memuat token": `hostDELETE` + sesi; **bug test lama diperbaiki**: `vi.stubEnv("VITEST","")` membuat `PXE_DB_PATH` kosong jatuh ke file `./data/pxe.db` yang persisten antar run (test lulus hanya bila file belum ada) → dikunci `PXE_DB_PATH=:memory:` (DB yang sama yang di-reset `withDb`) |
| `src/components/jobs/jobs-components.test.tsx` | 19 | 19 | fixture `JobLogEvent` + `lastAt` (tipe wajib, CR-5-7/CR-5-9); asersi tidak berubah |
| `src/hooks/m4-hooks.test.ts` | 39 | 39 | fixture `OsImageInfo` + field M5 wajib (CR-5-9: tipe klien = tipe server, field tidak lagi opsional); asersi tidak berubah |
| `src/hooks/m5-jobs-hooks.test.ts` | 55 | 55 | fixture `ev()` + `lastAt` (= `at`); asersi tidak berubah |
| `src/lib/jobs.test.ts` | 49 | 49 | fixture `ev()` + `lastAt`; ekspektasi normalisasi `parseLogEvent` ditambah `lastAt` default = `at` |
| `src/lib/server/db/db.test.ts` | 152 | 152 | daftar tabel + `sessions`, indeks + `sessions_expires`, `schema_migrations` + versi 3 (migrasi 3 hanya menambah) |
| `src/lib/server/db/m5-jobs-repo.test.ts` | 43 | 47 | (a) test migrasi 2 membatasi `runMigrations` ke versi ≤ 2 (tetap menguji transisi v1→v2 persis); (b) CR-5-7 / AC-6.22 (perubahan perilaku dari plan): jendela gabung dihitung dari kemunculan **terakhir** — event `at(63)` kini digabung (repeat 3), event baru di `at(124)`; asersi baru untuk `lastAt` |
| `src/lib/server/db/m5-te-migration.test.ts` | 16 | 16 | `runMigrations` dibatasi ≤ v2 (test khusus transisi v1→v2); asersi identik |
| `src/lib/server/http.test.ts` | 44 | 44 | request `guardMutation` yang diharapkan `null` (lolos) kini membawa sesi |
| `src/lib/server/m5-settings.test.ts` | 29 | 29 | request `guardRead` yang diharapkan `null` membawa sesi |
| `src/lib/server/m5-te-unit.test.ts` | 58 | 60 | `infra/server/dashboard.env` kini memuat placeholder `@PXE_ADMIN_PASSWORD_HASH@` (hash disisipkan saat deploy, AC-6.53): asersi baru bahwa placeholder apa adanya DITOLAK settings; validasi nilai KVM lain memakai hash runtime |
| `src/lib/server/settings.test.ts` | 32 | 32 | ekspektasi `toEqual` respons settings + `insecureConfirmed` dan blok `auth` (admin tidak dikonfigurasi pada objek env itu) |

Tidak ada test yang dihapus, di-skip, atau dilonggarkan; `grep -n "\.skip\|\.only\|fixme"` pada file di
atas = 0. Test baru M6 (bukan migrasi): `src/lib/server/auth/{password,session,rate-limit}.test.ts`,
`src/app/api/auth/auth-routes.test.ts`, `src/app/api/m6-auth-matrix.test.ts`,
`src/app/api/m6-carryover-api.test.ts`, `src/lib/server/m6-backend.test.ts`, `src/lib/auth-next.test.ts`.

## Mutasi mandiri (revert → merah → dipulihkan, sha256 identik; skrip di scratchpad dev)

| Mutasi | Test yang merah |
|---|---|
| `sweepJobs` tanpa pra-cek (selalu `BEGIN IMMEDIATE`, CR-5-3) | `m6-carryover-api` CR-5-3 |
| percobaan login tidak dicatat sebelum verifikasi | `auth-routes` (lockout + race paralel) |
| sanitizer `next` tanpa lookahead `(?![/\\])` | `auth-next` |
| `guardMutation` membalik pengecualian `session:false` | `m6-auth-matrix` |
| SSE resume memakai `repeat` DB (perilaku lama, CR-5-6) | `m6-carryover-api` CR-5-6 |
| `installHosts` tanpa `sweepJobs` (CR-5-8) | `m6-carryover-api` CR-5-8 |
| sesi tanpa pemeriksaan sidik kredensial | `session.test` |
| SR-5-8 hanya menolak `\p{Cc}` | `m6-carryover-api` SR-5-8 |
| `logBootDenied` tanpa throttle (SR-5-3) | `m6-backend` SR-5-3 |
