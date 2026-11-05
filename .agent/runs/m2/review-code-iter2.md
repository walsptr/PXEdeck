# Review kode M2 — iterasi 2 (code-reviewer)

- Branch `milestone/1-3-baseline` @ ed30b1e; dibandingkan dengan iter1 (`git diff 8f4b2d7..ed30b1e`).
- Dibaca: review-code-iter1.md, gate-iter1.md, ac-matrix-iter2.md, `*-iter2.log`.
- Dijalankan ulang: typecheck 0, lint 0, `npm run test:unit` **359/359 lulus** (termasuk AC-2.2),
  `playwright test --list` 58 test/9 file. E2E dari `e2e-iter2.log` (58 passed, exit 0). `unit-iter2.log`:
  `npm run test` tanpa flag tambahan, exit 0, coverage lines 99.78% / branches 98.22%.
- `vitest.config.mts`: hanya ditambah `allowOnly: false`; ambang/include/exclude DEC-004 tidak berubah.
- Infrastruktur bersama CR-1-1: **closed** (lihat m1/review-code-iter2.md).

## Status temuan iter1

| ID | Sev. iter1 | Status | Bukti |
|---|---|---|---|
| CR-2-1 | major | **closed** | `dashboard/src/lib/format.ts:1` `numeric: "always"`. Test AC-2.2 asli tidak diubah (`src/lib/format.test.ts:30`) dan kini lulus. Ditambah test 1 hari / 1 jam / 1 menit (`:35`) dan masa depan "bukan besok" (`:40`). `unit-iter2.log` exit 0. |
| CR-2-2 | minor | **open** | `src/hooks/use-now.ts:18-32, :38-46` tidak berubah: `subscribe` tidak menyegarkan `now`, dan `syncServerClock` early-return sebelum `now = clientNow`. "Last seen" bisa basi ≤ 15 dtk setelah kembali ke /hosts. |
| CR-2-3 | minor | **closed** | `src/components/hosts/columns.tsx:145-152` accessor mengembalikan `undefined`. Unit `columns.test.tsx` "iter2 CR-2-3" (naik & turun, null di akhir) + E2E `iter2-ui.spec.ts` "sort Hostname naik & turun". |
| CR-2-4 | minor | **closed** | `columns.tsx:43-66` `compact` membuang `.`; `macQuery` hanya menerima titik berpola Cisco. Unit "iter2 CR-2-4" (Cisco cocok; "10.10.10" tidak mencocokkan digit MAC) + E2E "pencarian MAC Cisco". |
| CR-2-5 | minor | **closed** | `jsonNoStore` (`src/lib/server/http.ts`) dipakai di `api/hosts/route.ts`, `hosts/[id]/route.ts:21`, `hosts/[id]/config/route.ts:15`, `ssh-keys/route.ts:11`, `network/route.ts`. Test `src/app/api/iter2-routes.test.ts:133-144` mengecek header `no-store` di semua GET. |
| CR-2-6 | minor | **closed** | `src/components/hosts/hosts-view.tsx:448` empty state memakai `cidr` dari `GET /api/network`. E2E `iter2-ui.spec.ts` "server lab: … empty state". |
| CR-2-7 | minor | **closed** | `e2e/m2-polling.spec.ts:26` `≤ 6_000` (sesuai teks AC-2.9); `:36` gap polling `≤ 6_000`. Lebih ketat dari iter1; lulus di `e2e-iter2.log`. |
| CR-2-8 | minor | **closed** | `e2e/m2-hosts-table.spec.ts:9-19, :103-111`: ketujuh status dicek dengan regex persis `^<Label>\s*<count>$`, badge angka `toHaveText` persis, total = jumlah host, minimal 5 status berbeda. |
| CR-2-9 | minor | **closed** | `playwright.config.ts:31-37, :61-79, :102-111`: server `next start` sendiri per file yang memutasi store, dan reuse dimatikan. Menurut ac-matrix-iter2, run parsial 3× lulus (tidak saya ulang karena port). |
| CR-2-10 | minor | **open** (diterima gatekeeper) | Fungsi filter masih di `columns.tsx` (di luar include coverage DEC-004), tetapi tetap diuji unit. |
| G-SEC-2 (bukan temuan saya; dicek sekilas) | — | closed | `src/lib/server/mock-hosts.ts:256-260` hash diganti `DEMO_SEED_PASSWORD_HASH` tanpa plaintext. `mock-hosts.test.ts` "iter2 G-SEC-2": salt lab tidak ada, `verify` gagal untuk tebakan umum, tidak ada pola `crypt "<plaintext>"`. |

## Review kode/test baru (M2)
- AC-2.2 `formatRelative`: refactor ke `UNITS.find(...) ?? UNITS[last]` setara dengan logika lama (menit
  sebagai fallback untuk |diff| ≥ 45 dtk). Benar.
- `guardMutation` sekarang juga ada di DELETE/reboot (mode `"none"`, hook klien tanpa body tetap lolos).
  Test 403/415 tanpa efek ada di `iter2-routes.test.ts:213-302`. Penilaian CSRF diserahkan ke security-reviewer.
- E2E `m2-hosts-table` kini punya server sendiri; komentar ketergantungan urutan diperbarui. Tidak ada asersi
  yang dihapus tanpa pengganti yang lebih ketat.

## Temuan baru
Tidak ada temuan baru di lingkup M2.

## Ringkasan
| Severity | Terbuka |
|---|---|
| critical | 0 |
| major | 0 (CR-2-1 closed; CR-1-1 bersama closed) |
| minor | 2 (CR-2-2, CR-2-10) |
