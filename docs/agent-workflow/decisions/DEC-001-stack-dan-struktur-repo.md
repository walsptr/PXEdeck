# DEC-001: Stack dan struktur repo
- Tanggal: 2026-11-05T05:40:00Z
- Milestone: 1
- Status: Accepted
## Konteks
SPEC meminta Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Table, dan
workflow multi-agent dengan branch per milestone, merge ke `main` lokal, dan tag. Folder project
sebelumnya bukan repo git; `dashboard/` punya repo git sendiri (1 commit otomatis
create-next-app). Lab PXE asli (`configs/`, `scripts/`) sudah diuji end-to-end dan harus tetap utuh.
## Opsi yang dipertimbangkan
1. Satu repo git di root (`PXE-BOOT/`), `dashboard/` sebagai sub-folder — satu riwayat untuk
   kode, infra test, docs, dan bukti; branch/tag milestone sederhana. Kekurangan: riwayat 1 commit
   create-next-app tidak ikut.
2. Pertahankan repo terpisah di `dashboard/` dan root — merge/tag dua kali, bukti dan kode
   terpisah, rawan tidak sinkron.
3. Git submodule — kompleks tanpa manfaat (tidak ada remote).
## Keputusan
Opsi 1. Repo di root dengan branch `main`. `dashboard/.git` dipindah (tidak dihapus) ke
`.agent/archive/dashboard-git`. Stack: Next.js 16.4 (App Router, `cacheComponents`), React 19,
TypeScript 5, Tailwind v4, shadcn/ui (base radix, style maia, ikon Hugeicons), TanStack Table v9,
TanStack Query v5, zod v4, `unixcrypt` untuk SHA-512 crypt (output identik dengan
`openssl passwd -6`). Test: Vitest (unit/integration, coverage v8) + Playwright (E2E). npm.
## Konsekuensi
- Semua agent bekerja dari root; perintah npm dijalankan di `dashboard/`.
- `.agent/media|vms|keys|archive` di-gitignore; `.agent/runs/` (bukti teks) di-commit.
- Next 16 dan TanStack Table v9 punya API yang berbeda dari versi umum; dev wajib membaca docs
  bawaan di `node_modules` (lihat `dashboard/AGENTS.md`).
