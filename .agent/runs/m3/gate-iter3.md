<!-- Disimpan Orchestrator dari keputusan agent gatekeeper (verbatim). -->
## Keputusan gatekeeper, iterasi 3 (terakhir) — branch milestone/1-3-baseline @ 76cd8ac (produk 541fb8d)

**Hasil: M1 APPROVED · M2 APPROVED · M3 APPROVED.**

Semua gate PASS untuk ketiga milestone. Satu-satunya FAIL di iterasi 2 adalah **DR-1-2** (drop shadow pada toast Sonner). Temuan ini sudah ditutup dan dibuktikan dengan test E2E yang terbukti bisa gagal (uji mutasi). Reviewer kode, keamanan, dan desain tidak menemukan critical atau major yang masih terbuka. M1–M3 tidak butuh bukti KVM (gate 5 hanya berlaku untuk milestone ≥ 4).

### Pemeriksaan lintas milestone (berlaku untuk M1, M2, M3)

**Log bersama**
- Log berikut identik byte-per-byte di m1/, m2/, dan m3/ (dicek dengan md5): `typecheck-iter3.log`, `lint-iter3.log`, `unit-iter3.log`, `e2e-iter3.log`, `coverage-summary-iter3.txt`, dan `coverage-summary-iter3.json`.
- Commit 76cd8ac hanya berisi test dan bukti. Jadi log tersebut mencerminkan kode produk 541fb8d.

**Hasil run**
- Typecheck: exit 0 (`next typegen && tsc --noEmit`).
- Lint: exit 0 (`eslint`).
- Unit dan integration lewat `npm run test` = `vitest run --coverage`, tanpa flag tambahan: **365/365 lulus, 21 file, exit 0**.
- E2E lewat `npm run test:e2e` = `playwright test`: **64/64 lulus, exit 0**.

**Coverage (DEC-004)**
- Lines 99.79%, branches 98%, statements 99.72%, functions 99.05%. Semua ≥ 80%.

**`dashboard/vitest.config.mts`**
- Tidak berubah di `git diff ed30b1e..76cd8ac`.
- `allowOnly: false`. Ambang `lines: 80, branches: 80`, serta include dan exclude, tetap sesuai DEC-004.

**`dashboard/playwright.config.ts`**
- `forbidOnly: true`, `retries: 0`, `workers: 1`, dan `reuseExistingServer: false` di semua webServer.
- Perubahan di diff:
  - project `iter3-ui` ditambahkan (port :3107, LAB_ENV);
  - pola `SHARED_MATCH`/`POLLING_MATCH` diekstrak tanpa mengubah isinya;
  - guard CR-1-9 `assertEverySpecCollected()` ditambahkan. Guard ini membuat config gagal dimuat bila ada spec yang yatim atau terkumpul ganda. Artinya pengetatan, bukan pelemahan.

**Grep skip/only/fixme/waitForTimeout**
- Pola: `.skip|.only|.fixme|.todo|xit(|xdescribe|waitForTimeout|test.fail|test.slow`, di `dashboard/src` dan `dashboard/e2e`.
- Hasil: **0 hit**.

**Diff `git diff ed30b1e..76cd8ac -- dashboard`** (11 file, +457/−20)
- Tidak ada asersi yang dihapus.
- `helpers.ts` `dropShadowViolations`: menambah parameter `scope` dengan default `body *`. Pemanggil lama tetap sama.
- `m3-bulk.spec.ts`: hanya menambah `waitForAnimations` sebelum screenshot.
- `form-state.test.ts` dan `hooks.test.ts`: murni penambahan.
- Produk:
  - `sonner.tsx`: `shadow-none!`, `border!`, `rounded-xl!`, ditambah ring fokus spread-only.
  - `form-state.ts`: validasi klien diperketat (IP host = gateway ditolak).
  - `tab-network.tsx` dan `config-sheet.tsx`: hanya ukuran hit area.
  - `use-now.ts`: segarkan saat subscribe atau `visibilitychange`.
- **Tidak ada pelemahan test.**

**DR-1-2 terverifikasi**
- `e2e/iter3-ui.spec.ts:116-155` memicu toast dari alur nyata: M2 hapus, M2 reboot, dan M3 simpan konfigurasi.
- Tiap toast diperiksa dalam keadaan diam, hover, dan focus-visible. Asersinya:
  - `dropShadowViolations([data-sonner-toast])` = [];
  - setiap lapisan shadow punya offset 0 dan blur 0;
  - border 1px dengan warna token `--border`;
  - radius 12px;
  - ring fokus benar-benar ada saat focus-visible;
  - seluruh halaman bebas drop shadow (`dropShadowViolations` tanpa scope).
- Uji mutasi tercatat di `ac-matrix-iter3.md`: dengan `sonner.tsx` versi lama, 3/3 test gagal.
- Audit desain mengukur `boxShadow rgba(0,0,0,0) 0 0 0 0` di semua state toast, dengan `drop = 0` di 41/41 state (`.agent/runs/m1/design/iter3/audit-results-all.json`).

**Secret/plaintext**
- Diff iter3 tidak menambah password, hash, key, atau token.
- Log iter3 bersih.
- Kolom password di screenshot dialog di-mask.
- `DUMMY-audit-*` di `design/iter3/` hanya stub `page.route`, bukan secret.
- `configs/autoinstall/user-data:21-22` (`$6$pxelab$…` plus komentar plaintext) berada di luar M1–M3 dan diteruskan ke M4 (lihat carry-over).

---

## Milestone 1 — APPROVED

| Gate | Status | Bukti |
|---|---|---|
| 1a. Typecheck | PASS (exit 0) | .agent/runs/m1/typecheck-iter3.log |
| 1b. Lint | PASS (exit 0) | .agent/runs/m1/lint-iter3.log |
| 2a. Unit & integration | PASS: 365/365 (21 file), exit 0, tanpa flag tambahan | .agent/runs/m1/unit-iter3.log, unit-iter3-verbose.log |
| 2b. Coverage ≥ 80% (lines) | PASS: lines 99.79%, branches 98%; config DEC-004 utuh | .agent/runs/m1/coverage-summary-iter3.txt/.json, dashboard/vitest.config.mts |
| 2c. E2E | PASS: 64/64, exit 0; 11 spec, semua terkumpul (guard CR-1-9) | .agent/runs/m1/e2e-iter3.log, dashboard/playwright.config.ts |
| 3. AC coverage | PASS: AC-1.1 s/d AC-1.12 (12/12 sesuai plan) masing-masing punya test nyata yang lulus; semua file test yang dirujuk ada | .agent/runs/m1/ac-matrix-iter3.md, docs/design/M1-plan.md |
| 4a. Code review | PASS: 0 critical / 0 major; CR-1-9 closed; minor CR-1-6, CR-1-7 (partial), CR-1-10 (baru) | .agent/runs/m1/review-code-iter3.md |
| 4b. Security review | PASS: 0 / 0 / 0 | .agent/runs/m1/review-security-iter3.md |
| 4c. Design review | PASS: DR-1-2 **closed** (terukur dan diuji E2E); I-1-5 closed; 1 minor baru DR-1-3 | .agent/runs/m1/review-design-iter3.md, .agent/runs/m1/design/iter3/audit-results-all.json, dashboard/e2e/iter3-ui.spec.ts:116-155 |
| 5. Bukti KVM | N/A (milestone < 4) | — |
| 6. Secret/plaintext | PASS | .agent/runs/m1/review-security-iter3.md, log iter3 |
| Skip/.only/test dilemahkan | PASS: 0 hit; diff ed30b1e..76cd8ac tanpa pelemahan | grep dashboard/src dan dashboard/e2e; git diff |

**Minor yang diterima:**
- **CR-1-6 (partial).** Varian `dark:` dari vendor shadcn tidak aktif. Sesuai plan G1-6, tanpa dampak visual.
- **CR-1-7 (partial).** Status DHCP/TFTP/HTTP di sidebar masih hard-code. Memang di luar scope M1 (G1-4) dan menjadi pekerjaan M4.
- **CR-1-10 (baru).** Guard CR-1-9 memakai `readdirSync` non-rekursif. Saat ini tidak ada subfolder di `e2e/`, jadi tidak ada test yang lolos dari guard. Jadi carry-over M4.
- **DR-1-3 (baru).** Font toast adalah `ui-sans-serif` dari stylesheet Sonner, bukan Inter. Penyimpangannya kosmetik: ukuran 13px dan warna sudah benar, dan tidak mengganggu fungsi atau token warna/shadow. Jadi carry-over M4.

## Milestone 2 — APPROVED

| Gate | Status | Bukti |
|---|---|---|
| 1a. Typecheck | PASS (exit 0) | .agent/runs/m2/typecheck-iter3.log |
| 1b. Lint | PASS (exit 0) | .agent/runs/m2/lint-iter3.log |
| 2a. Unit & integration | PASS: 365/365, exit 0; termasuk CR-2-2 (`src/hooks/hooks.test.ts:235-280`) | .agent/runs/m2/unit-iter3.log |
| 2b. Coverage ≥ 80% (lines) | PASS: lines 99.79%, branches 98% | .agent/runs/m2/coverage-summary-iter3.txt/.json |
| 2c. E2E | PASS: 64/64, exit 0; termasuk toast hapus/reboot (iter3-ui) | .agent/runs/m2/e2e-iter3.log |
| 3. AC coverage | PASS: AC-2.1 s/d AC-2.14 (14/14) punya test yang lulus | .agent/runs/m2/ac-matrix-iter3.md, docs/design/M2-plan.md |
| 4a. Code review | PASS: 0 critical / 0 major; CR-2-2 closed; minor CR-2-10, CR-2-11 (baru) | .agent/runs/m2/review-code-iter3.md |
| 4b. Security review | PASS: 0 / 0 / 0 milik M2 (SR-3-5 dihitung di M3) | .agent/runs/m2/review-security-iter3.md |
| 4c. Design review | PASS: DR-1-2 closed di alur M2 (toast reboot/hapus terukur datar); 1 minor baru DR-2-3 | .agent/runs/m2/review-design-iter3.md, .agent/runs/m2/design/iter3/toast-*.png |
| 5. Bukti KVM | N/A | — |
| 6. Secret/plaintext | PASS: G-SEC-2 tetap closed | .agent/runs/m2/review-security-iter3.md |
| Skip/.only/test dilemahkan | PASS: 0 hit; tanpa pelemahan | grep; git diff ed30b1e..76cd8ac |

**Minor yang diterima:**
- **CR-2-10.** Logika filter masih di `columns.tsx`. DEC-004 mengizinkannya, dan fungsinya diuji unit.
- **CR-2-11 (baru).** `use-now.ts:31` memperbarui `now` saat subscribe tanpa `notify()`. Teks "x lalu" antarbaris bisa berbeda paling lama 15 dtk. Tidak ada kesalahan fungsional dan masih dalam toleransi tick.
- **DR-2-3 (baru).** Hostname di judul toast tidak memakai font mono (`hosts-view.tsx:200-214`). Penyimpangan tipografi kosmetik pada teks transien; data teknis di tabel dan dialog sudah mono.
- **SR-2-1 (sisa desain seed).** Masih mock. Kewajibannya ada di M4 (lihat carry-over).

## Milestone 3 — APPROVED

| Gate | Status | Bukti |
|---|---|---|
| 1a. Typecheck | PASS (exit 0) | .agent/runs/m3/typecheck-iter3.log |
| 1b. Lint | PASS (exit 0) | .agent/runs/m3/lint-iter3.log |
| 2a. Unit & integration | PASS: 365/365, exit 0; termasuk CR-3-14 (`form-state.test.ts:331-364`) | .agent/runs/m3/unit-iter3.log |
| 2b. Coverage ≥ 80% (lines) | PASS: lines 99.79%, branches 98% | .agent/runs/m3/coverage-summary-iter3.txt/.json |
| 2c. E2E | PASS: 64/64, exit 0; termasuk toast simpan, DR-3-4, CR-3-14, I-3-13 (`iter3-ui.spec.ts:137-295`) | .agent/runs/m3/e2e-iter3.log |
| 3. AC coverage | PASS: AC-3.1 s/d AC-3.15 (15/15) punya test yang lulus | .agent/runs/m3/ac-matrix-iter3.md, docs/design/M3-plan.md |
| 4a. Code review | PASS: 0 critical / 0 major; CR-3-14 dan CR-3-9 closed, I-3-13 closed; 5 minor yang sudah diterima | .agent/runs/m3/review-code-iter3.md |
| 4b. Security review | PASS: 0 critical / 0 major; 1 minor SR-3-5 (diterima, wajib ≤ M4) | .agent/runs/m3/review-security-iter3.md |
| 4c. Design review | PASS: DR-1-2 closed di alur M3; DR-3-4 closed ("Tambah" 36px, hit area ≥ 37×37px); 0 minor baru | .agent/runs/m3/review-design-iter3.md, .agent/runs/m3/design/iter3/toast-save-*.png |
| 5. Bukti KVM | N/A | — |
| 6. Secret/plaintext | PASS: password di screenshot di-mask; stub `DUMMY-audit-*` bukan secret | .agent/runs/m3/review-security-iter3.md, .agent/runs/m3/screenshots/ac-3.14-passwords-dialog.png |
| Skip/.only/test dilemahkan | PASS: 0 hit; tanpa pelemahan | grep; git diff ed30b1e..76cd8ac |

**Minor yang diterima:**
- **CR-3-4.** `getConfig` membuat config secara lazy. Tidak berdampak di store mock.
- **CR-3-8.** UI lebih ketat daripada API. Aman, karena tidak ada input invalid yang lolos.
- **CR-3-12 (partial).** Public key `wals@wal` ada di seed. Public key bukan secret.
- **CR-3-15.** Budget `planIps` untuk subnet env besar. Hanya bisa dipicu lewat konfigurasi operator.
- **CR-3-16.** Sheet diblokir bila `/api/network` gagal. Perilaku ini konservatif dan diuji E2E.
- **SR-3-5.** DNS rebinding bisa melewati `guardMutation`. Endpoint masih mock dan auth adalah scope M6. Wajib selesai ≤ M4.
- **I-3-8.** Varian `toast.error` belum terukur di audit, tetapi memakai `classNames.toast` yang sama.
- **I-3-10, I-3-11.** Risiko rendah dan sudah dijelaskan reviewer.

---

## Kewajiban carry-over ke M4 (wajib diperiksa di gate M4)

1. **I-3-14 / G-SEC.** Bereskan `configs/autoinstall/user-data:21-22`: hash `$6$pxelab$…` dan komentar plaintext-nya. Ganti dengan template atau nilai yang di-inject. Ini **syarat sebelum gate M4**, karena gate 6 akan FAIL bila masih ada.
2. **SR-3-5.** Tambahkan allowlist header Host di `guardMutation`. Sertakan test untuk kasus Origin = Host = host asing, yang harus ditolak. Ini wajib sebelum endpoint install atau credentials menjadi nyata.
3. **SR-2-1 / CR-3-12.**
   - Persistence (DB) tidak boleh mewarisi hash seed atau public key `wals@wal` dari seed.
   - Host tanpa credentials eksplisit harus ditolak saat install.
   - Keduanya wajib dibuktikan dengan test.
4. **CR-3-4.** Pisahkan `peekConfig` dari `getConfig` (lazy create) saat pindah ke DB.
5. **CR-3-15.** Batasi budget `planIps` untuk subnet env nyata.
6. **CR-1-7.** Status DHCP/TFTP/HTTP di sidebar harus berasal dari sumber nyata, bukan hard-code.
7. **CR-1-10.** Buat guard spec Playwright rekursif (`readdirSync(..., { recursive: true })`) atau larang subfolder secara eksplisit. Ini **wajib sebelum file E2E M4 ditambahkan**.
8. **DR-1-3.** Toast harus memakai Inter, misalnya `font-sans` di `classNames.toast`. Tambahkan asersi font di `e2e/iter3-ui.spec.ts`.
9. **DR-2-3.** Hostname di judul toast dibungkus `type-data` (mono).
10. **CR-2-11.** `use-now.ts`: segarkan hanya ketika subscriber pertama masuk, atau panggil `notify()`.
11. **I-3-8.** Tambahkan pengukuran atau test shadow untuk varian `toast.error`.
12. **Gate 5 (KVM) mulai berlaku.** Alurnya: PXE boot, konfigurasi diterima, status Done, lalu login SSH dengan key yang di-inject, sesuai matriks di CLAUDE.md.

## Housekeeping (bukan gate, tetapi wajib supaya jejak bukti lengkap)

- Sebelum merge ke `main` lokal, **commit** bukti iter3 yang belum masuk:
  - `.agent/runs/m{1,2,3}/review-{code,security,design}-iter3.md`;
  - `.agent/runs/m{1,2,3}/design/iter3/`;
  - perubahan `.agent/runs/m1/design/audit.mjs`;
  - `gate-iter3.md`.
- Pada working tree, `dashboard/` bersih. Yang belum di-commit hanya `.agent/runs/**`.