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
