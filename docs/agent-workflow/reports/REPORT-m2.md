# Report Milestone 2
## Ringkasan
Halaman Hosts: tabel TanStack Table v9 (checkbox, MAC mono + copy, hostname, IP lease + management, vendor OUI, OS, pill status pastel, last seen relatif, aksi per baris), polling 5 detik, pencarian MAC/hostname/IP (termasuk format Cisco), filter status & OS, bulk action bar, empty state, API mock in-memory dengan seam test (DEC-005).
## Acceptance criteria
| Kriteria | Status | Bukti |
|---|---|---|
| AC-2.1 – AC-2.14 (docs/design/M2-plan.md) | Lulus (14/14) | .agent/runs/m2/ac-matrix-iter3.md |
## Perubahan utama
- `components/hosts/*`, `hooks/use-hosts.ts`, `hooks/use-now.ts` (sinkron jam server), `lib/{types,oui,format}.ts`.
- `lib/server/mock-hosts.ts` (`resetMockStore`, env `PXE_MOCK_*`), `app/api/hosts/**` (validasi id 400/404, `no-store`, guard Origin/Content-Type/413).
## Iterasi & temuan
- Iterasi 1: `formatRelative` menghasilkan "kemarin dulu" (CR-2-1) → `numeric: "always"`; komentar password plaintext di seed mock (G-SEC-2) → hash demo acak.
- Iterasi 2: DR-1-2 lintas milestone.
- Iterasi 3: APPROVED (APR-002).
## Risiko & utang teknis
- Data masih mock in-memory; diganti SQLite di M4 (DEC-007) tanpa mewarisi seed credentials.
- CR-2-11, DR-2-3 (kosmetik).
## Blocker (jika ada)
Tidak ada.
## Langkah berikutnya
M4: persistence nyata + discovery host dari iPXE/lease dnsmasq.
