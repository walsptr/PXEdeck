# Report Milestone 1
## Ringkasan
Fondasi dashboard: Next.js 16 + shadcn/ui (radix, maia) dengan design tokens SPEC §1 (kanvas krem, ink, oranye hanya CTA, tanpa shadow, Inter + JetBrains Mono), sidebar + top bar 64px + pencarian global Ctrl+K + status server, halaman kerangka, dan tooling test (Vitest + Playwright) sesuai DEC-004. Kode awal dibuat sebelum workflow (DEC-002) lalu diverifikasi, dilengkapi, diuji, dan direview oleh subagent.
## Acceptance criteria
| Kriteria | Status | Bukti |
|---|---|---|
| AC-1.1 – AC-1.12 (lihat docs/design/M1-plan.md) | Lulus (12/12) | .agent/runs/m1/ac-matrix-iter3.md, e2e-iter3.log, unit-iter3.log |
## Perubahan utama
- `dashboard/src/app/globals.css` (tokens, tipografi, radius, shadow nol), `components/ui/*` (restyle: button/input/checkbox/switch/radio/table/sonner).
- `components/{app-sidebar,top-bar,server-status,status-pill}.tsx`, `lib/nav.ts`.
- `vitest.config.mts`, `playwright.config.ts` (forbidOnly, server per spec, guard spec yatim).
## Iterasi & temuan
- Iterasi 1: run test bersama gagal (AC-2.2); CR-1-1 proteksi `.only` dan reuse server hanya aktif saat `CI` → diperbaiki.
- Iterasi 2: DR-1-2 toast Sonner masih punya drop shadow → `shadow-none!` + hairline + radius 12px, dibuktikan E2E (uji mutasi: 3/3 gagal pada kode lama).
- Iterasi 3: APPROVED (APR-001).
## Risiko & utang teknis
- Toast masih memakai font `ui-sans-serif` (DR-1-3); guard spec Playwright non-rekursif (CR-1-10); status DHCP/TFTP/HTTP masih statis (CR-1-7).
- Hook `.claude/hooks/guard_bash.py` baru aktif di tengah sesi; agent kustom `.claude/agents/*` baru terbaca di sesi berikutnya (dijalankan sebagai general-purpose dengan definisi peran yang sama).
## Blocker (jika ada)
Tidak ada.
## Langkah berikutnya
Carry-over ke M4: DR-1-3, CR-1-7, CR-1-10.
