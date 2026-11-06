# Migrasi test M7

## DEC-025 §1: Debian `netcfg/no_default_route=true` (backend-dev, T2b)

Alasan: DHCP di VLAN PXE sengaja tidak memberi router (DEC-024 §3). Tanpa jawaban ini, d-i netcfg
berhenti di "Continue without a default route?" sebelum `preseed.cfg` diambil. Buktinya ada di
`.agent/runs/m7/kvm/smoke/run2-debian/pxe-test-m7vlansmoke-node43-console-screen.txt`. Parameter ini
selalu dikirim. netcfg hanya membaca template `netcfg/no_default_route` bila DHCP tidak memberi
gateway, jadi topologi flat M6 (ada router) tidak terpengaruh. Asersi lama tidak dilemahkan: setiap
golden tetap berupa string lengkap yang persis, dan hanya ditambah satu token atau satu baris.

### 1. Golden cmdline Debian: `dashboard/src/lib/server/boot-script.test.ts` ("Debian: netboot + preseed/url")
- Sebelum: `kernel http://10.99.0.2/media/debian-netboot/linux initrd=initrd auto=true priority=critical url=${BASE.configUrl}preseed.cfg interface=auto netcfg/dhcp_timeout=60 console=ttyS0,115200n8 console=tty0 ---`
- Sesudah: `kernel http://10.99.0.2/media/debian-netboot/linux initrd=initrd auto=true priority=critical url=${BASE.configUrl}preseed.cfg interface=auto netcfg/dhcp_timeout=60 netcfg/no_default_route=true console=ttyS0,115200n8 console=tty0 ---`

### 2. Inline snapshot: `dashboard/src/app/boot/boot-routes.test.ts` ("Debian (preseed) dan Rocky (kickstart) sesuai §2.3 (snapshot)")
- Sebelum: `... interface=auto netcfg/dhcp_timeout=60 console=ttyS0,115200n8 console=tty0 ---`
- Sesudah: `... interface=auto netcfg/dhcp_timeout=60 netcfg/no_default_route=true console=ttyS0,115200n8 console=tty0 ---`

### 3. Golden preseed: `dashboard/src/test/golden/installers/debian-preseed.cfg` dan `debian-preseed-auto-disk.cfg`
- Ditambah satu baris setelah `d-i netcfg/choose_interface select auto`:
  `d-i netcfg/no_default_route boolean true`
- Alasannya: preseed dibuat konsisten dengan cmdline untuk kasus netcfg dijalankan ulang setelah preseed
  dimuat. Baris lain tidak berubah.

### Tidak diubah
- Fixture `KCMD.preseed` di `installers/installers.test.ts`. Fixture ini adalah input evaluasi URL
  callback, bukan asersi output `installerScript`.
- Fixture log sintetis `src/test/installer-logs/synthetic/di-syslog.log`.

Test baru: `dashboard/src/lib/server/m7-debian-no-route.test.ts` (4 test). Log mutasi ada di
`.agent/runs/m7/mutation-dev-T2b.txt`.

## DEC-026 §1: Debian `netcfg/get_nameservers=<DNS PXE>` (backend-dev, T2c)

Alasan: di DHCP tanpa router, script udhcpc d-i (`sh -e`) berhenti di `ip route add default via ""`
sebelum menulis `/etc/resolv.conf`, lalu netcfg menanyakan `netcfg/get_nameservers` (critical) sebelum
`preseed.cfg` diambil. Buktinya ada di `.agent/runs/m7/kvm/smoke/run3-debian-fix/`. Nilainya diambil dari
entri pertama `PXE_MGMT_DNS`. Di kedua topologi lab nilainya sama dengan `PXE_SERVER_IP` dan sama dengan
opsi dns-server dnsmasq. Asersi lama tidak dilemahkan: golden tetap berupa string lengkap yang persis,
hanya ditambah satu token.

### 1. Golden cmdline Debian: `dashboard/src/lib/server/boot-script.test.ts` ("Debian: netboot + preseed/url")
- Sebelum: `... interface=auto netcfg/dhcp_timeout=60 netcfg/no_default_route=true console=ttyS0,115200n8 console=tty0 ---`
- Sesudah: `... interface=auto netcfg/dhcp_timeout=60 netcfg/no_default_route=true netcfg/get_nameservers=10.99.0.2 console=ttyS0,115200n8 console=tty0 ---`

### 2. Inline snapshot: `dashboard/src/app/boot/boot-routes.test.ts` ("Debian (preseed) dan Rocky (kickstart) sesuai §2.3 (snapshot)")
- Perubahannya sama: token `netcfg/get_nameservers=10.99.0.2` ditambahkan setelah `netcfg/no_default_route=true`
  (env test `PXE_MGMT_DNS=10.99.0.2`).

### 3. Fixture input `InstallerScriptInput`: ditambah field wajib `pxeDns`
Hanya ada penambahan properti, tanpa perubahan asersi:
- `boot-script.test.ts`, `m7-debian-no-route.test.ts`, `installers/m5-te-hooks.test.ts`,
  `installers/m6-generator.test.ts`, `installers/m6-smoke-fixes.test.ts`: `pxeDns: "10.99.0.2"`.
- `m5-settings.test.ts`, `m5-te-unit.test.ts` (properti URL dari settings): `pxeDns: s.network.dns[0]`,
  sama seperti pemanggil produk di `discovery.ts`.

### Tidak diubah
- Golden preseed (`debian-preseed*.cfg`). Tidak ada baris `netcfg/get_nameservers` di preseed.
  Alasannya: nilai dari cmdline kernel sudah tersimpan di db debconf d-i selama sesi installer. Bila netcfg
  dijalankan ulang, jawabannya tetap tersedia. Menambahkannya ke preseed juga membutuhkan DNS jaringan PXE
  di `InstallContext`, padahal context itu adalah konfigurasi target per host.

Test baru:
- `dashboard/src/lib/server/m7-debian-nameservers.test.ts` (12 test)
- `dashboard/src/app/boot/m7-debian-nameservers-route.test.ts` (1 test integration; `PXE_MGMT_DNS` ≠ `PXE_SERVER_IP`)
- `infra/test/m7-infra.sh`: "M7 verify-listen-vlan.sh wajib DHCP dnsmasq udp %pxe10:67 (DEC-026 §3)"

Log mutasi ada di `.agent/runs/m7/mutation-dev-T2c.txt`.

## M7-T8: infrastruktur E2E untuk milestone aktif 7 (test-engineer)

Tidak ada asersi yang diubah, dihapus, atau dilonggarkan. Hitungan asersi per file lama terhadap
`m6-approved` ada di `.agent/runs/m7/assertion-counts.txt` (skrip `.agent/runs/m7/count-assertions.py`):
0 file turun, grep `skip|only|fixme|todo` = 0. Perubahan hanya pada lokasi bukti dan config server.

### 1. `dashboard/e2e/helpers.ts`: `EVIDENCE_MILESTONE` 6 → 7, tipe `SHOTS` ditambah `7`
- Alasannya: screenshot spec M6 sebelumnya selalu ditulis ke `.agent/runs/m6/screenshots/` (BUG-M6-L4).
  Run regresi M7 akan menimpa bukti M6 yang sudah di-approve.
- Sesudah: spec `m7-*` (`SHOTS(7, …)`) ditulis ke `.agent/runs/m7/screenshots/<nama>.png`, sedangkan
  regresi M1–M6 ditulis ke `.agent/runs/m7/screenshots/m<n>-<nama>.png`. Logika BUG-M6-L4 tetap sama.

### 2. `dashboard/e2e/support/axe.ts`: default path `writeAxeEvidence` `runs/m6/axe-results.json` → `runs/m7/axe-results.json`
- Hanya parameter default dan komentar yang berubah. `classifyContrastFinding`, `CONTRAST_EXCEPTIONS`,
  `AXE_TAGS`, dan `auditA11y` tidak berubah.

### 3. `dashboard/e2e/m6-ui-iter2.spec.ts:395`: path bukti afterAll
- Sebelum: `writeAxeEvidence(path.resolve(__dirname, "../../.agent/runs/m6/axe-results-iter2-ui.json"))`
- Sesudah: `writeAxeEvidence(path.resolve(__dirname, "../../.agent/runs/m7/m6-axe-results-iter2-ui.json"))`
- Hanya lokasi file bukti yang berubah. Asersi tidak disentuh (76 → 76).

### 4. `dashboard/playwright.config.ts`
- Server baru `m7-vlan` (:3118, `testMatch` `m7-vlan.spec.ts`): `LAB_ENV`, DB demo sendiri, media palsu,
  dan `PXE_VLAN_NETWORKS="20:10.99.20.0/24:10.99.20.1;30:10.99.30.0/26:10.99.30.1"`. VLAN 30 (/26)
  ditambahkan agar isi otomatis prefix bisa diamati, karena prefix VLAN 20 sama dengan prefix subnet PXE /24.
- `SHARED_MATCH` ditambah `/m7-novlan\.spec\.ts/`. Spec ini read-only di server bersama :3100 tanpa
  `PXE_VLAN_NETWORKS`. Pemeriksaan `assertEverySpecCollected` tetap berlaku.

## Gate final M7 iter1: flake AC-7.17 "M7 host tidak pernah menyasar 10.99.10.*/10.99.20.*" (test-engineer)

Tidak ada test yang diubah, dihapus, atau dilonggarkan. Akar masalahnya ada di kode infra, bukan di
test. Rinciannya ada di `.agent/runs/m7/final/flaky-ac717.txt`, beserta reproduksi alami dan
reproduksi deterministik di `final/flaky-ac717/`.

- Penyebab: `infra/deploy-dashboard.sh:121-125` mem-pipe `{ printf …; }` ke `ssh_server`. Dalam
  dry-run, `ssh_server` (`run`) hanya mencetak baris dan tidak membaca stdin. Karena itu printf bisa
  terkena SIGPIPE. Dengan `pipefail`, script keluar 141, dan kvm-run.sh mencatat
  `FAIL exit=141 stage=deploy`. Test AC-7.17 menjalankan kvm-run dry-run 4×, sehingga paling sering
  terkena. Semua test lain yang memanggil deploy dry-run juga rentan.
- Status: dilaporkan ke Orchestrator untuk diperbaiki backend-dev. Instruksinya: bila penyebab ada di
  produk/infra, test-engineer tidak memperbaiki. Test AC-7.17 tetap seperti apa adanya.

## Gate final M7 iter1: flake E2E `m6-ui-iter2.spec.ts` "Log viewer: 'Sesi berakhir…' (SSE end session) tidak muted" (test-engineer)

Gejala: full E2E pra-perbaikan (`final/e2e-prefix-run0.log`) menghasilkan 202 lulus dan 1 gagal
dengan `page.evaluate: Execution context was destroyed, most likely because of a navigation` di
baris 125.

Akar masalah ada di kode test. Test ini membaca `sessionStorage` dua kali. Bacaan pertama ada di dalam
`expect.poll(...)` (ber-`.catch`). Bacaan kedua adalah `page.evaluate` terpisah sesudah poll.
Alur produk "sesi berakhir" memang mengalihkan halaman ke `/login` sesaat setelah pesan tampil. Bila
bacaan kedua jatuh tepat saat navigasi itu, konteks eksekusi hancur.

Reproduksi dengan `--repeat-each=40` (`final/flaky-e2e-session/`):
- Sebelum perbaikan: 10/40 gagal "Execution context was destroyed".
- Sesudah perbaikan: 0/40 gagal dengan error itu.
- Di kedua run ada 2/40 dan 1/40 timeout poll karena rate limit API (`Terlalu banyak request`, 429).
  Ini artefak dari 40 pengulangan beruntun di satu server. Dalam suite normal test ini hanya jalan
  sekali.

Perbaikan (`dashboard/e2e/m6-ui-iter2.spec.ts`): nilai disimpan sekali dari dalam poll
(`stored = await page.evaluate(...)`), lalu dipakai ulang untuk `JSON.parse`. `page.evaluate` kedua
dihapus.
- Sebelum: `const got = JSON.parse((await page.evaluate(() => sessionStorage.getItem("iter2-session-msg")))!)`
- Sesudah: `let stored: string | null = null; await expect.poll(async () => (stored = await page.evaluate(…).catch(() => null)), { timeout: 15_000 }).not.toBeNull(); const got = JSON.parse(stored!)`

Asersi tidak berubah:
- poll `.not.toBeNull()` dengan timeout 15 dtk.
- `got.text` = "Sesi berakhir. Masuk lagi untuk melihat log."
- `got.color` ≠ MUTED.
- `got.color` = BODY.

Nilai yang diperiksa tetap sama, yaitu entri `sessionStorage` yang direkam MutationObserver. Hitungan
asersi file tetap 76 → 76 (`final/skip-weakening.txt`).

## Iterasi 2 (DEC-028 §2): CR-7-4 label region scroll `plan-table-a11y.test.tsx` (frontend-dev 2906f53, dicatat test-engineer)

Alasan: CR-7-4 (minor) meminta region scroll (`role=region`) dan `<table>` di `PlanTable` memakai label
berbeda, agar pembaca layar tidak mengumumkan nama yang sama dua kali. Produk diubah:
`scrollRegionLabel` `Preview ${valueLabel}` → `Area gulir preview ${valueLabel}` (`plan-table.tsx`) dan
`Password yang dibuat` → `Area gulir password yang dibuat` (`passwords-dialog.tsx`). Label tabel
(`aria-label`) tidak berubah. Asersi yang memakai nama region lama harus mengikuti nama baru.

### 1. `dashboard/src/components/host-config/plan-table-a11y.test.tsx` ("PlanTable: region scroll bisa difokus (F-T8-1)")
- Sebelum: `screen.getByRole("region", { name: "Preview IP baru" })`
- Sesudah: `screen.getByRole("region", { name: "Area gulir preview IP baru" })`

Asersi lama yang tetap (tidak dilemahkan): `tabindex="0"`, `data-slot="table-container"`, kotak scroll
(tinggi maks + overflow) = elemen region yang sama, parent tanpa overflow, tabel `Preview IP baru` di
dalam region, sel `10.99.20.41` ber-`type-data`, dan region bisa difokus.

Diperkuat (asersi baru):
- `expect(region.getAttribute("aria-label")).not.toBe(table.getAttribute("aria-label"))`: label region
  harus berbeda dari label tabel, ini inti CR-7-4.
- `expect(screen.queryByRole("region", { name: "Preview IP baru" })).toBeNull()`: tidak ada region yang
  masih memakai label tabel.
- Test baru "PasswordsDialog: label region scroll beda dari label tabel (CR-7-4)": region
  `Area gulir password yang dibuat` (`tabindex=0`) membungkus tabel `Password yang dibuat` yang memuat MAC
  baris, dan tidak ada region bernama `Password yang dibuat`.

Pemakai lain nama region lama: dicek dengan `grep -rn 'region.*Preview \|name: "Password yang dibuat"'`
di `dashboard/e2e`, `dashboard/e2e-kvm`, dan `dashboard/src`. Semua E2E memilih tabel lewat
`getByRole("table", …)` atau teks, jadi tidak ada selector E2E yang berubah (bukti: E2E penuh 2×,
`final-iter2/e2e-run{1,2}.log`).

## Iterasi 2 (DEC-028 §2): CR-7-2/SR-7-5 scanner URL kredensial (test-engineer, commit 5220865)

Alasan: pengecualian placeholder dulu hanya memeriksa AWAL nilai (`<REDACTED`, `***`, `…`, backtick),
sehingga nilai nyata yang diawali karakter itu lolos, dan bentuk ter-encode tidak dipindai. Sekarang
`URL_CRED` (`dashboard/e2e-kvm/m7-shared.ts`) dan `_url_cred_hits` (`infra/redact-evidence.sh`) hanya
mengecualikan token placeholder UTUH: kosong, `***`, `…`, `<REDACTED…>` (juga versi ter-encode),
diikuti `&`, spasi, `"`, backslash-quote JSON, `%26`, atau akhir teks. Selain itu dipindai juga
`%3F`/`%26`/`%3D` (tanpa beda huruf) dan escape JSON backslash-u0026/u003f/u003d.

Scanner jadi lebih ketat. Dua input dokumentasi yang dulu "tidak ditandai" kini ditandai, karena
placeholder yang diikuti backtick bukan token utuh lagi. Asersi tidak dilonggarkan: kasus ini hanya
pindah ke daftar "menandai".

### 1. `dashboard/src/lib/server/m7-kvm-urlcred.test.ts`
- Dipindah dari `tidak menandai` ke `menandai` (describe baru "hanya token placeholder utuh yang dikecualikan",
  baris 44-45 file test; isi literal tidak dikutip di sini agar dokumen ini tidak ikut menjadi hit scanner):
  - komentar kode "bukan GET /login dengan username/password bernilai elipsis" yang elipsis password-nya
    diikuti backtick penutup kode;
  - teks "pola (parameter password kosong lalu backtick, parameter username kosong lalu backtick) bernilai".
- Tetap di `tidak menandai`: semua kasus lain dari DEC-027 (nilai `<REDACTED…>`, `/login?***`, nilai kosong,
  `$6$REDACTED`, `?platform=efi`).
- Ditambah: 7 kasus "menandai" baru (placeholder sebagai awalan, backtick, elipsis+teks) dan 5 kasus "tidak
  menandai" (token utuh). Juga 11 + 7 kasus ter-encode (percent dan JSON). Total 42 test (sebelumnya 12).

### 2. `infra/test/m7-te.sh` `test_m7te_redact_url_credentials` (DEC-027 §4)
- Sebelum (`ok.txt`, baris 4): komentar "bukan GET /login dengan username/password bernilai elipsis (komentar
  kode)", lalu "; pola" + parameter password kosong yang diikuti backtick.
- Sesudah (`ok.txt`, baris 4): hanya komentar elipsis (token utuh, diikuti spasi). Bagian "pola" (nilai =
  backtick) kini temuan dan diuji sebagai kasus `bad6` di test baru.
- Asersi lain tidak berubah: exit 1, `server-nginx(-error).txt:1`, `ok.txt` tidak dilaporkan, nilai tidak
  bocor, file tidak diubah, `username=` saja tetap temuan, dan direktori bersih → exit 0.
- Test baru `test_m7te_redact_url_credentials_strict_encoded` berisi 18 kasus bad dan 12 kasus good, sama
  dengan kasus vitest.
- Mutasi (`final-iter2/mutation-te-iter2-urlcred.txt`): revert ke HEAD, exclusion awalan, atau tanpa
  decode membuat run.sh merah. Revert TS, lookahead tanpa terminator, atau tanpa bentuk ter-encode membuat
  vitest merah (21/14/11 gagal).

### 3. `infra/test/m7-te.sh`: komentar/judul saja (SR-7-2, tanpa ubah asersi)
- Baris 7 dan komentar di `test_m7te_nginx_vlan_acl`: "rpcbind/nfsd hanya 10.99.10.2" → "nfsd hanya 10.99.10.2;
  OPTIONS rpcbind `-h` ditulis, tapi rpcbind wildcard (socket activation)".
- Judul `t`: `…; rpcbind 10.99.10.2 (AC-7.16)` → `…; nfsd 10.99.10.2 + OPTIONS rpcbind (AC-7.16)`.
- Asersi tetap: `OPTIONS="-w -h 10.99.10.2"` ditulis, `nfs-vlan.conf` tanpa host 10.99.0./10.99.20./0.0.0.0.
