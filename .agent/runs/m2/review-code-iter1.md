# Review kode M2 — iterasi 1 (code-reviewer)

- Branch `milestone/1-3-baseline` @ 8f4b2d7 · Lingkup: tabel host mock, API hosts, store mock (AC-2.1–2.14)
- Dibaca: `docs/SPEC.md`, `docs/design/M2-plan.md`, DEC-002/004/005, `.agent/runs/m2/*`
- Dijalankan ulang: typecheck 0, lint 0, `npm run test:unit` → **1 gagal** (`src/lib/format.test.ts`
  "2 hari → '2 hari yang lalu'"), 243 lulus. E2E dari `e2e.log` (42 lulus).

## Temuan

| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-2-1 | major | dashboard/src/lib/format.ts:1 (dibuktikan oleh src/lib/format.test.ts:30-34) | `Intl.RelativeTimeFormat("id", { numeric: "auto" })` menghasilkan "kemarin dulu" untuk −2 hari dan "kemarin" untuk −1 hari, bukan "2 hari yang lalu" seperti AC-2.2. Bug produk nyata, AC-2.2 tidak terpenuhi, dan `npm run test` exit 1 sehingga gate merah (coverage pun tidak dicetak tanpa `--coverage.reportOnFailure`). **Test-nya benar** (membandingkan dengan ICU runtime `numeric:"always"` + string literal AC) — bukan pelemahan; severity major (bukan critical) karena gate gagal secara jujur, bukan diloloskan. | Perbaiki di produk: `numeric: "always"`. **Jangan** mengubah/melonggarkan test. Tambah kasus 1 hari ("1 hari yang lalu") agar regresi "kemarin" tertangkap. |
| CR-2-2 | minor | dashboard/src/hooks/use-now.ts:300, :308-315, :329-336 | `now` modul hanya diperbarui oleh interval 15 dtk yang dihentikan saat tidak ada listener; `subscribe` tidak menyegarkan `now`, dan `syncServerClock` keluar lebih awal tanpa memperbarui `now` bila offset tidak berubah. Setelah pindah halaman lalu kembali ke /hosts (mis. 10 menit), "last seen" salah hingga 15 dtk. | Set `now = Date.now()` di `subscribe` saat timer dibuat dan di `syncServerClock` sebelum early-return. |
| CR-2-3 | minor | dashboard/src/components/hosts/columns.tsx:136-142 | Accessor hostname mengembalikan `""` untuk null, sehingga `sortUndefined: "last"` tidak berlaku — host tanpa hostname tampil paling atas saat sort naik. | Kembalikan `undefined` untuk hostname null (atau sortFn khusus). |
| CR-2-4 | minor | dashboard/src/components/hosts/columns.tsx:43-45 | `compact()` mempertahankan `.`, sehingga query MAC gaya Cisco `aabb.ccdd.eeff` (diterima `normalizeMac` di M3) tidak cocok dengan MAC tabel. Tiga format AC-2.7 lulus. | Hapus `.` saat membandingkan dengan MAC (tetap pertahankan untuk pencocokan IP). |
| CR-2-5 | minor | dashboard/src/app/api/hosts/[id]/route.ts:13-18; dashboard/src/app/api/ssh-keys/route.ts:10; dashboard/src/app/api/hosts/[id]/config/route.ts:15 | Hanya `GET /api/hosts` yang mengirim `Cache-Control: no-store`; GET host/config/ssh-keys (data yang berubah) tidak. | Samakan header `no-store` untuk semua GET API. |
| CR-2-6 | minor | dashboard/src/components/hosts/hosts-view.tsx:444 | Empty state menulis subnet `10.10.10.0/24` hard-coded, padahal sejak M3 subnet server dapat diatur lewat env (DEC-006) → teks bisa salah (mis. KVM 10.99.0.0/24). Sudah dicatat G2-4 (M4). | Ambil dari konfigurasi server di M4. |
| CR-2-7 | minor | dashboard/e2e/m2-polling.spec.ts:184 | AC-2.9 menyatakan host muncul "≤ 6 dtk", test mengizinkan 6,5 dtk dari request pertama. Toleransi melebihi teks AC. | Ukur ≤ 6 000 ms (atau ubah AC lewat plan bila toleransi jaringan memang dibutuhkan). |
| CR-2-8 | minor | dashboard/e2e/m2-hosts-table.spec.ts:91-93 | AC-2.10 "hitungan per status": hanya 4 dari 7 status yang dicek, dan `toContainText(String(count))` cocok dengan digit di mana saja dalam item (mis. "1"). | Cek ketujuh status dengan regex label+angka persis, mis. `^Done\s*6$`. |
| CR-2-9 | minor | dashboard/e2e/m2-hosts-table.spec.ts:2-3, :208-251; e2e/m3-*.spec.ts | E2E berbagi satu store mutable lintas file (hapus win-jump, reboot legacy-01/compute-03, lalu M3 bergantung pada keadaan setelahnya). Urutan file/eksekusi parsial (`--grep`) dan server yang di-reuse (CR-1-1) membuat hasil bergantung urutan. | Dokumentasikan ketergantungan atau buat tiap file memakai host yang disjoint; matikan reuse server. |
| CR-2-10 | minor | dashboard/src/components/hosts/columns.tsx:42-72 | Logika filter (`hostGlobalFilter`, `osFilter`, `statusFilter`) berada di `.tsx` sehingga di luar include coverage DEC-004 (`src/components/**/*.ts`); diuji unit tetapi tidak dihitung. | Pindahkan fungsi filter ke `columns-filters.ts` (DEC-004 menyebut opsi ini). |

## Kesesuaian AC (ringkas)
AC-2.1, 2.3–2.14 punya test yang mengassert hasil (skema zod route, fake timers per tahap,
404/204/400, interval polling, clipboard, `page.route` empty/error). AC-2.2 **gagal** (CR-2-1).
Validasi id 12-hex → 400 (G2-2) diimplementasikan konsisten.

## Ringkasan
| Severity | Jumlah |
|---|---|
| critical | 0 |
| major | 1 (CR-2-1) |
| minor | 9 |
