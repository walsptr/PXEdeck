# DEC-007: Persistence memakai SQLite bawaan Node (`node:sqlite`)
- Tanggal: 2026-11-05T07:05:00Z
- Milestone: 4
- Status: Accepted
## Konteks
Store mock in-memory (M2–M3) harus diganti persistence nyata dengan model data SPEC §5 (hosts,
host_configs, os_images, ssh_keys, jobs). Dashboard berjalan di satu VM PXE server (DEC-003),
satu proses, tanpa layanan DB terpisah. Opsi lengkap: `docs/design/M4-options.md` §O1.
## Opsi yang dipertimbangkan
1. `node:sqlite` (bawaan Node ≥ 22.13) — tanpa dependensi native, transaksi sinkron (validasi +
   apply atomik, menutup race G3-2 secara struktural), constraint UNIQUE. Kekurangan: API masih
   ditandai experimental di sebagian versi Node.
2. `better-sqlite3` — matang, tetapi butuh build native per platform/Node di VM server.
3. File JSON — tanpa constraint/transaksi; rawan korup dan race.
## Keputusan
Opsi 1, dengan lapisan repository tipis (`src/lib/server/db/`) agar bisa diganti ke opsi 2 lewat
decision baru bila `node:sqlite` bermasalah. Migrasi skema berversi di kode. Path DB lewat env
(`PXE_DB_PATH`); test memakai DB sementara per run (seam DEC-005: reset lewat fungsi, bukan HTTP).
Node di VM server: rilis LTS resmi dari nodejs.org (versi sama dengan host, 22.x).
## Konsekuensi
- Constraint UNIQUE (mac, mgmt ip, hostname, fingerprint) menjadi lapis kedua di bawah validasi.
- Warning experimental Node dicatat dan disaring dari log, bukan disembunyikan dari bukti.
