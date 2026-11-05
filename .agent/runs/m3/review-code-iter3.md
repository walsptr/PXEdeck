# Review kode M3 — iterasi 3

Diff yang direview: `git diff ed30b1e..76cd8ac` (541fb8d produk, 76cd8ac test + bukti), branch milestone/1-3-baseline. Hanya baca; tidak ada build/e2e yang dijalankan ulang. Rujukan: gate-iter2.md, review-*-iter2.md.

## Pemeriksaan bersama (M1–M3)

- **vitest.config.mts**: tidak berubah sejak fe6a353 (`git diff 8709a96..76cd8ac` kosong). Ambang `lines/branches 80`, include/exclude DEC-004 utuh, `allowOnly: false`.
- **playwright.config.ts**: `forbidOnly: true`, `retries: 0`, `workers: 1`; `reuseExistingServer: false` di ketiga definisi webServer (:113, :126, :136; per-file mencakup project baru `iter3-ui` :3107). Satu-satunya perubahan lain = guard CR-1-9 (`assertEverySpecCollected`) dan ekstraksi pola `SHARED_MATCH`/`POLLING_MATCH` tanpa mengubah polanya.
- **Skip/only**: grep `.skip|.only|.todo|.fixme|xit(|xdescribe(|fit(|test.fail|skipIf|runIf|expect.soft|waitForTimeout` di `dashboard/src` + `dashboard/e2e` → 0 hit. Tidak ada asersi yang dihapus; `m3-bulk.spec.ts` hanya menambah `waitForAnimations` sebelum screenshot; `helpers.ts` `dropShadowViolations` menambah parameter `scope` (default tetap `body *`, pemanggil lama tidak berubah).
- **Log iter3**: identik byte-per-byte di m1/m2/m3 (`cmp`). Typecheck exit 0, lint exit 0, unit 365/365 (21 file) exit 0, coverage lines 99.79% / branches 98% / statements 99.72% / functions 99.05%, E2E 64/64 exit 0 (11 file spec di `e2e/`, semua terkumpul).

## Status temuan sebelumnya

| ID | Severity | Status | Bukti |
|---|---|---|---|
| CR-3-14 (sisa CR-3-9) | minor | **closed** | `src/components/host-config/form-state.ts:229-232`: `ipPlan` memasukkan `f.gateway.trim()` ke `usage.used` bila belum dipakai host lain — sama persis dengan server (`src/lib/server/config-service.ts:333-335`, label `gateway <gw>`, bentrok host lain diutamakan). Berlaku single (`validateIpAssignments`) dan bulk (`planIps`; `skipUsed` melompati gateway, tanpa skipUsed → error). Unit `form-state.test.ts:331-364` (single, spasi, host lain diutamakan, bulk skip/strict, gateway kosong); E2E `iter3-ui.spec.ts:237-262` (pesan field, aria-invalid, tab "(ada error)", Simpan & Install nonaktif, tanpa request tulis). `ipUsageFor` membuat Map baru per panggilan, jadi mutasi tidak bocor. |
| CR-3-9 | minor | **closed** (lewat CR-3-14) | Lihat di atas. |
| DR-3-4 (konteks kode) | design | diperbaiki di kode | `tab-network.tsx:237-245, :273` dan `config-sheet.tsx:418-425`: badge `overflow-visible`, `after:-inset-2` (area klik ±38px), "Tambah" `h-9`. E2E `iter3-ui.spec.ts:200-232` hit-test grid 36px via `elementFromPoint` + ukuran ::after ≥ 36, dan kontrol tetap berfungsi. Pseudo-element melewati tepi badge ±3px horizontal / 6px vertikal; gap `gap-1.5` (6px) → tidak menimpa badge tetangga. |
| I-3-13 | bukti | **closed** | `e2e/m3-bulk.spec.ts:145-146` `waitForAnimations` sebelum screenshot; `iter3-ui.spec.ts:266-295` memastikan opacity 1, transform identitas, di viewport. Kedua screenshot menampilkan dialog dengan kolom password di-mask (diperiksa visual). |
| CR-3-4, CR-3-8, CR-3-12 (partial), CR-3-15, CR-3-16 | minor | open (diterima gatekeeper / M4) | Tidak disentuh. |

## Temuan baru

Tidak ada temuan baru pada `form-state.ts`, `tab-network.tsx`, `config-sheet.tsx`. Gateway non-IPv4 yang dimasukkan ke `usage` tidak berdampak (tidak bisa sama dengan IP host valid; gateway invalid sudah diblokir validasi lain).

## Ringkasan

| Severity | Terbuka |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 5 (CR-3-4, CR-3-8, CR-3-12 partial, CR-3-15, CR-3-16 — semua diterima gatekeeper) |
