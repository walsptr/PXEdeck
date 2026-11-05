# AC matrix M3 — test-engineer
Sumber status: `unit.log` (`npm run test`: 244 test, 243 lulus, 1 gagal, exit 1), `e2e.log` (`npm run test:e2e`: 42 lulus, 0 gagal, exit 0), `typecheck.log`/`lint.log` (exit 0). Coverage DEC-004: lines 99.64%, branches 97.90% (`coverage-summary.txt`/`.json`). Satu codebase untuk M1–M3, log sama di m1/m2/m3.

| AC | File test | Nama test | Status |
|---|---|---|---|
| AC-3.1 | dashboard/src/lib/net.test.ts | AC-3.1 isIpv4 · validateStaticIp (pesan berbeda per aturan) · planIps (range, increment, skipUsed true/false, range habis) · validateIpAssignments; DEC-006 validateStaticNetwork & mgmtNetworkFromEnv; dashboard/src/lib/server/net-config.test.ts | PASS |
| AC-3.2 | dashboard/src/lib/hostname.test.ts | AC-3.2 validateHostname · renderHostnames (node-{index:02}, startIndex, web-{mac_suffix}, {prefix}-{ip_last_octet}, token asing, duplikat & dipakai host lain) | PASS |
| AC-3.3 | dashboard/src/lib/credentials.test.ts | AC-3.3 validateUsername · validatePassword · generatePassword (alfabet, 100 unik) · parseCsv/toCsv round-trip · normalizeMac | PASS |
| AC-3.4 | dashboard/src/lib/ssh-key.test.ts (fixture dashboard/src/test/fixtures.ts) | AC-3.4 parseSshKey (ed25519/rsa/ecdsa; tolak private, ssh-dss, base64 rusak, tipe dalam beda) · sshFingerprint = ssh-keygen -lf | PASS |
| AC-3.5 | dashboard/src/app/api/config-routes.test.ts; dashboard/src/lib/server/http.test.ts; dashboard/src/lib/host-config.test.ts | AC-3.5 › bukan JSON 400 · prefix 40 / hostIds [] / mode asing → 400 section benar · semantik 422 per bagian · tanpa bagian 422 · id 400/404 | PASS |
| AC-3.6 | dashboard/src/app/api/config-routes.test.ts | AC-3.6 atomik › network valid + hostname bentrok → 422 tanpa perubahan · valid → 200 {updated: N}; config-service.test.ts G3-2 paralel | PASS |
| AC-3.7 | dashboard/src/app/api/config-routes.test.ts | AC-3.7 network › bentrok IP mgmt (incl. host offline) · bentrok lease aktif · duplikat batch · gateway/DNS bukan IPv4, prefix ≠ subnet · DHCP hapus mgmtIp · tidak bentrok dengan diri sendiri · subnet env | PASS |
| AC-3.8 | dashboard/src/app/api/config-routes.test.ts | AC-3.8 › same: SHA-512 crypt + unixcrypt.verify, salt beda · password kosong · invalid · random: generatedPasswords sekali · GET config tanpa hash/password | PASS |
| AC-3.9 | dashboard/src/app/api/config-routes.test.ts | AC-3.9 CSV import › hasil per baris (offset header) + tiap error · tanpa header/kosong · payload invalid 400 · bulk csv invalid → 422 tanpa efek · csv valid | PASS |
| AC-3.10 | dashboard/src/app/api/config-routes.test.ts | AC-3.10 › hostname invalid/duplikat/dipakai · keyIds tak ada · key baru invalid (nomor) · saveToLibrary tanpa nama · key valid → GET /api/ssh-keys fingerprint · extraKeys · duplikat fingerprint (G3-3) · tanpa key | PASS |
| AC-3.11 | dashboard/src/app/api/config-routes.test.ts | AC-3.11 install › single siap → started/booting · tanpa OS/creds, provisioning, id tak dikenal → failed 422 · bulk campuran 200 / tidak ada 422 | PASS |
| AC-3.12 | dashboard/e2e/m3-sheet.spec.ts | AC-3.12 Sheet single host: lima tab, isi tiap tab, simpan → PATCH + toast + tabel ter-update | PASS |
| AC-3.13 | dashboard/e2e/m3-sheet.spec.ts; dashboard/src/components/host-config/form-state.test.ts | AC-3.13 validasi UI per tab menonaktifkan simpan; 422 server tampil di tab yang benar; sectionErrors (unit) | PASS |
| AC-3.14 | dashboard/e2e/m3-bulk.spec.ts | AC-3.14 preview bulk (IP, hostname, CSV) tanpa request simpan; password acak sekali tampil + CSV | PASS |
| AC-3.15 | dashboard/e2e/m3-bulk.spec.ts | AC-3.15 Simpan & Install: dialog, Batal tanpa request, install → Booting · bulk: dialog menyebut jumlah host | PASS |

Risiko M3 (password di log): e2e.log dan unit.log di-grep untuk password fixture `DUMMY_PASSWORD` → 0 kemunculan. Kolom password di screenshot ac-3.14-passwords-dialog di-mask.
Pendukung coverage: form-state.test.ts, config-service.test.ts, hooks.test.ts.
