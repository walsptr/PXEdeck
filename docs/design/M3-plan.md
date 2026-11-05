# M3 — Sheet konfigurasi & bulk (plan)

- Milestone: 3 (baseline, DEC-002) · Branch: `milestone/1-3-baseline`
- Sumber: SPEC §3.2 (Sheet: OS, Credentials, Network, Hostname, SSH Keys, footer), §3.1 bulk
  action bar, §5 API (`PATCH /api/hosts/:id`, `POST /api/hosts/bulk`,
  `POST /api/hosts/:id/install`, `POST /api/hosts/bulk/install`,
  `POST /api/credentials/import`, `GET /api/ssh-keys`), §6 (hash password, validasi server),
  §7 ("bulk … dengan preview sebelum disimpan")
- Prasyarat: M1-T1, M2-T1 (seam store). Tooling: `docs/design/M1-3-options.md`

## 1. Scope

- Sheet kanan (1 host atau bulk) dengan tab OS, Credentials, Network, Hostname, SSH Keys; footer
  "Simpan konfigurasi" (secondary/outline) + "Simpan & Install" (primary) dengan AlertDialog.
- Lib bersama browser+server: `net.ts`, `hostname.ts`, `credentials.ts`, `ssh-key.ts`,
  `host-config.ts` (skema zod), `components/host-config/form-state.ts` (state form, preview,
  `buildPayload`).
- Server: `lib/server/config-service.ts` (validasi semantik + penerapan atomik, install),
  `lib/server/http.ts` (`readJson` 400 / `validationFailed` 422).
- Route: `hosts/[id]` (GET/PATCH/DELETE), `hosts/[id]/config` (GET), `hosts/[id]/install`,
  `hosts/bulk`, `hosts/bulk/install`, `credentials/import`, `ssh-keys` (GET).
- Install di M3 = mock (status → booting lalu simulasi). File installer nyata = M4.

## 2. Task

| ID | Owner | Deskripsi | Dependensi | File |
|---|---|---|---|---|
| M3-T1 | backend-dev | Verifikasi + lengkapi gap validasi server (G3-1, G3-2, G3-3, G3-4). | M2-T1 | `lib/net.ts`, `lib/server/config-service.ts`, `lib/host-config.ts` |
| M3-T2 | frontend-dev | Verifikasi + lengkapi gap UI Sheet (G3-5, G3-6); pastikan preview & error server per tab tetap sinkron dengan perubahan M3-T1. | M3-T1 | `components/host-config/*`, `hooks/use-host-config.ts` |
| M3-T3 | test-engineer | Unit: `net`, `hostname`, `credentials`, `ssh-key`, `form-state`, `config-service` (langsung, store di-reset). | M3-T1 | `*.test.ts` |
| M3-T4 | test-engineer | Integration route handler untuk semua route M3. | M3-T1 | `src/app/api/**/*.test.ts` |
| M3-T5 | test-engineer | E2E Playwright alur Sheet single + bulk + install. Bukti ke `.agent/runs/m3/`. | M3-T2 | `dashboard/e2e/m3-*.spec.ts` |

## 3. Acceptance criteria

### Lib (unit Vitest)

- **AC-3.1** `net`: `isIpv4` menolak `256.1.1.1`, `01.2.3.4`, `1.2.3`; `validateStaticIp` menolak
  (dengan pesan berbeda) IP di luar subnet, alamat network/broadcast, gateway/PXE server, IP
  di range DHCP dinamis, dan IP yang dipakai host lain (pesan menyebut pemakai);
  `planIps` mode range dan increment menghasilkan pemetaan berurutan, `skipUsed=true`
  melewati IP terpakai, `skipUsed=false` menandai error per host, range habis →
  "Range IP tidak cukup"; `validateIpAssignments` mendeteksi duplikat dalam batch.
- **AC-3.2** `hostname`: `validateHostname` menerima `node-01`, menolak string kosong, > 63
  karakter, huruf besar, `-a`, `a-`, `a_b`; `renderHostnames` me-render `node-{index:02}` →
  `node-01, node-02…` (startIndex dihormati), `web-{mac_suffix}` → 4 hex terakhir MAC,
  `{prefix}-{ip_last_octet}`; host tanpa IP pada `{ip_last_octet}` dan token asing → error per
  baris; duplikat dalam batch dan nama yang dipakai host lain → error per baris.
- **AC-3.3** `credentials`: `validateUsername` menolak kosong, huruf besar, diawali angka,
  > 32 karakter, `root`; `validatePassword` menolak < 8, > 128, mengandung newline;
  `generatePassword(n)` panjang n, hanya dari alfabet tanpa karakter ambigu (`0OlI1`, kutip),
  100 panggilan menghasilkan 100 nilai unik; `parseCsv`/`toCsv` round-trip untuk field
  berkoma, berkutip, dan CRLF; `normalizeMac` menerima `AA-BB-CC-DD-EE-FF`, `aabb.ccdd.eeff`,
  `aabbccddeeff` → bentuk `aa:bb:…`, menolak panjang salah/karakter non-hex.
- **AC-3.4** `ssh-key`: `parseSshKey` menerima key ssh-ed25519, ssh-rsa, ecdsa-sha2-nistp256
  (fixture key publik dummy yang dibuat untuk test), menolak private key, tipe lain
  (`ssh-dss`), base64 rusak, dan blob yang tipe dalamnya tidak cocok dengan prefix;
  `sshFingerprint` sama persis dengan keluaran `ssh-keygen -lf` untuk fixture yang sama
  (nilai diharapkan di-hardcode di fixture).

### Server & API (integration route handler, store di-reset per test)

- **AC-3.5** Validasi struktural: body bukan JSON → 400 `{error}`; payload yang melanggar skema
  zod (mis. `prefix: 40`, `hostIds: []`, mode credentials asing) → 400 dengan `errors[]`
  yang `section`-nya menunjuk bagian yang salah. Validasi semantik gagal → 422 dengan
  `errors[]` per bagian/host. Payload tanpa bagian apa pun → 422.
- **AC-3.6** Atomik: `POST /api/hosts/bulk` dengan network valid + hostname yang bentrok untuk
  satu host → 422 dan **tidak ada** perubahan pada host mana pun (GET config/host sebelum =
  sesudah); payload valid → 200 `{updated: N}` dan semua host berubah.
- **AC-3.7** Network: IP statis yang bentrok dengan IP management atau lease aktif host lain
  ditolak 422 (pesan menyebut pemakai) — UI dan API sama-sama menolak (lihat AC-3.13);
  duplikat dalam batch ditolak; gateway/DNS bukan IPv4 ditolak; mode DHCP menghapus
  `mgmtIp`; host yang ada di batch tidak dihitung bentrok dengan dirinya sendiri.
- **AC-3.8** Credentials & keamanan password: mode `same` menyimpan `passwordHash` berformat
  SHA-512 crypt (`^\$6\$[^$]{1,16}\$[./0-9A-Za-z]{86}$`) yang terverifikasi dengan
  `unixcrypt.verify`, salt berbeda antar host untuk password sama; password kosong ditolak
  bila ada host tanpa password; mode `random` mengembalikan `generatedPasswords` (satu per
  host, unik, panjang sesuai) **hanya** di respons simpan itu; `GET /api/hosts/:id/config`
  tidak pernah memuat `passwordHash` maupun password (hanya `hasPassword`), dan tidak ada
  respons API lain yang memuat plaintext password.
- **AC-3.9** CSV import: `POST /api/credentials/import` mengembalikan hasil per baris (nomor baris
  memperhitungkan header `mac,…`) dengan error untuk MAC invalid, MAC bukan host terpilih,
  MAC duplikat, jumlah kolom ≠ 3, username/password invalid; respons tidak memuat password;
  `POST /api/hosts/bulk` mode `csv` dengan ≥ 1 baris invalid → 422 tanpa efek pada host mana
  pun (termasuk host di baris yang valid).
- **AC-3.10** Hostname & SSH: hostname invalid/duplikat/dipakai host lain → 422 per host;
  `ssh.keyIds` yang tidak ada di library → 422; key baru invalid → 422 dengan nomor key; key
  baru `saveToLibrary` tanpa nama → 422; key baru valid + `saveToLibrary` → muncul di
  `GET /api/ssh-keys` dengan fingerprint `SHA256:` yang benar; tanpa key sama sekali → 422.
- **AC-3.11** Install: `POST /api/hosts/:id/install` dan `/api/hosts/bulk/install` →
  host dengan OS + credentials berpindah ke `booting` dan masuk `started`; host tanpa OS atau
  tanpa credentials, host sedang provisioning, dan id tak dikenal masuk `failed` dengan pesan;
  status HTTP 200 bila ≥ 1 started, 422 bila tidak ada.

### UI (e2e Playwright, simulasi mock dimatikan)

- **AC-3.12** Sheet single host: "Edit konfigurasi" membuka Sheet kanan dengan lima tab (OS,
  Credentials, Network, Hostname, SSH Keys); tab OS menampilkan katalog image, disk target,
  skema partisi (auto/LVM/custom; custom memunculkan isian storage), timezone, locale, dan
  ringkasan "Yang akan terjadi saat install"; Credentials punya tombol tampil/sembunyi
  password (mengubah `type` input) dan generator; menyimpan perubahan memanggil
  `PATCH /api/hosts/:id`, menampilkan toast, dan tabel ter-update (hostname/IP baru). Tab SSH
  Keys menampilkan key library dengan fingerprint; paste key valid menampilkan tipe +
  fingerprint `SHA256:`; paste private key/teks acak menampilkan error; upload file `.pub`
  (`setInputFiles`) mengisi key; user target default = username Credentials.
- **AC-3.13** Validasi di UI: hostname invalid, IP statis yang bentrok dengan host lain, dan
  username invalid menampilkan pesan error di tab terkait dan menonaktifkan tombol simpan;
  error 422 dari server ditampilkan di tab yang benar dengan judul "Ditolak server".
- **AC-3.14** Bulk preview & password sekali tampil: memilih 3 host → "Set IP" membuka tab
  Network dengan preview tabel MAC → IP (range dan IP awal + increment); "Set Hostname"
  dengan template `node-{index:02}` menampilkan preview MAC → hostname dan menandai
  duplikat; "Set Credentials" mode CSV menampilkan preview per baris dengan error per baris;
  tidak ada request simpan terkirim sebelum tombol simpan ditekan. Mode password acak →
  simpan → dialog password tampil dengan unduhan CSV `mac,hostname,username,password`
  (event `download` Playwright); setelah dialog ditutup, membuka ulang Sheet tidak
  menampilkan password lagi.
- **AC-3.15** Simpan & Install: tombol "Simpan & Install" (primary) membuka AlertDialog yang
  menyebut jumlah host/hostname dan peringatan disk dihapus; Batal tidak mengirim request;
  "Hapus disk & install" menyimpan lalu memanggil endpoint install, dan status host di tabel
  menjadi Booting.

Total: 15 AC.

## 4. Gap kode vs SPEC (M3)

| ID | Gap | Tindakan | Owner |
|---|---|---|---|
| G3-1 | Validasi IP statis selalu memakai `MGMT_NETWORK.cidr` (/24) dan mengabaikan `prefix` dari payload; gateway tidak dicek berada di subnet IP host. SPEC §3.2: "validasi … subnet". | Validasi subnet berdasarkan `ip/prefix` payload (atau tolak prefix ≠ subnet management sampai Settings ada di M4 — **kandidat decision**, opsi aman: tolak); gateway harus di subnet yang sama. | backend-dev |
| G3-2 | Race: `applyConfig` `await sshFingerprint` di antara validasi dan penerapan; dua request paralel bisa sama-sama lolos cek IP/hostname bentrok. | Hitung fingerprint sebelum validasi bentrok, atau terapkan validasi+apply tanpa `await` di tengah (bagian sinkron). Constraint unik di DB menyusul di M4. | backend-dev |
| G3-3 | Library SSH key tidak mendeteksi duplikat (fingerprint sama disimpan dua kali). | Tolak/abaikan key baru dengan fingerprint yang sudah ada di library (422 atau pakai id yang ada — pilih satu, dokumentasikan). | backend-dev |
| G3-4 | Ukuran input belum dibatasi penuh: `assignments` (record) dan elemen `hostIds` tanpa batas panjang. SPEC §6 "validasi semua input di server". | Batasi jumlah key `assignments` ≤ 500 dan panjang string (id ≤ 64, IP ≤ 15, hostname ≤ 63). | backend-dev |
| G3-5 | Tidak ada atribut stabil untuk test di beberapa elemen Sheet (preview tabel, dialog password). | Tambah `aria-label`/role yang bermakna (lebih disukai) atau `data-testid` seperlunya. | frontend-dev |
| G3-6 | Aturan username Linux juga dipakai untuk image Windows (`unattend`). | Diterima untuk M3; generator `unattend.xml` dan aturannya **di luar scope, milestone 4**. | — |
| G3-7 | Generator file installer (autoinstall/kickstart/preseed/unattend), `GET /boot/{mac}.ipxe`, tabel `host_configs` di DB. | **Di luar scope, milestone 4.** | — |
| G3-8 | CRUD `/api/ssh-keys` (POST/DELETE) dan CRUD `/api/os-images`; katalog OS masih statis. | **Di luar scope, milestone 4** (halaman pendukung). | — |
| G3-9 | Status install nyata via callback, job & log. | **Di luar scope, milestone 5.** | — |
| G3-10 | Auth semua API, token sekali pakai per-MAC. | **Di luar scope, milestone 6.** | — |

## 5. Risiko

- **Password di memori/log**: password plaintext ada di body request dan respons mode
  `random`. Pastikan tidak ada `console.log` payload; test-engineer menambahkan asersi bahwa
  log server E2E (`.agent/runs/m3/`) tidak memuat password fixture. Bukti tidak boleh berisi
  password sungguhan — pakai nilai dummy.
- **Fixture SSH key**: jangan membaca `~/.ssh`. Buat key dummy dengan `ssh-keygen` ke direktori
  sementara saat penyusunan fixture, simpan **hanya public key** + fingerprint yang diharapkan
  di repo test.
- **Kompleksitas Sheet** (form-state ~400 baris): E2E saja tidak cukup untuk coverage; uji
  `form-state.ts` (`ipPlan`, `hostnamePlan`, `sectionErrors`, `buildPayload`) sebagai unit.
- **Radix + Playwright**: Select/Dropdown Radix memakai portal dan pointer events; gunakan
  locator berbasis role dan hindari `force: true`.
- **Simulasi mock**: tanpa seam M2-T1, status bisa maju sendiri selama E2E dan membuat AC-3.15
  flaky.
