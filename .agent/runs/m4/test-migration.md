# M4 — Migrasi test lama (store mock → DB SQLite)

Branch `milestone/4-backend-ipxe`. Mencakup commit WIP `4004806` (migrasi sebagian, sesi
sebelumnya) dan sesi test-engineer ini. Prinsip: tidak ada test yang di-skip/dihapus untuk
membuat suite lulus; test lama yang tidak relevan lagi hanya karena **perilaku yang sengaja
diubah lewat plan/decision** diganti test perilaku baru (sumber perubahan dicantumkan). Tidak ada
assertion yang dilonggarkan tanpa alasan di bawah.

Sumber perubahan perilaku:
- **P1** plan M4 §1.1 / DEC-007: store mock + simulasi tahap/discovery dihapus dari jalur
  produksi; persistence `node:sqlite`, seam `resetDb(seed)` (DEC-005).
- **P2** carry-over SR-2-1 / CR-3-12 (gate M3): seed/DB tidak boleh mewarisi hash password atau
  key `wals@wal`; host tanpa credentials eksplisit ditolak install.
- **P3** DEC-012: "Reboot ke PXE" nonaktif + API 501 (tanpa kendali daya out-of-band).
- **P4** plan §2.2: id OS kanonik (`ubuntu-24.04.5`→`ubuntu-24.04`, `rocky-9.4`→`rocky-9`, label
  "Rocky Linux 9").
- **P5** M4-T8: klien membaca parameter jaringan dari `GET /api/settings` (superset
  `/api/network`, AC-4.6); status server nyata `GET /api/server-status` (CR-1-7);
  `/settings` bukan placeholder lagi.
- **P6** plan §2.4: install butuh media image di `PXE_MEDIA_ROOT`.

## 1. `src/lib/server/mock-hosts.test.ts` → `src/lib/server/db/db.test.ts`

| Test lama | Status | Pengganti / alasan |
|---|---|---|
| AC-2.3 setelah reset 14 host seed, id = MAC tanpa `:`, vendor = OUI | Dipertahankan + diperkuat | `AC-2.3 (M4) seed demo … > seed demo: 14 host…` (+ `getHostByMac`, urutan MAC, status seed) |
| AC-2.3 booting → installing (20 dtk) → configuring → done (simulasi jam) | Diganti (P1) | Transisi kini dari sinyal nyata: `boot-routes.test.ts` AC-4.15 (booting), AC-4.23 (installing saat fetch user-data), AC-4.26 (callback configuring/done/failed, `osInstalled`, `osAssigned=null`, `current_ip`); E2E `m4-discovery.spec.ts` AC-4.27 (pill Booting→Done tanpa refresh) |
| AC-2.3 discovery menambah host tiap 40 dtk (maks 4) | Diganti (P1) | Discovery nyata: `boot-routes.test.ts` AC-4.8, AC-4.11 (lease); E2E `m2-polling.spec.ts` (AC-2.9/AC-4.12), `m4-discovery.spec.ts` |
| AC-2.3 discovery tidak menambah ulang host yang ada | Diganti (P1) | AC-4.8 "panggilan kedua tidak menduplikasi"; AC-4.11 "kedua kali: tidak ada duplikat"; E2E m2-polling "request kedua … tidak menduplikasi baris" |
| AC-2.3 lease host online diperbarui bila last seen > 3 menit (refresh acak mock) | Diganti (P1) | `last_seen` kini hanya dari request nyata: AC-4.8 "memperbarui last_seen…". Status `offline` dari `last_seen` = M5 (plan tabel M4/M5) |
| AC-2.3 listHosts mengembalikan salinan | Dipertahankan | `… > listHosts/getHost mengembalikan salinan` |
| Seam: `PXE_MOCK_SIMULATION=off` | Tidak relevan (P1) | Tidak ada simulasi lagi. Seam pengganti: `getDb / tx / resetDb (seam DEC-005)` |
| Seam: `PXE_MOCK_DISCOVER_EVERY_MS` | Tidak relevan (P1) | — (discovery lewat `/boot/{mac}.ipxe`) |
| Seam: seed empty; `PXE_MOCK_SEED` default; seed default berisi 1 key | Diganti (P1, P2) | `resetDb: … default = PXE_SEED`, `seed empty: tanpa host, key, maupun job`; seed demo kini 0 key (P2) — `G-SEC-2 / SR-2-1 > DB demo tidak berisi … key` |
| Seam: store lama tanpa field baru dibangun ulang | Diganti (P1) | Migrasi berversi: `AC-4.1 migrasi` (idempoten, reopen file, rollback migrasi gagal) |
| `mockOptionsFromEnv` | Diganti (P1) | Parsing env `PXE_SEED`/`PXE_DB_PATH` di `settings.test.ts` (AC-4.5) |
| AC-2.4 deleteHost menghapus host + config | Dipertahankan + diperkuat | `AC-2.4 (M4) deleteHost` (+ cascade join key & job, token ikut hilang) |
| AC-2.4 deleteHost id tak dikenal → false | Dipertahankan | sama |
| AC-2.4 rebootToPxe ×3 (booting/discovered/null) | Diganti (P3) | `hosts-routes.test.ts` "DEC-012: POST reboot → 501 … status host TIDAK berubah"; E2E `m2-hosts-table.spec.ts` "Reboot ke PXE nonaktif…" |
| defaultConfig host terpasang: user `ubuntu`, hash `$6$`, key `key-admin-wals` | Diganti (P2, P4) — assertion keamanan lebih ketat | `defaultConfig … > host terpasang: … TANPA user/hash/key` (username/passwordHash `null`, `sshKeyIds=[]`), OS kanonik |
| defaultConfig host discovered | Dipertahankan | sama |
| defaultConfig mengikuti env `PXE_MGMT_*` | Dipertahankan | sama |
| G-SEC-2 hash seed bukan hash lab / tidak cocok password umum | Diganti (P2) — lebih ketat | Seed tidak berisi hash sama sekali: `DB demo tidak berisi hash password…` (dump semua tabel tanpa `$6$`) |
| G-SEC-2 source tanpa hash lab / plaintext | Dipertahankan + diperluas | `source seed tidak memuat hash…`; `tidak ada hash lab $6$pxelab$ di kode produk src/ maupun configs/autoinstall (I-3-14)` |

Test baru di file yang sama: AC-4.1 (tabel, indeks, FK, constraint MAC/IP statis/hostname
case-insensitive/job aktif, CHECK, cascade), `tx` (rollback, bertingkat, fn async ditolak),
`isUniqueViolation`, repo jobs/ssh-keys/os-images, CR-3-4 (`peekConfig` tidak menulis), AC-4.4
statis (tanpa impor `mock-hosts`, tanpa route `__test__`).

## 2. Migrasi di commit WIP `4004806` (diverifikasi ulang sesi ini)

| File | Perubahan | Alasan |
|---|---|---|
| `src/app/api/config-routes.test.ts` | Store → `withDb("demo")`; credentials/key seed disiapkan lewat API (`ready()`, key "Admin workstation" dari fixture); id OS kanonik; test baru AC-4.25 (tanpa credentials ditolak, media tidak tersedia, Windows "hanya generator", bulk job+host booting, tanpa token di response) | P1, P2, P4, P6 |
| `src/app/api/hosts/hosts-routes.test.ts` | Reboot → 501 tanpa efek (`dbSnapshot` identik) | P3 |
| `src/app/api/iter2-routes.test.ts` | Snapshot DB semua tabel; reboot lolos guard = 501; test baru SR-3-5 (Host asing 403) | P1, P3, carry-over SR-3-5 |
| `src/lib/oui.test.ts` | OUI QEMU/KVM; label "Rocky Linux 9"; `canonicalOsImageId` | AC-4.8, P4 |
| `src/lib/server/config-service.test.ts` | DB; yang kalah PATCH paralel tidak meninggalkan baris config | P1 (assertion ditambah) |
| `src/lib/server/http.test.ts` | Allowlist Host (SR-3-5) | carry-over |

Sesi ini: helper `useDb` diganti nama `withDb` (aturan lint `react-hooks/rules-of-hooks` salah
mengenali awalan `use`); `tmpDir` kini di dalam project (`dashboard/.test-tmp`, gitignored) dan
dibersihkan per test/file (batas keras: tidak menghapus file di luar project).

## 3. E2E (`dashboard/e2e/`)

| Spec / test | Perubahan | Alasan |
|---|---|---|
| `playwright.config.ts` | Tiap server `next start` memakai file DB SQLite sendiri yang di-seed sebelum start (`e2e/support/e2e-env.ts`, di `dashboard/.e2e-data`, dihapus `globalTeardown`); env `PXE_MOCK_*` dihapus; media palsu untuk server yang menginstal; 2 project baru (`m4-discovery`, `m4-settings`); **guard CR-1-9 kini rekursif (CR-1-10)** | P1, P6, carry-over CR-1-10 |
| `m1-layout.spec.ts` placeholder `/settings` | Diganti test "/settings: halaman Settings read-only (bukan placeholder)"; 3 placeholder lain tetap | P5 |
| `m1-layout.spec.ts` AC-1.11 | Teks aksesibel kini dibandingkan dengan state dari `/api/server-status` (online/offline/tidak diketahui), `data-state` + `data-online` + warna; tiga state deterministik di `m4-settings.spec.ts` | P5 (CR-1-7) |
| `m2-polling.spec.ts` AC-2.9 | Host baru dipicu `GET /boot/{mac}.ipxe` (bukan simulasi); batas ≤ 6 dtk & gap polling 4–6 dtk tetap; + cek tanpa duplikat | P1 (+ AC-4.12) |
| `m2-hosts-table.spec.ts` filter OS | "Rocky Linux 9.4"/`rocky-9.4` → "Rocky Linux 9"/`rocky-9` (jumlah host tetap 2) | P4 |
| `m2-hosts-table.spec.ts` menu 5 aksi | Teks item reboot memuat alasan + `aria-disabled=true`; 4 item lain tidak nonaktif | P3 |
| `m2-hosts-table.spec.ts` Reboot → AlertDialog → status berubah | Diganti: klik item nonaktif tidak membuka dialog/mengirim request; API 501; status tetap `done` setelah reload | P3 |
| `m3-sheet.spec.ts` | Prasyarat seed (key "Admin workstation" ssh-rsa, user `ubuntu`) disiapkan lewat API `beforeAll` dengan fixture key dummy baru `SSH_RSA_ADMIN`; id/label OS kanonik | P2, P4 |
| `m3-bulk.spec.ts` | Credentials+key untuk host yang di-install disiapkan lewat API; server diberi media palsu | P2, P6 |
| `iter2-ui.spec.ts` CR-3-13 / CR-3-2 | `page.route` dipindah dari `/api/network` ke `/api/settings` (bentuk respons superset); assertion form/preview/validasi/sidebar tidak berubah. Test "server lab: /api/network = env" tetap memakai `/api/network` | P5 |
| `iter3-ui.spec.ts` DR-1-2 "M2 reboot ke PXE → toast datar" | Diganti "M2 hapus host gagal → toast.error datar" (toast reboot tidak ada lagi) — sekaligus pengukuran shadow `toast.error` (carry-over I-3-8) | P3 |

## 4. Catatan

- Fixture baru `SSH_RSA_ADMIN` (`src/test/fixtures.ts`): public key RSA dummy dibuat `ssh-keygen`
  di `.agent/tmp`, private key langsung dihapus; fingerprint = keluaran `ssh-keygen -lf`.
- Kode produk tidak diubah oleh test-engineer.
