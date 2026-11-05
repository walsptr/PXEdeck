# DEC-005: Seam store mock untuk test tanpa endpoint test
- Tanggal: 2026-11-05T06:21:00Z
- Milestone: 2, 3
- Status: Accepted
## Konteks
Store mock in-memory (`src/lib/server/mock-hosts.ts`) bergantung pada jam, `Math.random`, dan
discovery tiap 40 detik, serta tidak bisa di-reset (gap G2-1). Test butuh keadaan deterministik.
## Opsi yang dipertimbangkan
1. Fungsi `resetMockStore(seed?)` + env (`PXE_MOCK_SIMULATION=off`,
   `PXE_MOCK_DISCOVER_EVERY_MS`, `PXE_MOCK_SEED=empty|default`) — tanpa permukaan HTTP baru.
2. Endpoint `POST /api/__test__/store` aktif bila `PXE_TEST_SEAM=1` — fleksibel, tetapi endpoint
   tanpa auth yang bisa tertinggal aktif.
## Keputusan
Opsi 1 (paling aman terhadap SPEC §6). E2E empty/error state memakai `page.route`.
Simulasi tetap default aktif untuk mode dev agar dashboard terlihat hidup.
## Konsekuensi
- Store mock diganti persistence nyata di M4; seam yang sama (reset via fungsi, bukan HTTP)
  dipertahankan untuk DB test (database sementara per test run).
- Tidak boleh ada route `__test__` di kode produk.
