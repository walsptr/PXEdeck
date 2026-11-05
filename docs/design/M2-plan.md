# M2 — Tabel host (data mock) (plan)

- Milestone: 2 (baseline, DEC-002) · Branch: `milestone/1-3-baseline`
- Sumber: SPEC §3.1 (tabel host), §5 API `GET/DELETE /api/hosts[/:id]`, model `hosts`
- Prasyarat: M1-T1 (tooling test). Tooling: `docs/design/M1-3-options.md`

## 1. Scope

Halaman `/hosts` dengan TanStack Table v9 di atas API mock in-memory:

- Kolom: checkbox, MAC (mono + tombol copy), hostname (mono, "—"), IP lease + IP management,
  vendor (OUI), OS terpasang/ditugaskan, status (pill), last seen (relatif), menu aksi (Install
  OS, Edit konfigurasi, Lihat log, Reboot ke PXE, Hapus).
- Polling 5 detik, pencarian MAC/hostname/IP, filter status (multi) & OS, sorting, row
  selection (termasuk Shift-range), bulk action bar, empty state, error state.
- API: `GET /api/hosts`, `GET /api/hosts/:id`, `DELETE /api/hosts/:id`,
  `POST /api/hosts/:id/reboot`.
- Store mock `src/lib/server/mock-hosts.ts`: seed 14 host, simulasi tahap
  booting→installing→configuring→done, discovery berkala (maks 4 host).
- Lib: `types.ts`, `oui.ts`, `format.ts`, `os-images.ts`; hook `use-hosts.ts`.

Tidak termasuk: isi Sheet konfigurasi (M3), discovery nyata / DB / iPXE (M4), log & jobs (M5),
auth (M6).

## 2. Task

| ID | Owner | Deskripsi | Dependensi | File |
|---|---|---|---|---|
| M2-T1 | backend-dev | Tambah test seam store mock (G2-1, options O4): `resetMockStore()` dan env untuk mematikan simulasi waktu / mengatur interval discovery. Tanpa endpoint test baru. | M1-T1 | `src/lib/server/mock-hosts.ts` |
| M2-T2 | backend-dev | Verifikasi + lengkapi gap API (G2-2, G2-3): validasi `id`, kode status konsisten. | M2-T1 | `src/app/api/hosts/**` |
| M2-T3 | frontend-dev | Verifikasi + lengkapi gap UI (G2-4, G2-5). | M1-T2 | `src/components/hosts/*` |
| M2-T4 | test-engineer | Unit: `oui`, `format`, `os-images`, filter/sort `columns.tsx`, `mock-hosts` (fake timers). | M2-T1 | `*.test.ts` |
| M2-T5 | test-engineer | Integration route handler (Vitest, node env): `/api/hosts`, `/api/hosts/[id]`, `/reboot`. | M2-T1 | `src/app/api/**/*.test.ts` |
| M2-T6 | test-engineer | E2E Playwright `/hosts` (simulasi dimatikan via env). Bukti ke `.agent/runs/m2/`. | M2-T1, M2-T3 | `dashboard/e2e/m2-*.spec.ts` |

## 3. Acceptance criteria

- **AC-2.1** (unit Vitest) `lookupVendor`: prefix OUI dikenal → vendor (mis. `52:54:00:…` →
  "QEMU/KVM", huruf besar diterima), tidak dikenal → `null`. `osLabel`: id katalog → "Nama
  Versi", id asing → id itu sendiri, `null`/`undefined` → `null`.
- **AC-2.2** (unit Vitest) `formatRelative` (clock dikunci): selisih < 45 dtk → "baru saja";
  2 menit → "2 menit yang lalu"; 3 jam → "3 jam yang lalu"; 2 hari → "2 hari yang lalu"
  (bandingkan dengan keluaran `Intl.RelativeTimeFormat("id")` di runtime test agar tidak
  rapuh terhadap versi ICU). `ipToNumber`: urutan numerik benar
  (`10.0.0.9 < 10.0.0.10`), `null` → -1.
- **AC-2.3** (unit Vitest, fake timers) Store mock: setelah reset, `listHosts()` mengembalikan
  14 host seed dengan `id` = MAC tanpa titik dua dan `vendor` = hasil OUI; host `booting` maju
  ke `installing` setelah 20 dtk, ke `configuring` setelah +60 dtk, ke `done` setelah +20 dtk
  dan saat itu `osInstalled` = `osAssigned` lama, `osAssigned` = `null`; discovery menambah
  host `discovered` tiap 40 dtk sampai maks 4; `listHosts()` mengembalikan salinan (mutasi
  hasil tidak mengubah store).
- **AC-2.4** (unit Vitest) `deleteHost` menghapus host + konfigurasinya dan mengembalikan
  `false` untuk id tak dikenal; `rebootToPxe` → status `booting` bila ada `osAssigned`, selain
  itu `discovered`; `statusSince`/`lastSeen` diperbarui; id tak dikenal → `null`.
- **AC-2.5** (integration route handler) `GET /api/hosts` → 200, header
  `Cache-Control: no-store`, body `{hosts: Host[], serverTime: ISO}` dengan setiap host lolos
  skema `Host` (zod di test). `GET /api/hosts/:id` → 200 host / 404 `{error}`.
- **AC-2.6** (integration route handler) `DELETE /api/hosts/:id` → 204 tanpa body lalu
  `GET` → 404; `DELETE` id tak dikenal → 404. `POST /api/hosts/:id/reboot` → 200 host dengan
  status baru; id tak dikenal → 404.
- **AC-2.7** (unit Vitest) Filter tabel (`hostGlobalFilter`, filter status/OS dari
  `columns.tsx`, diuji lewat instance table headless atau fungsi terekspor): query MAC
  dengan format `52-54-00`, `525400`, `52:54:00` setara; cocok pada hostname, IP lease, IP
  management; filter status multi-nilai; filter OS cocok dengan terpasang **atau** ditugaskan;
  `"none"` = tanpa OS; sort status mengikuti urutan `PROVISION_STATUSES`; sort IP numerik.
- **AC-2.8** (e2e) Tabel `/hosts` menampilkan header kolom MAC Address, Hostname, IP, Vendor, OS,
  Status, Last seen + kolom checkbox & aksi; satu baris per host dari API; hostname kosong
  tampil "—"; MAC dan hostname memakai font mono; status tampil sebagai pill dengan
  `data-status` yang sama dengan API.
- **AC-2.9** (e2e) Update otomatis: host baru hasil discovery mock (server E2E dengan interval
  discovery diperpendek lewat env, lihat options O4) muncul di tabel dalam ≤ 6 dtk tanpa reload; request `GET /api/hosts`
  berulang dengan interval ~5 dtk (diamati via `page.on('request')`).
- **AC-2.10** (e2e) Pencarian & filter: mengetik bagian MAC/hostname/IP mempersempit baris; filter
  status lewat dropdown menampilkan hitungan per status dan hanya baris berstatus itu; filter
  OS bekerja; tombol Reset mengembalikan semua baris; kombinasi tanpa hasil menampilkan
  "Tidak ada host yang cocok dengan filter."; `/hosts?q=<mac>` mengisi pencarian awal.
- **AC-2.11** (e2e) Seleksi & bulk bar: memilih 2 baris memunculkan toolbar
  "Aksi untuk host terpilih" dengan teks "2 host dipilih" dan tombol Set Credentials, Set
  Hostname, Set IP, Inject SSH Key, Install OS (hanya Install OS bergaya primary); Shift+klik
  memilih rentang; checkbox header memilih semua/indeterminate; host terpilih yang tersaring
  ditampilkan sebagai "(N tersembunyi oleh filter)"; tombol batal mengosongkan seleksi.
- **AC-2.12** (e2e) Menu aksi baris berisi tepat Install OS, Edit konfigurasi, Lihat log, Reboot
  ke PXE, Hapus. Hapus → AlertDialog → konfirmasi → baris hilang + toast; Batal tidak mengubah
  apa pun. Reboot ke PXE → AlertDialog → status baris berubah (booting/discovered). Lihat log →
  navigasi ke `/jobs?host=<id>`. Install OS/Edit membuka Sheet (isi Sheet diuji di M3).
- **AC-2.13** (e2e) Empty & error state: dengan respons `{hosts: []}` (Playwright `page.route`) tampil "Belum ada host"
  beserta penjelasan bahwa host muncul otomatis saat PXE boot; bila `GET /api/hosts` gagal
  (Playwright `page.route` → 500) tampil Alert "Gagal memuat data host".
- **AC-2.14** (e2e) Tombol copy MAC menulis MAC ke clipboard (izin clipboard Playwright) dan
  dapat dicapai dengan keyboard (fokus membuatnya terlihat).

Total: 14 AC.

## 4. Gap kode vs SPEC (M2)

| ID | Gap | Tindakan | Owner |
|---|---|---|---|
| G2-1 | Store mock tidak deterministik (`Date.now`, `Math.random`, discovery 40 dtk) dan tidak bisa di-reset → E2E rapuh. Untuk Vitest, store ada di `globalThis.__pxeMockStore` sehingga bisa dihapus manual, tetapi itu bergantung pada detail internal. | M2-T1: ekspor `resetMockStore()`; env mis. `PXE_MOCK_SIMULATION=off` mematikan tick waktu + discovery. **Kandidat decision** (options O4): rekomendasi tanpa endpoint test — cukup `resetMockStore()` + env (`PXE_MOCK_SIMULATION=off`, interval discovery via env); empty/error state lewat `page.route`. | backend-dev |
| G2-2 | `[id]` tidak divalidasi bentuknya (mis. 12 hex); id aneh hanya menghasilkan 404 — dapat diterima, tetapi SPEC §6 "validasi semua input di server". | Tambah validasi ringan (regex 12 hex → 400 bila tidak cocok) atau dokumentasikan 404 sebagai perilaku. Pilih salah satu, test mengikuti. | backend-dev |
| G2-3 | `GET /api/hosts` memakai `connection()` yang melempar error di luar request scope Next → integration test langsung pada handler perlu stub `next/server` (lihat options). | Tidak perlu ubah kode; test-engineer memakai stub. | test-engineer |
| G2-4 | Empty state menulis subnet `10.10.10.0/24` hard-coded; last seen memakai jam klien, bukan `serverTime` (clock skew). | Subnet: **di luar scope, milestone 4** (Settings). Clock skew: opsional — hitung offset dari `serverTime`; bila tidak dikerjakan, catat sebagai risiko minor. | frontend-dev |
| G2-5 | Kolom IP menggabungkan lease + management dalam satu kolom (SPEC menyebut keduanya; tidak mewajibkan dua kolom). | Diterima; AC-2.8 menguji keduanya tampil. | — |
| G2-6 | Discovery nyata (lease dnsmasq / endpoint iPXE `${mac}`), tabel `hosts` di DB. | **Di luar scope, milestone 4.** | — |
| G2-7 | "Lihat log" menuju placeholder `/jobs`; reboot ke PXE hanya mengubah status mock. | **Di luar scope, milestone 5** (jobs/log) dan **4** (aksi nyata). | — |
| G2-8 | API tanpa autentikasi. | **Di luar scope, milestone 6.** | — |
| G2-9 | Polling 5 dtk dipilih (bukan SSE/WebSocket) — sesuai SPEC ("polling 5 dtk atau SSE"). | Diterima. | — |

## 5. Risiko

- **TanStack Table v9** API berbeda dari v8 (`useTable`, `tableFeatures`, `FlexRender`);
  unit test filter harus memakai API v9 dari `node_modules`, bukan contoh v8.
- **Store global per proses**: Playwright paralel dengan satu server berbagi store → jalankan
  E2E M2 dengan `workers: 1` atau reset per test; Vitest per file sudah isolasi modul tetapi
  `globalThis` bisa bocor antar test dalam file → reset di `beforeEach`.
- **Timing polling** di E2E: gunakan `expect.poll`/auto-wait, bukan `sleep` tetap.
- **Clipboard** di headless Chromium butuh `permissions: ['clipboard-read','clipboard-write']`
  dan origin `localhost`.
