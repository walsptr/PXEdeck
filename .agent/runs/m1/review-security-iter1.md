# Review keamanan M1 — iterasi 1

- Reviewer: security-reviewer · Branch `milestone/1-3-baseline` @ `8f4b2d7`
- Acuan: SPEC §6, `docs/design/M1-plan.md`, DEC-001..006
- Scope M1: setup, design tokens, layout (sidebar/top bar/placeholder), tooling. Auth (SPEC §6
  "semua API butuh autentikasi") adalah milestone 6 → dicatat sebagai info, bukan temuan blocking.
- Perintah read-only yang dijalankan: `git grep -nE "BEGIN .*PRIVATE KEY|PRIVATE KEY-----"`,
  `git grep` literal password / `$6$`, `git ls-files` (.env/.pem/key), grep `.agent/runs/**`,
  grep sink XSS (`dangerouslySetInnerHTML|innerHTML|eval|new Function`), `npm audit --omit=dev`.

## Temuan

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| SR-1-1 | minor | dashboard/package.json:30 | `shadcn` (CLI generator) ada di `dependencies`, bukan `devDependencies`. Seluruh advisory `npm audit --omit=dev` (6: 2 low, 4 moderate — `deepmerge` prototype poisoning, `minimatch` ReDoS via `ts-morph`) berasal dari rantai ini, sehingga ikut ke instalasi produksi di PXE server (M4) walau tidak dipakai saat runtime. | Pindahkan `shadcn` ke `devDependencies`; ulangi `npm audit --omit=dev` (target 0). |

## Info (non-blocking)

- I-1-1 **Secret di repo**: tidak ada private key sungguhan. Satu-satunya hit
  `dashboard/src/test/fixtures.ts:32` adalah `FAKE_PRIVATE_KEY` (header + 16 byte base64
  `openssh-key-v1`, tanpa materi key) untuk menguji penolakan private key — sah.
  Tidak ada `.env`/`.pem`/`id_*` ter-commit; hanya `dashboard/.env.example` (nilai default lab,
  tanpa secret). `.gitignore` meng-ignore `.env*`, `.agent/keys/`.
- I-1-2 **`configs/autoinstall/user-data:21-22`** (lab asli, pra-workflow): hash SHA-512 crypt
  `$6$pxelab$…` untuk password lab default `ubuntu`, salt tetap, plus komentar yang menyebut
  password-nya. Bukan plaintext secret dan bukan kode dashboard; didokumentasikan sebagai
  lab-only di `README.md:228` dan `:345` ("ganti untuk non-lab"). **Bukan temuan untuk M1–M3.**
  Catatan untuk M4: generator installer dashboard tidak boleh mewarisi template/nilai ini sebagai
  default (lihat SR-2-1).
- I-1-3 **XSS**: tidak ada `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` di
  `dashboard/src`. Satu-satunya `href={…}` (`app-sidebar.tsx:61`) berasal dari konstanta
  `src/lib/nav.ts`.
- I-1-4 **Bukti `.agent/runs/m1/**`**: log (unit/e2e/lint/typecheck) dan screenshot M1 tidak
  memuat password/hash/key. (`e2e.log` m1/m2/m3 identik — log run gabungan.)
- I-1-5 **Header keamanan**: `next.config.ts` tidak memasang CSP/`X-Frame-Options`/
  `Referrer-Policy`, `poweredByHeader` default aktif. Wajar untuk M1; masukkan ke hardening M6.
- I-1-6 **Auth**: belum ada login/autentikasi (scope M6). Status server di top bar masih data
  statis (`server-status.tsx`), tidak ada klaim keamanan yang keliru.
- I-1-7 `npm audit --omit=dev`: 0 critical, 0 high, 4 moderate, 2 low (semua via `shadcn`, lihat
  SR-1-1). `next@16.4.5`, `zod@^4.6.7`, `unixcrypt@^4.0.0` tanpa advisory.

## Ringkasan

| Severity | Jumlah |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 1 |
| info | 7 |

Tidak meng-approve; keputusan ada di gatekeeper.
