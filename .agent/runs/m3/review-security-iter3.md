# Review keamanan M3 — iterasi 3

Diff yang direview: `git diff ed30b1e..76cd8ac` (541fb8d produk: `ui/sonner.tsx`, `host-config/form-state.ts`, `tab-network.tsx`, `config-sheet.tsx`, `hooks/use-now.ts`, `playwright.config.ts`; 76cd8ac test + bukti). Hanya baca. Rujukan: gate-iter2.md, review-security-iter2.md.

## Pemeriksaan bersama (M1–M3)

**Regresi keamanan pada diff produk: tidak ada.**
- `sonner.tsx`: hanya class/CSS variable statis; tidak ada konten dinamis/HTML baru.
- `use-now.ts`: listener `visibilitychange` dipasang sekali dan dilepas saat subscriber terakhir pergi (tidak bocor); guard `typeof document` untuk SSR.
- `form-state.ts`: validasi klien **diperketat** (IP = gateway ditolak), selaras dengan server `config-service.ts:333-335`; validasi server tidak berubah.
- `tab-network.tsx` / `config-sheet.tsx`: hanya class tata letak/hit-area.
- `playwright.config.ts`: `readdirSync` atas direktori `e2e/` lokal saat config dimuat; tidak ada input eksternal. `forbidOnly`, `retries: 0`, `reuseExistingServer: false` tetap.
- Tidak ada perubahan pada route handler `src/app/api/**`, `lib/server/**`, `guardMutation`, `readBodyLimited`, `credentials.ts`.

**Secret/plaintext.**
- `git diff ed30b1e..76cd8ac` di `dashboard/` + `audit.mjs`: tidak ada password/hash/private key/token baru. `audit.mjs:306` membuat stub password `DUMMY-audit-<i>xxxxx` (dummy, bukan secret) dan screenshot terkait memakai blur.
- Log `*-iter3*` (e2e, unit, unit-verbose, lint, typecheck, coverage, ac-matrix) di m1/m2/m3: grep `password|passwd|$6$|PRIVATE KEY|secret|token` → hanya nama test/deskripsi AC; tidak ada nilai password, hash, atau key. `DUMMY_PASSWORD` fixture tidak muncul.
- Screenshot iter3: `m3/screenshots/iter3-passwords-dialog.png` dan `ac-3.14-passwords-dialog.png` (diambil ulang) → kolom PASSWORD tertutup mask magenta, diperiksa visual. Screenshot toast (`m2/screenshots/iter3-toast-*`, `m3/screenshots/iter3-toast-config-saved-*`), `iter3-cr-3-14-gateway-conflict.png`, `iter3-sheet-dns-controls.png`, `ac-3.12-saved.png` tidak memuat kredensial.
- `design/iter3/` (belum di-commit, muncul saat review ini, dibuat design reviewer; `audit.mjs` juga sedang dimodifikasi, di luar diff 76cd8ac): `m3/design/iter3/passwords-dialog*.png` menampilkan `DUMMY-audit-0xxxxx`/`DUMMY-audit-1xxxxx`, yaitu password **stub** dari `page.route` di `audit.mjs` (bukan password hasil generator, bukan secret) → tidak dihitung temuan. `audit-results*.json` iter3: grep `PRIVATE KEY|$6$|DUMMY_PASSWORD|DUMMY-audit` → 0 hit. Screenshot toast M2/M3 iter3 tidak memuat kredensial.
- `git grep -nE "BEGIN .*PRIVATE KEY|password\s*[:=]" 76cd8ac`: hanya fixture test/teks laporan, kecuali `configs/autoinstall/user-data:21-22` (`$6$pxelab$…` + komentar plaintext) — **di luar M1–M3, sudah tercatat (I-3-14), wajib dibereskan sebelum gate M4**. Tidak berubah di diff ini.

## Status temuan sebelumnya

| ID | Status | Bukti |
|---|---|---|
| SR-3-1 … SR-3-4 | closed (iter2) | Tidak ada perubahan pada `credentials.ts`, `http.ts`, `config-service.ts`. |
| SR-3-5 | minor, open (diterima gatekeeper, wajib ≤ M4) | DNS rebinding melewati `guardMutation`; tidak disentuh di iter3. |
| I-3-13 | closed | Screenshot dialog password kini menampilkan dialog, password di-mask (diperiksa visual). |
| I-3-10, I-3-11 | info | Tidak disentuh. |

## Temuan baru

| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| — | — | — | Tidak ada temuan baru. | — |

## Ringkasan

| Severity | Terbuka |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 1 (SR-3-5, diterima, wajib ≤ M4) |
