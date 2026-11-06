# M7 — AC → test (trace)

Diperbarui test-engineer **gate final iter1**, 2026-11-07, kode produk `339f234` (final) + perbaikan flake test E2E `9f64843`. Bukti mentah
run ini di `.agent/runs/m7/final/`:

- `unit.log`: 89 file / 2123 test lulus, EXIT=0 (coverage v8; `coverage-summary.txt`, `coverage-m7-new-code.txt`)
- `test-process.log`: 2 file / 15 test lulus, EXIT=0
- `infra-test-run{1..10}.log`: `infra/test/run.sh` 10× berurutan (113 test/run) — 8/10 run 113/113 lulus; run 4 dan run 8 masing-masing **1 gagal** di test regresi M6 (`M6 BUG-M6-10 verify node1 gagal …`, `M6 verifikasi parsial setelah Playwright gagal …`), keduanya kvm-run dry-run exit 141 = race SIGPIPE di `infra/deploy-dashboard.sh:121-125` (kode infra, dilaporkan, tidak diperbaiki test-engineer; `final/flaky-ac717.txt`). Semua 37 test M7/DEC-027 shell lulus di 10/10 run
- `e2e-run1.log`, `e2e-run2.log` (`--retries=0 --workers=1`): masing-masing **203 lulus, 0 gagal/flaky/skipped/did-not-run** (setelah perbaikan flake test 9f64843; run pra-perbaikan `final/e2e-prefix-run0.log` 202 lulus/1 gagal di `m6-ui-iter2.spec.ts` "Sesi berakhir…" = race test, lihat `test-migration.md`)
- KVM (tidak dijalankan ulang; bukti T11): `.agent/runs/m7/kvm/results.json` — run efektif vlansmoke,
  vlanneg, vlancore, vlandistro, flat-debian, semua `PASS`, setiap run punya entri `cleanup` PASS.

Status: **PASS** = test ada dan lulus pada run gate final ini (atau, untuk AC kvm, entri PASS di
`kvm/results.json` milik run T11); **pending** = di luar gate M7 (AC-7.32, setelah APR).

Singkatan file:

- `net-vlan` = `dashboard/src/lib/m7-net-vlan.test.ts` (dev T1)
- `api-vlan` = `dashboard/src/app/api/m7-vlan-api.test.ts` (dev T1)
- `gen-vlan` = `dashboard/src/lib/server/installers/m7-vlan-generators.test.ts` (dev T2)
- `deb-noroute` = `dashboard/src/lib/server/m7-debian-no-route.test.ts` (dev T2b, DEC-025 §1)
- `deb-ns` = `dashboard/src/lib/server/m7-debian-nameservers.test.ts` + `dashboard/src/app/boot/m7-debian-nameservers-route.test.ts` (dev T2c, DEC-026 §1)
- `fs-vlan` = `dashboard/src/components/host-config/form-state-vlan.test.ts` (dev T6)
- `ui-vlan` = `dashboard/src/components/host-config/m7-vlan-ui.test.tsx` (dev T6)
- `hooks-vlan` = `dashboard/src/hooks/m7-settings-hooks.test.ts` (dev T6)
- `plan-a11y` = `dashboard/src/components/host-config/plan-table-a11y.test.tsx` (dev, perbaikan F-T8-1)
- `te-cb` = `dashboard/src/app/boot/m7-te-vlan-callback.test.ts` (T7)
- `te-env` = `dashboard/src/lib/server/m7-te-vlan-env.test.ts` (T7)
- `te-gen` = `dashboard/src/lib/server/installers/m7-te-generators.test.ts` (T7)
- `e2e-vlan` = `dashboard/e2e/m7-vlan.spec.ts` (T8; server `m7-vlan` :3118 dengan `PXE_VLAN_NETWORKS`)
- `e2e-novlan` = `dashboard/e2e/m7-novlan.spec.ts` (T8; server bersama :3100 tanpa env)
- `login-e2e` = `dashboard/e2e/m7-login-no-url-creds.spec.ts`; `login-unit` = `dashboard/src/components/auth/m7-login-no-url-creds.test.tsx` + `dashboard/src/app/login/submit/route.test.ts` (DEC-027 §1)
- `urlcred` = `dashboard/src/lib/server/m7-kvm-urlcred.test.ts` (DEC-027 §4)
- `infra` = `infra/test/m7-infra.sh` (dev T3–T5), `infra-te` = `infra/test/m7-te.sh` (T9),
  `infra-d27` = `infra/test/m7-dec027.sh` (DEC-027 §2); semuanya dijalankan `infra/test/run.sh`
- `kvm:<run>` = entri `.agent/runs/m7/kvm/results.json` → `runs.<run>.results[]`, bukti di `kvm/<run>/`

| AC | Jenis | Test (file : nama) | Status |
|---|---|---|---|
| AC-7.1 | unit | net-vlan : "AC-7.1 vlanNetworksFromEnv (murni)" (satu entri; CIDR dinormalisasi; kosong → []; 16/17 entri; `it.each` VLAN 0/4095/teks/negatif/desimal, VLAN ganda, /7, /31, gateway network/broadcast/luar CIDR, tumpang tindih PXE_MGMT_CIDR, dua entri tumpang tindih, pemisah → "Error berawalan PXE_VLAN_NETWORKS"); api-vlan : "AC-7.1 settings PXE_VLAN_NETWORKS" (settingsFromEnv, fail fast, SETTINGS_ENV_KEYS, contoh .env.example) | PASS |
| AC-7.2 | integration | api-vlan : "AC-7.2 GET /api/settings & /api/network" ("dengan env: kedua respons memuat vlanNetworks identik; no-store", "tanpa env: tanpa kunci vlanNetworks (bentuk M6 persis)", "env tidak valid → 500", "tanpa sesi → 401"); api-vlan : "toSettingsResponse …"; hooks-vlan | PASS |
| AC-7.3 | unit | net-vlan : "AC-7.3 validasi IP statis VLAN terdaftar (VLAN 20)" + "AC-7.3 regresi DEC-006: vlan null / VLAN 99 tidak terdaftar = subnet management apa adanya"; `net.test.ts` & `net-carryover.test.ts` lama tidak berubah dan lulus | PASS |
| AC-7.4 | integration | api-vlan : "AC-7.4 PATCH /api/hosts/:id + POST /api/hosts/bulk dengan VLAN terdaftar" (200 + tersimpan; `it.each` 422 section network tanpa perubahan DB; bentrok mgmt_ip & lease; bulk 3 host; "dua request paralel dengan IP VLAN sama → tepat satu sukses") | PASS |
| AC-7.5 | integration | te-cb : "AC-7.5 regresi binding IP (F6) dengan host ber-VLAN 20" (user-data hanya dari lease; status/log dari 10.99.20.41 → 200, done menyetel current_ip; IP lain → 404 seragam; MAC salah → 404; token dicabut setelah done) | PASS |
| AC-7.6 | unit (+integration) | te-env : "AC-7.6 infra/server/dashboard-vlan.env di-parse settingsFromEnv (production)" (placeholder hash ditolak, isLocalMedia, Debian VLAN 20, varian media 10.99.0.2 → debianExternalMediaError, PXE_SERVER_IP 10.99.20.1 ditolak, startOrExit exit 1, identik dashboard.env selain blok VLAN); te-cb : "AC-7.6 (integration) …" | PASS |
| AC-7.7 | unit, golden | gen-vlan : "AC-7.7 Ubuntu netplan VLAN" (golden `ubuntu-user-data-vlan.yaml`); te-gen : "AC-7.7 Ubuntu netplan VLAN (iface by name, id lain, tanpa VLAN)"; golden M6 tidak berubah (installers.test.ts) | PASS |
| AC-7.8 | unit | gen-vlan : "AC-7.8 Debian ifupdown VLAN" (golden `debian-late-vlan.sh`); te-gen : "AC-7.8 Debian VLAN: tanpa paket tambahan (O10), perbedaan hanya di stanza"; deb-noroute (DEC-025 §1); deb-ns (DEC-026 §1) | PASS |
| AC-7.9 | unit | gen-vlan : "AC-7.9 Rocky kickstart VLAN" + "AC-7.9 Rocky %post native tanpa IPv4 (fixture NetworkManager, sh)"; te-gen : "AC-7.9 Rocky VLAN pelengkap" | PASS |
| AC-7.10 | e2e | e2e-vlan : "petunjuk mono, isi otomatis prefix/gateway, validasi subnet VLAN, gateway manual dipertahankan, VLAN dikosongkan → subnet PXE, simpan vlan 20 → 200"; e2e-vlan : "422 server (luar subnet / gateway / bentrok) tampil di tab Network, DB tidak berubah"; e2e-vlan : "VLAN 99: petunjuk teks utama …"; komponen: ui-vlan, fs-vlan | PASS (run1+run2) |
| AC-7.11 | e2e | e2e-vlan : "range mulai 10.99.20.41: pratinjau .41/.43/.44 (.42 storage-02 dilewati), simpan → tersimpan identik dengan pratinjau"; komponen: ui-vlan, fs-vlan | PASS (run1+run2) |
| AC-7.12 | e2e | e2e-vlan : "GET /api/settings & /api/network memuat vlanNetworks terdaftar (identik)", "/settings: card VLAN · Subnet · Gateway (mono) …; 4 lebar tanpa overflow", "/settings dengan VLAN: axe 0 pelanggaran (375/768/1280/1440)", "Sheet satu host VLAN (valid / invalid / tidak terdaftar): axe, tanpa overflow di 4 lebar", **"Sheet bulk VLAN 20 (pratinjau): axe, tanpa overflow di 4 lebar"** (F-T8-1, diperbaiki d002fe6; komponen: plan-a11y); e2e-novlan : 3 test (API tanpa kunci, /settings empty state + axe, Sheet tanpa VLAN). Ringkasan axe: `final/axe-summary-run{1,2}.txt`; filter `support/axe.ts` tidak berubah sejak m6-approved (diff hanya path default + komentar, `final/skip-weakening.txt` §5) | PASS (run1+run2) |
| AC-7.13 | e2e regresi | suite penuh 2× (`final/e2e-run1.log`, `final/e2e-run2.log`): semua spec M1–M6 + M7 lulus; `final/skip-weakening.txt`: 0 file test lama turun asersi vs `m6-approved`, 0 file test M7 turun vs commit penambahannya, grep skip/only/todo/fixme = 0, config vitest tidak berubah, playwright.config tanpa perubahan retries/forbidOnly/timeout/workers | PASS (run1+run2) |
| AC-7.14 | static-shell | infra : "M7 XML network trunk/port1/port2 tanpa ip/forward/dhcp", "M7 net-up/net-down --topology vlan, idempoten, flat tetap", "M7 net-up menolak XML berisi ip/forward/dhcp/nama salah"; infra-te : "M7te assert_name …", "M7te net-up/net-down vlan (palsu) …" | PASS (10/10 run) |
| AC-7.15 | unit-shell | infra : "M7 switch-up dry-run: overlay/seed, 4 NIC, RAM<=1024, tanpa NAT", "M7 pxe-switch.sh apply/apply-port: perintah tabel §2.2", "M7 pxe-switch.sh verify PASS/FAIL" | PASS (10/10 run) |
| AC-7.16 | static-shell + unit-shell | infra : "M7 profil server VLAN statis …", "M7 verify-listen-vlan.sh: PASS / FAIL + stop dnsmasq", "M7 verify-listen-vlan.sh wajib DHCP dnsmasq udp %pxe10:67 (DEC-026 §3)", "M7 server-up --topology vlan dry-run", "M7 deploy-dashboard --topology vlan"; infra-te : "M7te nginx VLAN …", "M7te verify-listen-vlan: kasus FAIL tambahan …"; infra-d27 : 4 test access log nginx (DEC-027 §2) | PASS (10/10 run) |
| AC-7.17 | unit-shell + static | infra : "M7 relay.sh: mode/NODE_IP ditolak, key 0600 tidak dicetak", **"M7 host tidak pernah menyasar 10.99.10.*/10.99.20.* (AC-7.17)"**, "M7 kvm-run gagal tiap tahap VLAN …"; infra-te : "M7te relay key via stdin 0600 …", "M7te statis: script server/switch & Playwright tidak menyasar VLAN" | PASS (test AC-7.17 lulus 10/10 run penuh); suite infra punya flake produk terpisah (SIGPIPE deploy-dashboard.sh dry-run, `final/flaky-ac717.txt`) |
| AC-7.18 | unit-shell | infra : "M7 verify-node.sh EXPECT_VLAN OK/FAIL"; infra-te : "M7te verify-node tanpa EXPECT_VLAN = jalur M6", "M7te verify-node EXPECT_VLAN invalid → 99 …"; regresi `m6.sh`, `m6-bug10.sh` | PASS (10/10 run) |
| AC-7.19 | unit-shell | infra : "M7 kvm-run skenario VLAN …", "M7 kvm-run max_nodes kurangi RAM server+switch", "M7 cleanup.sh --switch …", "M7 kvm-run gagal tiap tahap VLAN …"; infra-te : "M7te kvm-run gagal di SETIAP tahap → entri cleanup", "M7te cleanup.sh --switch dry-run …", "M7te skenario flat core/distro/bulk tanpa artefak VLAN" | PASS (10/10 run) |
| AC-7.20 | kvm | kvm:vlancore `AC-7.20` PASS ("topologi & perimeter sesuai §2.1–2.3"): `kvm/vlancore/switch-check.txt`, `server-listen-vlan.txt`, `ac-7.20-perimeter.txt`, `ac-7.20-server-net.txt`, `kvm-run-preflight.txt` | PASS (T11) |
| AC-7.21 | kvm (gate) | kvm:vlancore `AC-7.21` node31 UEFI Ubuntu PASS (booting→installing→configuring→done 668 s; verify 0 FAIL; MTU ok; job 1) + `verify-node` node31 PASS (EXPECT_VLAN=20 lewat relay + login password ditolak) + `CR-4-12-dnsmasq/nginx` node31 PASS; reboot tanpa reinstall di `pxe-test-m7vlancore-node31-timeline.txt` (job 1→1, penanda installer 4→4); pcap `capture-trunk0*.txt` | PASS (T11) |
| AC-7.22 | kvm (gate) | kvm:vlancore `AC-7.22` node32 BIOS Ubuntu PASS (done 487 s; verify 0; MTU ok; job 1) + `verify-node`/`CR-4-12-nginx` node32 PASS; timeline node32 | PASS (T11) |
| AC-7.23 | kvm | kvm:vlancore `AC-7.23` PASS ("UI error field + 3× API 422, konfigurasi tidak berubah"), `kvm/vlancore/ac-7.23-validation.txt`; logika sama di api-vlan AC-7.4 | PASS (T11) |
| AC-7.24 | kvm | kvm:vlandistro `AC-7.24` node33 UEFI Debian 12 PASS (done 601 s; verify 0; MTU ok; job 1) + `verify-node`/`CR-4-12-*` node33 PASS (commit 6a26cc6, setelah DEC-027) | PASS (T11) |
| AC-7.25 | kvm | kvm:vlandistro `AC-7.25` node34 UEFI Rocky 9 PASS (done 497 s; verify 0; MTU ok; job 1) + `verify-node`/`CR-4-12-*` node34 PASS | PASS (T11) |
| AC-7.26 | kvm | kvm:vlanneg `AC-7.26-28-final` PASS (node36 segmen admin: dashboard tanpa host negatif, dnsmasq/nginx tanpa jawaban); `kvm/vlanneg/pxe-test-m7vlanneg-node36-*` | PASS (T11) |
| AC-7.27 | kvm | kvm:vlanneg `AC-7.26-28-final` PASS (node37 port2 access20); `kvm/vlanneg/pxe-test-m7vlanneg-node37-*` | PASS (T11) |
| AC-7.28 | kvm | kvm:vlanneg `AC-7.26-28-final` PASS (node38 port2 tagged10; sw-p2 kembali access20); `kvm/vlanneg/pxe-test-m7vlanneg-node38-*` | PASS (T11) |
| AC-7.29 | kvm | kvm:vlancore `AC-7.29` ×4 PASS (node31/node32: ip_forward=0, host GET /api/hosts dengan sesi 200, probe lewat relay: ping 10.99.0.1 unreachable, curl /api/hosts 403); `*-probe.txt` | PASS (T11) |
| AC-7.30 | kvm | setiap run efektif (vlansmoke, vlanneg, vlancore, vlandistro, flat-debian) punya entri `cleanup` PASS (`protectedIdentical`, `switchStopped`, `relayClean`, sisa domain 0) dan `AC-7.30-scan` PASS; scan ulang gate final atas `.agent/runs/m7/**` (teks + base64 + URL kredensial): `final/secret-scan.txt` 0 secret/password plaintext (triage di akhir file); struktur entri `cleanup` juga diuji infra/infra-te AC-7.19; urlcred + infra-te "M7te redact URL kredensial" (DEC-027 §4) | PASS |
| AC-7.31 | static | infra-te : "M7te README §Topologi VLAN + .env.example", "M7te diff M7 tanpa hash/private key nyata"; api-vlan : "contoh (dikomentari) di .env.example valid …" | PASS (10/10 run) |
| AC-7.32 | infra | teardown setelah APR | **pending (T12, setelah APR; bukan bagian gate M7)** |

Pelengkap DEC-027 (bukan AC bernomor; dicatat untuk gate): §1 login tanpa kredensial di URL — login-unit
(lulus di `unit.log`) + login-e2e 4 test (lulus di e2e-run1 + e2e-run2); §2 access log nginx tanpa query string non-/boot —
infra-d27 (10/10 run); §4 scan URL kredensial — urlcred + infra-te.

Ringkasan (32 AC): 31 AC (AC-7.1–7.31) punya ≥ 1 test dan berstatus PASS pada bukti gate final (unit/integration 2123 lulus; E2E 203×2 lulus; infra shell M7 37 test × 10 run lulus; KVM T11 PASS);
AC-7.32 menunggu T12 setelah APR.
