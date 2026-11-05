# Review kode M3 — iterasi 2 (code-reviewer)

- Branch `milestone/1-3-baseline` @ ed30b1e; dibandingkan dengan iter1 (`git diff 8f4b2d7..ed30b1e`).
- Dibaca: review-code-iter1.md, gate-iter1.md, ac-matrix-iter2.md, `*-iter2.log`, diff semua file `src/` dan `e2e/`.
- Dijalankan ulang: typecheck 0, lint 0, `npm run test:unit` **359/359 lulus**, `playwright test --list`
  58 test/9 file. E2E dari `e2e-iter2.log` (58 passed, exit 0; server KVM-env :3106 ikut berjalan).
- `vitest.config.mts`: hanya `allowOnly: false`; ambang/include/exclude DEC-004 tidak berubah.
- Infrastruktur bersama CR-1-1: **closed** (lihat m1/review-code-iter2.md).

## Status temuan iter1

| ID | Sev. iter1 | Status | Bukti |
|---|---|---|---|
| CR-3-1 | major | **closed** | `dashboard/src/lib/net.ts:191-200`: IP awal di luar subnet langsung ditolak ("IP awal di luar subnet <cidr>") tanpa iterasi. `:205-214`: `budget` = ukuran subnet membatasi total kandidat. Test `src/lib/net.test.ts:204-243`: di bawah network/di atas broadcast (range & increment), subnet non-default, `1.1.1.1`/`0.0.0.1` ×40 < 50 ms, budget habis → "Range IP tidak cukup". E2E `iter2-ui.spec.ts` (start 10.10.10.11 di subnet 192.168.50.0/24 → error, Simpan nonaktif). |
| CR-3-2 | major | **closed** | Endpoint baru `src/app/api/network/route.ts` (sumber `getMgmtNetwork()` yang sama dengan validasi server, no-store, env rusak → 500). Hook `src/hooks/use-network-config.ts`; `config-sheet.tsx:118-180` meneruskan `net` ke form. `form-state.ts:119-136` (`defaultIpRange`, `initialForm(…, mgmt)`), `:201` `mgmtOf`, dan `ipPlan`/`sectionErrors` memakai `mgmtOf(ctx)`. `tab-network.tsx` tidak lagi memakai `MGMT_NETWORK`. Bukti end-to-end: `e2e/iter2-network-env.spec.ts` (server env 10.99.0.0/24): default .11–.99, preview, simpan 200; IP lab ditolak UI **dan** API 422 dengan pesan yang sama; 10.99.0.45 diterima keduanya. Unit: `form-state.test.ts:239-296`, `hooks.test.ts:193-230`, `iter2-routes.test.ts:59-130`. |
| CR-3-3 | minor | **closed** | `src/lib/server/config-service.ts:143, :300, :496-515`: `touches` per langkah; `updated` dan `updatedAt` hanya untuk host yang diubah. Test `iter2-routes.test.ts:386-417`. |
| CR-3-4 | minor | **open** (diterima gatekeeper, M4) | `getConfig` masih lazy-create di GET dan validasi (`mock-hosts.ts:361`, `config-service.ts:502-505` sengaja tetap membuat config untuk semua host batch). |
| CR-3-5 | minor | **closed** | `form-state.ts:347-352`: key gagal parse → `sectionErrors` (blokir simpan). `:428-431`: payload membuang teks "PRIVATE KEY" (berlapis). `tab-ssh.tsx:34-58`: parse sinkron, query key hanya `type` + blob public key yang lolos parse. E2E `m3-sheet.spec.ts:84-108` (field-error persis, ringkasan "Key baru #1: …", tab "(ada error)", Simpan nonaktif → aktif setelah key valid); unit `form-state.test.ts:298+`. |
| CR-3-6 | minor | **closed** | `passwords-dialog.tsx:46-64, :93-96, :142-156`: state di-reset per batch `passwords`; Escape/overlay di-`preventDefault`; tanpa tombol X; Selesai nonaktif sampai unduh atau checkbox konfirmasi dicentang. E2E `iter2-ui.spec.ts` "CR-3-6" (2 test, termasuk batch kedua terkunci lagi). |
| CR-3-7 | minor | **closed** (= SR-3-1) | `src/lib/credentials.ts:31, :49-53` (karakter pertama dari `ALNUM`), `:96-117` (`neutralizeCsvCell` sebelum quoting). Unit `credentials.test.ts:96-125` (10.000 password, netralisasi `= + - @ TAB CR`); E2E memeriksa CSV unduhan tanpa sel formula. |
| CR-3-8 | minor | **open** (diterima gatekeeper) | `form-state.ts:303-307`: bulk "same" tanpa password tetap ditolak klien (lebih ketat dari API, aman). |
| CR-3-9 | minor | **partially** | Server: `config-service.ts:333-339` IP host = gateway payload → 422; `net.ts:105-108` gateway di range dinamis ditolak (dipakai klien dan server). Test `iter2-routes.test.ts:418+`, `net.test.ts:245-261`. **Sisa:** klien (`form-state.ts:205-215` `ipUsageFor`) tidak memasukkan gateway payload, sehingga UI menerima IP host = gateway lalu server membalas 422 saat simpan. Lihat CR-3-14. |
| CR-3-10 | minor | **closed** | `e2e/m3-bulk.spec.ts:66-68, :87, :133-134`: urutan preview IP, preview hostname, dan `hostIds` payload dibandingkan dengan urutan tabel **tanpa sort**. |
| CR-3-11 | minor | **closed** | `e2e/m3-bulk.spec.ts:23-38` `expectNoSaveRequest`: `waitForRequest` 1,5 dtk harus timeout dan daftar request kosong; dipakai di `:209, :245`. |
| CR-3-12 | minor | **partially** (diterima, M4) | Komentar plaintext dan hash lab dihapus (`mock-hosts.ts:256-260`, test G-SEC-2). Public key admin nyata `wals@wal` masih ada sebagai seed (`mock-hosts.ts:245-252`). |
| CR-3-13 | minor | **closed** | `config-sheet.tsx:120-160`: config host atau `/api/network` gagal → Alert destruktif + pesan server + "Coba lagi"; form tidak dirender dari default. E2E `iter2-ui.spec.ts` "CR-3-13" (2 test, termasuk refetch → form berisi IP tersimpan). |

## Review kode/test baru
- `planIps`: pengecekan di luar subnet dilakukan setelah `isIpv4`. `ipToInt` toleran spasi (`Number(" 10")`), jadi `cur` konsisten dengan `spec.start.trim()`. Benar.
- `applyConfigPrepared`: gateway payload dimasukkan ke `usage` hanya bila belum dipakai host lain, sehingga pesan bentrok host lain tetap diutamakan. `steps.every(st => st.touches)` bernilai benar untuk daftar kosong (updated 0), tetapi skema payload mensyaratkan minimal satu bagian, jadi tidak terjadi.
- `checkCredentialsCsv`: MAC/username invalid di-echo sebagai `""`, sesuai AC-3.9.
- Perubahan test M3: locator pesan error SSH dipersempit ke `[data-slot=field-error]` dengan `toHaveText` persis, karena teks yang sama kini juga muncul di ringkasan. Ini lebih ketat, dan ringkasan juga diassert. Sort di sisi asersi dihapus (lebih ketat). `waitForTimeout` diganti `waitForRequest`-timeout. Tidak ada pelemahan.
- E2E baru `iter2-network-env` / `iter2-ui` mengassert payload, status respons, isi tabel, dan config API, bukan hanya tampilan. Screenshot dialog password memakai `mask`.

## Temuan baru

| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-3-14 | minor | dashboard/src/components/host-config/form-state.ts:205-215 (vs src/lib/server/config-service.ts:333-339) | Sisa CR-3-9: aturan server "IP host ≠ gateway payload" tidak ada di klien. Single host dengan IP = gateway yang diketik user (mis. gateway .5, IP .5) lolos validasi UI dan baru ditolak 422 saat simpan. Dalam bulk, `planIps` bisa mengalokasikan IP = gateway. UI lebih longgar dari API, berbeda dengan prinsip AC-3.7/3.13. | Di `ipPlan`, tambahkan `form.network.gateway` ke `usage.used` (label "gateway …") sebelum `validateIpAssignments`/`planIps`, lalu tambah unit test. |
| CR-3-15 | minor | dashboard/src/lib/net.ts:205-214 | Budget iterasi = ukuran subnet. Untuk subnet besar dari env (mis. /8–/12) dengan IP awal di dalam range DHCP dinamis yang lebar dan `skipUsed`, `planIps` tetap bisa memeriksa jutaan kandidat per render. Hanya terjadi lewat konfigurasi env, bukan input user biasa. | Lompati range dinamis secara langsung (`cur = hi + 1`), atau batasi budget ke konstanta (mis. 65 536) dengan error yang jelas. |
| CR-3-16 | minor | dashboard/src/components/host-config/config-sheet.tsx:120-143 | Bila `GET /api/network` gagal, seluruh Sheet diblokir, termasuk tab yang tidak butuh parameter jaringan (OS, Credentials, SSH, Hostname tanpa `{ip_last_octet}`). Ini konservatif dan aman, tetapi mengurangi ketersediaan. | Bisa diterima; opsional: blokir hanya tab Network / preview yang bergantung subnet. |

## Ringkasan
| Severity | Terbuka |
|---|---|
| critical | 0 |
| major | 0 (CR-3-1, CR-3-2 closed; CR-1-1 bersama closed) |
| minor | 7 (CR-3-4, CR-3-8 open diterima; CR-3-9, CR-3-12 partial; CR-3-14, CR-3-15, CR-3-16 baru) |
