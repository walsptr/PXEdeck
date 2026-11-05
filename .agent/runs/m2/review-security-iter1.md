# Review keamanan M2 — iterasi 1

- Reviewer: security-reviewer · Branch `milestone/1-3-baseline` @ `8f4b2d7`
- Acuan: SPEC §6, `docs/design/M2-plan.md`, DEC-002, DEC-005
- Scope M2: tabel host (mock store), `GET /api/hosts`, `GET|DELETE /api/hosts/[id]`,
  `POST /api/hosts/[id]/reboot`, filter/seleksi/aksi baris, seam store (DEC-005).

## Temuan

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| SR-2-1 | minor | dashboard/src/lib/server/mock-hosts.ts:256-275 | Seed mock memberi setiap host yang punya OS terpasang/ditugaskan `username: "ubuntu"` + `LAB_PASSWORD_HASH` (hash password publik `ubuntu`, salt tetap `pxelab`, sama untuk semua host) + `sudo: true` + `disableSshPassword: false`. `installHosts` menganggap host ini sudah ber-credentials, sehingga "Install" langsung menghasilkan host dengan password yang diketahui umum dan SSH password aktif. Saat ini hanya mock (tidak ada installer nyata), tetapi melanggar semangat SPEC §6 (salt acak per host) bila pola ini terbawa ke persistence M4. | M4: seed/default config jangan memuat hash; host tanpa credentials eksplisit wajib ditolak install. Bila hash lab tetap dipakai untuk demo, batasi ke `PXE_MOCK_SEED=default` dan beri label jelas. |
| SR-2-2 | minor | dashboard/src/app/api/hosts/[id]/reboot/route.ts:5-13 | Endpoint pengubah state ber-metode `POST` tanpa body (`reboot`) bisa dipicu lintas-origin oleh halaman web mana pun yang dibuka admin (form POST / `fetch` mode `no-cors` = "simple request", tanpa preflight CORS). Tanpa auth (M6) tidak ada pertahanan. `DELETE` terlindungi preflight. Mock sekarang, menjadi nyata di M4 sebelum auth M6. (Varian lebih berat untuk install/bulk: SR-3-2.) | Tolak request bila header `Origin` ada dan ≠ origin dashboard (helper bersama di `lib/server/http.ts`), lalu tambahkan CSRF/SameSite di M6. |

## Info (non-blocking)

- I-2-1 **Path/ID injection `[id]`**: semua route `[id]` memakai `hostIdParam` →
  `parseHostId` dengan regex `^[0-9a-f]{12}$` (`host-config.ts:37-43`) sebelum akses store;
  selain itu 400. Id hanya dipakai sebagai key `Map` — tidak ada path filesystem. Baik.
- I-2-2 **Data host ke browser**: tipe `Host` (`types.ts`) tidak memuat config/hash. `GET
  /api/hosts` `Cache-Control: no-store`. Render tabel via JSX (auto-escape), vendor dari tabel
  OUI statis; tidak ada sink HTML mentah.
- I-2-3 **Seam DEC-005**: tidak ada route `__test__`/endpoint reset (`git ls-files` diverifikasi);
  reset hanya via fungsi + env. Sesuai DEC-005.
- I-2-4 **Pesan error**: 400/404 generik (`http.ts`), tanpa stack trace atau detail internal.
- I-2-5 Seed mock memuat public key nyata `wals@wal` (`mock-hosts.ts` ~250). Public key bukan
  secret; catat saja (identitas workstation admin ikut di repo).
- I-2-6 **Auth**: semua API M2 tanpa autentikasi — scope M6 (SPEC §6), bukan blocking.
- I-2-7 **Bukti `.agent/runs/m2/**`**: tidak ada password/hash/key di log maupun screenshot.

## Ringkasan

| Severity | Jumlah |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 2 |
| info | 7 |

Tidak meng-approve; keputusan ada di gatekeeper.
