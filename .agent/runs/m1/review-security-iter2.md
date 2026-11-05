# Review keamanan M1 — iterasi 2

- Reviewer: security-reviewer · Branch `milestone/1-3-baseline` @ `ed30b1e` (diff vs iter1: `8f4b2d7..ed30b1e`)
- Acuan: SPEC §6, review-security-iter1.md, gate-iter1.md, bukti `*-iter2.*`
- Perintah read-only: `git diff`, `git grep` (PRIVATE KEY, `$6$`, literal password), `git ls-files`
  (.env/.pem/key), grep log/JSON `.agent/runs/**` (termasuk `design/iter2/` yang belum di-commit),
  inspeksi visual screenshot password/CSV, `npm audit --omit=dev`, `npm ls shadcn`.

## Status temuan iter1

| ID | Status | Bukti |
|---|---|---|
| SR-1-1 | **closed** | `dashboard/package.json`: `shadcn` pindah ke `devDependencies` (juga `next-themes` dihapus). `npm audit --omit=dev` → **found 0 vulnerabilities** (dijalankan ulang @ ed30b1e). |

## Temuan baru

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| — | — | — | Tidak ada temuan baru di lingkup M1. | — |

## Info (non-blocking)

- I-1-8 **Secret di repo**: tetap hanya `FAKE_PRIVATE_KEY` fixture (`src/test/fixtures.ts:32`). Tidak ada
  `.env`/`.pem`/`id_*` ter-commit (hanya `.env.example`). Hit biner `$6$` di PNG adalah byte acak, bukan teks.
- I-1-9 **Bukti iter2** (`typecheck/lint/unit/e2e-iter2.log`, `coverage-summary-iter2.*`, screenshot M1,
  `design/*.json`): tidak memuat password, hash, atau key. `e2e-iter2.log` identik m1/m2/m3 (run gabungan).
- I-1-10 `.claude/hooks/guard_bash.py` ikut berubah di commit milestone (menambah larangan mutasi libvirt
  massal). Lebih ketat, bukan pelemahan; dicatat karena file konfigurasi agent berubah di branch produk.
- I-1-5/I-1-6 (header keamanan, auth) tetap scope M6.

## Ringkasan

| Severity | Terbuka |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 0 |

Tidak meng-approve; keputusan ada di gatekeeper.
