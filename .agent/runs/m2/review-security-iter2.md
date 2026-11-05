# Review keamanan M2 — iterasi 2

- Reviewer: security-reviewer · Branch `milestone/1-3-baseline` @ `ed30b1e` (diff vs iter1: `8f4b2d7..ed30b1e`)
- Acuan: SPEC §6, review-security-iter1.md, gate-iter1.md (G-SEC-2), bukti `*-iter2.*`

## Status temuan iter1

| ID | Status | Bukti |
|---|---|---|
| G-SEC-2 (gate Secret) | **closed** | `mock-hosts.ts:256-261`: komentar plaintext lab dihapus; `LAB_PASSWORD_HASH` diganti `DEMO_SEED_PASSWORD_HASH` (`$6$` salt acak `Y2yXR19q.NLsVJMG`, bukan salt lab `pxelab`) berlabel "SEED DEMO … jangan dibawa ke persistence M4". `mock-hosts.test.ts:249-271` memastikan hash tidak cocok dengan `ubuntu/password/admin/root/changeme/pxelab/demo/seed` dan source tidak memuat salt lab, `LAB_PASSWORD_HASH`, atau pola `crypt "…"`. `git grep '\$6\$pxelab'` di `dashboard/` → hanya konstanta pembanding di test. |
| SR-2-1 | **closed untuk M2** (sisa desain → M4) | Hash seed tidak lagi berasal dari password yang diketahui umum, jadi "Install" host seed tidak lagi menghasilkan host dengan password publik. Sisa: seed tetap `username: ubuntu`, `sudo: true`, `disableSshPassword: false`, dan `installHosts` menganggapnya ber-credentials. Klaim "string acak sekali pakai" tidak bisa diverifikasi, tetapi test tebakan umum lulus. Wajib di M4: persistence tidak mewarisi seed hash; host tanpa credentials eksplisit ditolak install. |
| SR-2-2 | **closed** | `api/hosts/[id]/reboot/route.ts:9` dan `DELETE api/hosts/[id]/route.ts:44` memanggil `guardMutation(req, "none")` sebagai langkah pertama: `Origin` asing / `null` / `Sec-Fetch-Site: cross-site` → 403, Content-Type non-JSON (form HTML) → 415. Test `http.test.ts:82+` dan `iter2-routes.test.ts`. Analisis bypass ada di M3 iter2 (SR-3-5 = DNS rebinding, berlaku juga di sini). |

## Temuan baru

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| — | — | — | Tidak ada temuan baru khusus M2. SR-3-5 (DNS rebinding melewati `guardMutation`) juga mengenai reboot/DELETE; dihitung di M3. | — |

## Info (non-blocking)

- I-2-8 **Bukti iter2** (log, `design/audit-results.json`, screenshot `ac-2.*`, `iter2-search-cisco-mac.png`):
  tidak memuat password/hash/key.
- I-2-9 GET API (`/api/hosts`, `/api/hosts/[id]`) tidak dijaga `guardMutation` — benar, karena bukan mutasi
  dan SOP mencegah pembacaan lintas-origin (kecuali DNS rebinding, SR-3-5). `Cache-Control: no-store` tetap.
- I-2-6 (auth) tetap scope M6.

## Ringkasan

| Severity | Terbuka |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 0 |

Tidak meng-approve; keputusan ada di gatekeeper.
