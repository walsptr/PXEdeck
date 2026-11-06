# M6 — bug lokal dari test-engineer T10–T13 (bukan smoke KVM; itu di `bugs.md`)

Test yang membuktikan bug dibiarkan MERAH (tidak di-skip/dilonggarkan). Kode produk tidak diubah.

## BUG-M6-L1 — `PXE_SESSION_IDLE_MIN=1` (batas bawah yang valid): sesi aktif tetap habis ±60 dtk walau polling

- Severity: minor (default 120 mnt tidak terdampak), tetapi melanggar AC-6.6 ("aktivitas sebelum idle
  memperpanjang") dan DEC-019 §1 ("setiap request ber-sesi, termasuk polling, tetap memperpanjang idle")
  untuk nilai env yang diterima validasi (1–1440).
- Lokasi: `dashboard/src/lib/server/auth/session.ts` — `TOUCH_INTERVAL_MS = 60_000` (baris 26), syarat
  valid `t - lastSeen <= idleMs` (baris 94) dan perpanjangan `t - lastSeen >= TOUCH_INTERVAL_MS`
  (baris 99). Dengan idle 1 mnt (= 60 000 ms) perpanjangan hanya terjadi bila request tiba TEPAT
  60 000 ms setelah `last_seen_at`; polling 5 dtk tidak pernah memenuhinya → sesi habis pada ±60 dtk.
  Untuk idle 2 mnt pun margin hanya 60 dtk (aman), jadi masalah khusus idle ≤ 1 mnt.
- Reproduksi (E2E, server `m6-session` dengan `PXE_SESSION_IDLE_MIN=1`):
  `npx playwright test --project m6-session -g "DEC-019"` → tab `/hosts` yang polling tiap 5 dtk
  dialihkan ke `/login?next=%2Fhosts` sebelum 75 dtk (log: `.agent/runs/m6/e2e.log`).
  Unit: `npx vitest run src/lib/server/auth/m6-te-session.test.ts` → `PXE_SESSION_IDLE_MIN=1` ›
  request tiap 5,003 dtk → `t=60.036 dtk: expected null not to be null` (idle 2 dan 120 lulus).
- Saran perbaikan (untuk backend-dev): interval tulis = `min(60 dtk, idle/2)` atau perpanjang bila
  `t - lastSeen >= min(TOUCH_INTERVAL_MS, idleMs / 2)`; tambah unit test idle=1 dengan request tiap 5 dtk
  selama 3 mnt → tetap valid, dan ≤ 1 tulis per 30 dtk.
- Test merah: `dashboard/e2e/m6-session.spec.ts` › "DEC-019 §1: polling memperpanjang idle …" dan
  `dashboard/src/lib/server/auth/m6-te-session.test.ts` › "PXE_SESSION_IDLE_MIN=1 › request tiap ±5 dtk …".

## BUG-M6-L2 — Regresi DR-5-8: kartu OS image ID panjang di 375 px 532 px (> batas 520 M5)

- Severity: minor/design (regresi asersi M5 yang sudah di-approve; batas tidak boleh dinaikkan).
- Test merah (spec M5, tanpa perubahan): `dashboard/e2e/m5-library.spec.ts` › "DR-5-8 OS Images 375/414:
  ID 48 karakter + path panjang …" → `@375 tinggi kartu image panjang
  ubuntu-24.04-custom-hwe-lab-rack07-node-image-01: Expected <= 520, Received 532`. Konsisten di dua run
  E2E berturut-turut (setelah `document.fonts.ready`, CR-5-31). Karena `m5-library` serial, 6 test berikutnya
  di file itu tidak berjalan (DR-5-9, DR-5-12, DR-5-13, DR-5-5/5-6) sampai bug ini diperbaiki.
- Dugaan penyebab: perubahan T9 di `dashboard/src/components/os-images/os-images-view.tsx` (alasan
  "tidak tersedia" kini `ReasonText`/`PathText` dengan segmen `inline-block` per `/`, kolom
  `xl:w-[24ch]`) menambah baris pada kartu `< xl` untuk path panjang. Audit mandiri dev
  (`.agent/runs/m6/dev-audit/`) hanya memeriksa DR-5-1 (image bawaan ≤ 200), bukan DR-5-8 (≤ 520).
- Reproduksi: `PXE_E2E_MILESTONE=6 npx playwright test --project m5-library` (log `.agent/runs/m6/e2e.log`).

## BUG-M6-L3 — AC-6.38: pelanggaran kontras WCAG 1.4.3 di luar daftar pengecualian DEC-017 §9 / DEC-019 §2

- Severity: major untuk gate (AC-6.38 mensyaratkan 0 pelanggaran selain pasangan token terdaftar).
- Test merah: `dashboard/e2e/m6-ui.spec.ts` › "AC-6.38 aksesibilitas …" (/hosts, /os-images, /ssh-keys,
  /settings, /jobs detail, /login error, /hosts dengan Sheet). Detail per node (warna terhitung oleh
  `classifyContrastFinding`) ada di pesan error dan `.agent/runs/m6/axe-results.json`.
- Temuan (warna terhitung getComputedStyle + elementsFromPoint, bukan nilai axe):
  1. Semua halaman dashboard ≥ lg: teks pemicu pencarian global top bar (`span.lg:not-sr-only`,
     "Cari MAC, hostname, IP…") `muted-soft #a09c92` di atas putih = 2,74:1. Ini teks tombol, bukan
     placeholder `<input>`; pengecualian DEC-017 §9 hanya untuk placeholder `muted-soft`. Perlu keputusan
     Orchestrator (perlakukan sebagai placeholder via DEC baru) atau perbaikan warna (`muted` = pengecualian
     muted/putih, atau `body`). Filter test TIDAK diperluas.
  2. Sheet (Edit konfigurasi): label tab inaktif "Credentials/Network/Hostname/SSH" warna
     `foreground` 60% → `#73726c` di atas `#e6e5e0` (tab list) = 3,84:1.
  3. Sheet: caption `.min-h-7 > .type-caption.text-muted-foreground` `muted #807d72` di atas
     `canvas-soft #fafaf7` = 3,94:1 (muted/canvas-soft bukan pengecualian; dev sudah memperbaiki pola yang
     sama di `EmptyDescription`).
  4. /login (state error): `AlertDescription` destructive `#d44267` di atas putih = 4,4:1 (< 4,5:1);
     pesan error adalah informasi penting (DEC-017 §9).
- Reproduksi: `PXE_E2E_MILESTONE=6 npx playwright test --project m6-ui -g "AC-6.38"`.

## OBS-M6-L1 (observasi, bukan bug) — shell dashboard di-reveal ± 300 ms setelah `load`

- Sejak `SessionGate` (Suspense `fallback={null}`) membungkus seluruh shell, HTML SSR berisi konten di
  segmen Suspense tersembunyi yang baru di-reveal setelah event `load` (batch reveal React). Sebelum itu
  halaman kosong (kanvas krem saja). Test lama `m1-design-system` (AC-1.3/1.4/oranye) mengukur seketika
  setelah `goto` sehingga mengukur halaman kosong (hampa atau 0 px) secara intermiten; diperbaiki dengan
  menunggu judul top bar `toBeVisible()` (lihat `test-migration.md` §M6-T12). Untuk design reviewer:
  kilasan halaman kosong ±300 ms di setiap muat penuh.
