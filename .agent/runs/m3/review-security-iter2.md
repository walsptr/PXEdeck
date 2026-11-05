# Review keamanan M3 — iterasi 2

- Reviewer: security-reviewer · Branch `milestone/1-3-baseline` @ `ed30b1e` (diff vs iter1: `8f4b2d7..ed30b1e`)
- Acuan: SPEC §6, `docs/design/M3-plan.md`, review-security-iter1.md, gate-iter1.md, bukti `*-iter2.*`
- Perintah read-only: `git diff 8f4b2d7..ed30b1e`, `git grep` secret, grep log/JSON `.agent/runs/**`
  (termasuk `design/iter2/` belum di-commit), inspeksi visual screenshot password/CSV, `npm audit --omit=dev`.

## Status temuan iter1

| ID | Status | Bukti |
|---|---|---|
| SR-3-1 (major) | **closed** | `credentials.ts:29-54`: karakter pertama dari `ALNUM` (alfabet tanpa `-_@#%+=`), sisanya `ALPHABET`; keduanya rejection sampling `crypto.getRandomValues` (seragam). Entropi turun dari 16·6 menjadi 5,86+15·6 ≈ 95,9 bit (diabaikan). `toCsv` kini menetralkan sel `^[=+\-@\t\r]` dengan prefiks `'` (`neutralizeCsvCell`, `credentials.ts:95-120`). Test `credentials.test.ts:94-120`: 10.000 password tanpa awalan `[=+\-@]`, netralisasi + kasus non-formula. |
| SR-3-2 | **closed** | `guardMutation` (`http.ts:66-94`) dipanggil pertama di SEMUA handler mutasi: `PATCH/DELETE hosts/[id]`, `POST hosts/[id]/reboot`, `POST hosts/[id]/install` (mode none), `POST hosts/bulk`, `POST hosts/bulk/install`, `POST credentials/import` (mode json → Content-Type wajib `application/json`, memaksa preflight). Lihat analisis bypass di bawah. |
| SR-3-3 | **closed** | `readBodyLimited` (`http.ts:99-126`): `Content-Length` > 1 MiB → 413 tanpa membaca; tanpa/berbohong → stream dihentikan (`reader.cancel()`) saat melewati batas → 413. `Content-Length` non-numerik → `NaN` → jatuh ke batas stream (aman). Test `http.test.ts:61-73`. |
| SR-3-4 | **closed** (sisa kecil, I-3-11) | `config-service.ts:115-123`: MAC invalid → `""`, username invalid → `""`; password tidak pernah masuk `rows`. Test `iter2-routes.test.ts:341-381` (baris 1 kolom / urutan kolom salah) assert respons tidak memuat secret. |

## Analisis perubahan baru

**Proteksi mutasi (`http.ts`)** — skenario bypass yang diperiksa:
- Origin tanpa port vs Host ber-port (`http://10.10.10.1` vs `10.10.10.1:3000`) → host berbeda → 403 (aman).
  Port default: browser menghilangkan `:80/:443` di Origin maupun Host → cocok (benar).
- Header kapital (`ORIGIN`, `Content-Type: Application/JSON`): `Headers.get` case-insensitive; host
  di-`toLowerCase`, `URL` menormalkan skema/host; MIME dibandingkan lowercase → tidak ada bypass.
- `Content-Type: text/plain; application/json` → `split(";")[0]` = `text/plain` → 415 (aman).
- `Origin: null` (iframe sandbox / redirect) dan nilai rusak → 403.
- Method lain: route handler Next hanya mengekspor method yang didefinisikan; PUT/POST ke route GET-only → 405.
  Semua export PATCH/POST/DELETE sudah memanggil `guardMutation` (diverifikasi `grep` seluruh `src/app/api`).
- `fetch` `no-cors` tanpa body ke endpoint mode `none`: tidak ada Content-Type, tetapi browser modern selalu
  mengirim `Origin` untuk POST/DELETE → 403. Form HTML lintas situs selalu ber-Content-Type non-JSON → 415.
- `X-Forwarded-Host` dipercaya: tidak bisa dipasang oleh halaman lintas-origin tanpa preflight; klien non-browser
  memang tidak dibatasi (tanpa auth, scope M6). Skema Origin tidak dibandingkan (http vs https di host:port sama) —
  tidak realistis.
- **Celah tersisa: DNS rebinding** → SR-3-5.

**`GET /api/network`**: mengekspos `cidr`, `prefix`, `gateway`, `dns[]`, `dynamicRange`, `pxeServer` — topologi
management yang memang ditampilkan di UI dan dibutuhkan validasi klien; tidak ada secret, path, atau token.
`no-store`. Pada env tidak konsisten, 500 memantulkan nilai env (mis. `PXE_MGMT_CIDR "…" bukan CIDR`) — nilai
konfigurasi operator, bukan secret (I-3-12). Tanpa auth → scope M6.

**Blokir private key di form**: `sectionErrors` (`form-state.ts:349-353`) memblokir simpan bila `parseSshKey`
gagal (termasuk `PRIVATE KEY`); `buildPayload` (`form-state.ts:428-431`) membuang key berisi `PRIVATE KEY`
(pertahanan berlapis); `useKeyInfo` (`tab-ssh.tsx`) hanya memakai blob yang lolos parse sebagai query key,
sehingga teks private key tidak masuk cache react-query. Server tetap menolak private key (iter1 I-3-4). Baik.

**Dialog password** (`passwords-dialog.tsx`): tidak bisa ditutup (Escape/overlay/tanpa tombol X) sebelum unduh
atau konfirmasi; state di-reset per batch. Password tetap hanya di state React sampai ditutup; tidak di-log,
tidak di-persist. Kolom password tampil plaintext (by design SPEC §6 "tampil sekali"); screenshot bukti di-mask.

**`DEMO_SEED_PASSWORD_HASH`**: lihat M2 iter2 (G-SEC-2 closed). Dipakai alur install M3 — tidak lagi password publik.

## Temuan baru

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| SR-3-5 | minor | dashboard/src/lib/server/http.ts:57-81 | **DNS rebinding melewati `guardMutation`.** Pemeriksaan hanya membandingkan host `Origin` dengan header `Host`/`X-Forwarded-Host` request, tanpa allowlist host. Halaman `http://evil.example:3000` yang me-rebind DNS ke IP dashboard mengirim `Origin: http://evil.example:3000` dan `Host: evil.example:3000` → cocok → lolos, termasuk `POST /api/hosts/bulk` (ganti credentials/SSH key) dan `/install` (wipe disk). Juga memungkinkan membaca GET API. Saat ini mock; menjadi nyata di M4 sebelum auth M6. | Paling lambat M4: allowlist `Host` (mis. env `PXE_DASHBOARD_HOSTS`, default IP PXE server + `localhost`) dicek di `guardMutation` dan di GET API (atau middleware), 421/403 bila tidak cocok; tambah test Origin = Host = host asing. |

## Info (non-blocking)

- I-3-10 `neutralizeCsvCell` tidak menangani sel diawali spasi lalu `=` (`" =x"`, sengaja dipertahankan di test)
  atau `|`/`%`. Untuk CSV password tidak relevan (semua sel CSV unduhan berasal dari nilai tervalidasi atau
  password berawalan alfanumerik). Bila `toCsv` dipakai untuk data bebas di milestone lain, pertimbangkan
  `^\s*[=+\-@|%]`.
- I-3-11 Sisa SR-3-4: bila urutan kolom `mac,password,username` dan password hanya huruf kecil/angka/`_-`
  diawali huruf (lolos regex username, mis. `hunter22x`), nilainya dipantulkan sebagai `username`. Probabilitas
  rendah (password lemah + kolom tertukar). Opsional: tolak/sembunyikan username bila baris punya error password.
- I-3-12 500 `GET /api/network` memantulkan nilai env yang invalid — bukan secret; aman selama env jaringan tidak
  pernah berisi credential.
- I-3-13 **Bukti iter2**: `unit/e2e/lint/typecheck-iter2.log`, `coverage-summary-iter2.*`, `design/audit-results.json`,
  `design/iter2/*.png` (belum di-commit): tidak ada password/hash/key. Hit grep di `unit-iter2-verbose.log` hanya nama
  test (`… 'PRIVATE KEY' …`). Screenshot `ac-3.14-csv-preview.png` hanya `Fixture-Pass-7319`/`pendek` (dummy fixture).
  `iter2-passwords-dialog-locked.png` kolom password di-mask. Catatan kualitas bukti: `ac-3.14-passwords-dialog.png`
  iter2 menangkap sheet kosong + kotak mask (dialog tidak terlihat) — tidak membocorkan apa pun, tetapi bukan bukti
  dialog yang informatif.
- I-3-14 Hash di `configs/autoinstall/user-data:21-22` (`$6$pxelab$…` + komentar `password: "ubuntu"`) masih ada —
  di luar M1–M3, **wajib dibereskan sebelum gate M4** (gate-iter1).
- I-3-15 `npm audit --omit=dev` @ ed30b1e: 0 vulnerabilities.
- I-3-7 (escaping template installer) dan I-3-8 (auth/token per-MAC) tetap untuk M4/M6.

## Ringkasan

| Severity | Terbuka |
|---|---|
| critical | 0 |
| major | 0 (SR-3-1 closed) |
| minor | 1 (SR-3-5, wajib ≤ M4) |

Tidak meng-approve; keputusan ada di gatekeeper.
