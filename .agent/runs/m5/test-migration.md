# M5 — migrasi test lama (backend-dev)

Setiap perubahan pada test/fixture yang sudah ada akibat perubahan perilaku yang disengaja di M5.
Tidak ada asersi yang dihapus, di-skip, atau dilonggarkan. Perubahan semantik (bila ada) ditandai
**[semantik → test-engineer]** untuk ditinjau test-engineer.

| # | File | Perubahan | Dasar | Jenis |
|---|---|---|---|---|
| 1 | `src/app/api/{config-routes,iter2-routes,m4-api-routes}.test.ts`, `src/app/api/hosts/hosts-routes.test.ts`, `src/app/boot/boot-routes.test.ts` | Pemanggilan handler GET tanpa argumen (`hostsGET()`, `settingsGET()`, …) kini memberi `getReq("/api/…")` (helper baru di `src/test/route.ts`, Host `localhost` = diizinkan default). | DEC-015 §1 / plan §2.6: setiap GET `/api/**` memeriksa allowlist Host → handler menerima `Request`. | Mekanis (signature) |
| 2 | `src/app/boot/boot-routes.test.ts` (`KVM_ENV`) | + `PXE_INSECURE_NO_LEASE_CHECK: "1"`. Test yang menguji verifikasi lease tetap memakai `writeLeases()` (fixture lease aktif mengalahkan flag). | DEC-013: `PXE_TRUST_PROXY=1` tanpa `PXE_DNSMASQ_LEASES` → server menolak start kecuali flag dev; Konsekuensi DEC-013 mengizinkan "menyetel fixture lease atau flag secara eksplisit". | Fixture |
| 3 | `src/lib/server/boot-script.test.ts` (`requestIp membaca PXE_TRUST_PROXY`) | + `PXE_DNSMASQ_LEASES` saat `PXE_TRUST_PROXY=1`. | DEC-013 (fail-closed). | Fixture |
| 4 | `src/app/api/iter2-routes.test.ts` (2 test: "Origin sama (Host / X-Forwarded-Host)…", "PXE_ALLOWED_HOSTS: entri tanpa port…") | + `PXE_TRUST_PROXY=1` dan `PXE_DNSMASQ_LEASES` sebelum request yang mengandalkan `X-Forwarded-Host`. Asersi (501/200/403) tidak berubah. | CR-4-15/SR-4-9 (carry-over gate M4, plan §2.6): `X-Forwarded-Host` hanya dibaca bila proxy dipercaya. Tanpa fixture ini header diabaikan (perilaku baru yang benar). | Fixture |
| 5 | `src/lib/server/settings.test.ts` ("variasi valid…") | `PXE_TOKEN_TTL_MIN: "5"` kini disertai timeout tahap 1/2/1 menit. | DEC-014 §2: TTL token ≥ jumlah timeout tahap (default 240 mnt). | Fixture |
| 6 | `src/lib/server/settings.test.ts`, `src/app/api/m4-api-routes.test.ts` (bentuk `toSettingsResponse` / `GET /api/settings`, `toEqual`) | Objek harapan + `jobTimeouts`, `maxInstallerBoots`, `insecureNoLeaseCheck`. Pemeriksaan "tanpa path DB/rahasia" tetap. | AC-5.1: respons wajib memuat ketiga kunci itu. **[semantik → test-engineer]** (perluasan kontrak) | Ekspektasi diperluas |
| 7 | `dashboard/playwright.config.ts` server `m4-settings` | + `PXE_DNSMASQ_LEASES: e2eLeaseFile("m4-settings")` (file lease kosong). | DEC-013: server dengan `PXE_TRUST_PROXY=1` tanpa lease tidak start. Spec `m4-settings` tidak bergantung pada installer. | Fixture E2E |
