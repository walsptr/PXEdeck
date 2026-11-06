# M7 — Opsi teknis (PXE lewat VLAN)

Dokumen ini memuat pilihan teknis yang berarti untuk M7. Setiap bagian berisi 2–3 opsi, trade-off,
dan rekomendasi. Keputusan final ditulis Orchestrator sebagai `DEC-024` dan seterusnya.

Rujukan: DEC-023 (cakupan M7: trunk dengan VLAN PXE native + VLAN management ber-tag, switch = VM
`pxe-test-switch` dengan `vlan_filtering`, network `pxe-test-*` tanpa `<forward>`/`<dhcp>`, SSH ke
node lewat `pxe-test-server`, matriks UEFI/BIOS Ubuntu + UEFI Debian + UEFI Rocky, uji negatif
isolasi); SPEC §Network ("VLAN opsional", "Validasi format, subnet, konflik host lain/lease aktif"),
§Model data (`host_configs.vlan`); CLAUDE.md §Batas keras, §Pengujian KVM; DEC-006 (aturan subnet IP
statis), DEC-009 (NAT hanya untuk VM server), DEC-011 (DNS tidak terikat subnet), DEC-013 (binding
IP), DEC-015 (allowlist admin), DEC-020 (stage2 Rocky lewat NFS), DEC-021/022 (media Debian lokal ⇔
host `PXE_MEDIA_URL` = `PXE_SERVER_IP`).

Fakta kode/infra yang membentuk pilihan (`main` @ `c9db581`, detail di `M7-plan.md` §0):
- Dashboard hanya mengenal **satu** jaringan (`Settings.network`): subnet PXE = subnet IP statis.
  `validateStaticIp` menolak IP di luar `PXE_MGMT_CIDR` ("Di luar subnet …", `lib/net.ts:158`),
  `validateStaticNetwork` mewajibkan prefix dan gateway di subnet yang sama (`lib/net.ts:111-135`).
- Generator sudah menulis VLAN: Ubuntu `vlans.mgmt.<id>` dengan parent `dhcp4: false`
  (`installers/ubuntu.ts:59-66`); Debian `$IF.<id>` + parent `inet manual` (`installers/debian.ts:130-143`);
  Rocky satu baris `network … --vlanid=<id>` (`installers/rocky.ts:87`), perilaku parent di OS
  terpasang tidak diatur.
- **Subiquity menerapkan konfigurasi network autoinstall ke lingkungan installer**: di run KVM M6
  `core`, `user-data` node21 diambil dari IP lease `10.99.0.200`, tetapi callback late-commands
  datang dari IP statis `10.99.0.31` (`.agent/runs/m6/kvm/core/server-nginx.txt` baris 174 vs
  276–277 dan 1047–1048). Di topologi VLAN, installer Ubuntu akan pindah ke VLAN management di
  tengah instalasi (root live tetap NFS dari server).
- Callback status/log menerima IP lease ∪ `current_ip` ∪ IP statis ∪ `mgmt_ip`
  (`provisioning.ts:189,306`); fetch file konfigurasi hanya lease ∪ `current_ip` (`provisioning.ts:92`).
- Hook `guard_bash.py`: ssh/scp dan curl dari host hanya ke `10.99.0.*`. Host tidak punya route ke
  subnet VLAN, sehingga paket ke sana akan keluar lewat default route fisik.
- M6-T16 sudah menghapus `pxe-test`, `pxe-test-nat`, base disk server, dan key: M7 membangun ulang.

Ringkasan rekomendasi ada di akhir dokumen.

---

## O1. Penempatan trunk sisi server

| | A. Network trunk terpisah `pxe-test-trunk` (rekomendasi) | B. Trunk menumpang `pxe-test` (admin untagged + VLAN ber-tag di bridge yang sama) |
|---|---|---|
| Kesesuaian DEC-023 ("server di port trunk dengan sub-interface ber-tag") | Ya: NIC trunk server hanya membawa frame ber-tag, tanpa IP untagged | Sebagian: trunk punya native (admin) |
| Host `10.99.0.1` | Tidak pernah melihat frame VLAN PXE/management | Bridge host `virbr-pxe` menerima flood frame ber-tag (diabaikan, tetapi host ikut menjadi bagian domain L2 trunk) |
| Uji negatif "dnsmasq tidak menjawab di segmen admin" | Jelas: segmen admin dan trunk berbeda L2 | Bisa, tetapi segmen admin = native trunk, sehingga kasus "native salah" bercampur dengan "admin" |
| Biaya | +1 network libvirt, +1 NIC server | Tanpa network baru |

**Rekomendasi: A.** NIC server: `pxe0` (`pxe-test`, `10.99.0.2`, admin untagged, tetap dipakai
Playwright/ssh dari host), `nat0` (`pxe-test-nat`, apt, DEC-009), `trunk0` (`pxe-test-trunk`, tanpa
IP) dengan sub-interface `pxe10` (VLAN 10, `10.99.10.2/24`) dan `mgmt20` (VLAN 20, `10.99.20.1/24`).

---

## O2. Konfigurasi bridge di VM `pxe-test-switch`

DEC-023 sudah memutuskan switch = VM dengan Linux bridge `vlan_filtering`. Yang dipilih di sini
adalah cara mengonfigurasinya tanpa paket tambahan dan tanpa NAT (DEC-009: NAT hanya untuk server).

| | A. Script `pxe-switch.sh` (iproute2 `ip`/`bridge`) dipanggil unit systemd oneshot, profil port dari `/etc/pxe-switch.conf` (rekomendasi) | B. File systemd-networkd `.netdev` (`VLANFiltering=yes`) + `.network` (`[BridgeVLAN]`) lewat cloud-init `write_files` | C. netplan |
|---|---|---|---|
| Dukungan `vlan_filtering`/PVID per port | Penuh | Penuh | Tidak ada di netplan (tidak bisa) |
| Ganti profil port saat uji negatif (access20 ↔ tagged10) | Satu perintah `pxe-switch.sh apply-port sw-p2 <profil>` lewat `ssh root@10.99.0.3` | Tulis ulang file + `networkctl reload`, rawan race dengan networkd | — |
| Testability tanpa VM | Ya: `ip`/`bridge` palsu di PATH, perintah yang dihasilkan diasersi | Hanya isi file | — |
| Konflik dengan netplan cloud image | Port bridge ditandai netplan tanpa alamat (`dhcp4/6: false`, `link-local: []`); script yang mengenslave | Harus menonaktifkan netplan untuk port tersebut | — |

**Rekomendasi: A.** Image: cloud image Ubuntu 24.04 yang sudah ada di `.agent/media/` (sumber
`cloud-images.ubuntu.com`, sama dengan server), dikonversi sekali ke
`.agent/vms/pxe-test-switch-base.qcow2`, overlay per run + seed cloud-init (`cloud-localds`). Tanpa
`package_update`, tanpa NIC NAT. RAM 768 MB, 1 vCPU. NIC manajemen `sw-mgmt` di `pxe-test`
(`10.99.0.3`, tidak di-bridge) hanya untuk ssh/bukti dari host.

---

## O3. Profil VLAN di VM `pxe-test-server`

Base disk server (`server-base.sh`) di-provision dengan konfigurasi flat (`dnsmasq interface=pxe0`,
nginx `10.99.0.2:80`, nfsd `10.99.0.2`) dan `cloud-init` dimatikan di base.

| | A. Base tetap flat; `server-up.sh --topology vlan` menambah NIC `trunk0` dan menerapkan profil VLAN lewat `ssh_root 'bash -s' < apply-vlan-profile.sh` (rekomendasi) | B. Base disk kedua `pxe-test-server-vlan-base` yang di-provision dengan konfigurasi VLAN | C. Injeksi file offline ke overlay (`virt-customize`) |
|---|---|---|---|
| Waktu | +±1 mnt per run | +±20 mnt provisioning (apt + Node), +40 GB disk | Cepat |
| Jendela dnsmasq flat di segmen admin | Ada (±1–2 mnt sejak boot overlay sampai profil diterapkan; belum ada node/switch) | Tidak ada | Tidak ada |
| Dependensi baru | Tidak ada | Tidak ada | libguestfs di host (belum ada di preflight; perilaku tanpa root tidak terjamin) |
| Regresi suite flat M6 | Tetap jalan (default `--topology flat`) | Tetap jalan | Tetap jalan |

**Rekomendasi: A**, dengan mitigasi jendela: switch dan node baru dibuat **setelah** profil
diterapkan dan `verify-listen-vlan.sh` PASS; log dnsmasq dipotong saat profil diterapkan; uji
negatif segmen admin (AC-7.26) berjalan sesudahnya. Bila reviewer menilai jendela itu tidak dapat
diterima, B adalah cadangan tanpa perubahan desain lain.

Isi profil VLAN: netplan `trunk0` tanpa alamat + `pxe10`/`mgmt20`; dnsmasq `interface=pxe10`,
`bind-interfaces`, `except-interface=pxe0,mgmt20,nat0,lo`, `dhcp-range=pxe10,10.99.10.100,
10.99.10.200`, **tanpa opsi router** (`dhcp-option=3`), DNS `10.99.10.2`, boot URL
`http://10.99.10.2/…`; nginx `listen 10.99.0.2:80` + `listen 10.99.10.2:80`; nfsd `host=10.99.10.2`;
rpcbind `-h 10.99.10.2`; exports `10.99.10.0/24` dan `10.99.20.0/24` (read-only); sysctl
`net.ipv4.ip_forward=0`.

---

## O4. Validasi IP statis di VLAN management (celah produk)

SPEC §Network: "Static: IP, prefix, gateway, DNS (multiple), VLAN opsional … Validasi format,
subnet, konflik host lain/lease aktif." DEC-006 mengikat IP/gateway/prefix ke subnet management
tunggal, yang di topologi ini adalah subnet PXE (`10.99.10.0/24`). IP `10.99.20.41` dengan gateway
`10.99.20.1` ditolak server **dan** form.

| | A. VLAN ter-set → validasi konsistensi diri (IP & gateway satu subnet menurut `ip/prefix` payload) | B. Daftar jaringan VLAN terdaftar di Settings: env `PXE_VLAN_NETWORKS` (rekomendasi) | C. VLAN ter-set → hanya format IPv4, tanpa cek subnet |
|---|---|---|---|
| Kesesuaian SPEC "validasi subnet" | Lemah: subnet apa pun diterima | Ya: subnet tetap dikendalikan server (semangat DEC-006) | Tidak |
| Salah ketik (mis. VLAN 20 + IP subnet VLAN 30) | Lolos | Ditolak dengan pesan yang menyebut CIDR VLAN | Lolos |
| Konflik IP | Global (indeks unik IP) | Global | Global |
| Kompatibilitas data/test lama | Mengubah arti `vlan` + IP subnet PXE (test lama memakai `vlan: 20` + IP `10.10.10.x`) | VLAN tidak terdaftar → aturan DEC-006 lama, test lama tidak berubah | Mengubah arti |
| Kerja | Kecil | Sedang: parse env, API, form, Settings | Kecil |

**Rekomendasi: B.** Rincian:
- Format: `PXE_VLAN_NETWORKS="<vlan>:<cidr>:<gateway>[;…]"`, mis. `20:10.99.20.0/24:10.99.20.1`.
  Maks 16 entri; VLAN 1–4094 unik; prefix 8–30; gateway host di CIDR; CIDR tidak tumpang tindih
  dengan `PXE_MGMT_CIDR` maupun entri lain. Kosong = `[]` (perilaku M6 utuh).
- Aturan IP statis dengan `vlan = V`:
  - V terdaftar → IP host di CIDR V (bukan network/broadcast), ≠ gateway V, prefix = prefix CIDR V,
    gateway payload host di CIDR V, tidak bentrok (host lain, lease aktif, gateway payload). Tidak ada
    aturan range DHCP (VLAN management tanpa DHCP dari dashboard).
  - V tidak terdaftar atau `vlan = null` → aturan DEC-006 apa adanya (subnet PXE).
- DNS tetap DEC-011. `GET /api/settings` dan `GET /api/network` menambah `vlanNetworks`.
- Form: daftar VLAN terdaftar ditampilkan; mengetik VLAN terdaftar mengisi prefix/gateway default
  bila belum diubah; validasi dan pratinjau bulk memakai jaringan VLAN itu.
- Butuh decision baru yang **memperluas** DEC-006 (bukan menggantinya).

---

## O5. Jaringan installer selama instalasi

Fakta M6: subiquity memindahkan installer ke konfigurasi network target di tengah instalasi. Pada
topologi VLAN, alamat native (VLAN PXE) dilepas dan lalu lintas sisa instalasi (root live NFS,
callback late-commands, log) berasal dari IP VLAN management. Debian (d-i netcfg DHCP) dan Rocky
(VLAN ditambahkan di samping koneksi boot) tetap di VLAN PXE selama instalasi.

| | A. Topologi: server dapat dijangkau dari VLAN management (server = gateway `10.99.20.1`, tanpa forwarding; nginx listen `10.99.10.2`; ekspor NFS mencakup subnet management); generator tidak berubah (rekomendasi) | B. Generator: instalasi tetap di VLAN PXE, VLAN management hanya untuk target (Ubuntu: `network` autoinstall DHCP native, netplan target ditulis late-command) | C. OS terpasang mempertahankan DHCP di native (dual-homed) |
|---|---|---|---|
| Perubahan produk | Tidak ada (hanya dokumentasi syarat jaringan) | Ubuntu generator berubah besar (menyimpang dari jalur yang sudah terbukti M6; risiko cloud-init/subiquity menulis ulang netplan target) | Kecil |
| Syarat production | PXE server terjangkau dari VLAN management untuk HTTP **dan** NFS (Ubuntu) | Hanya HTTP (callback Done dari OS terpasang) | — |
| Callback Done dari OS terpasang | Tetap butuh rute management → server (sama di semua opsi kecuali C) | Sama | Lewat VLAN PXE |
| Kesesuaian ekspektasi production (VLAN PXE hanya untuk provisioning) | Ya | Ya | Tidak (host terpasang memegang lease PXE selamanya) |

**Rekomendasi: A**, dibuktikan dini oleh smoke KVM (M7-T10). Bila smoke membuktikan instalasi Ubuntu
macet setelah perpindahan network (mis. root NFS tidak pulih), Orchestrator memutuskan B lewat
decision baru (bukan diam-diam di dev). Syarat jaringan (VLAN management harus bisa menjangkau
`PXE_SERVER_IP` lewat HTTP, dan NFS untuk Ubuntu) dicatat di `infra/README.md` §Topologi VLAN.

---

## O6. Interface native (VLAN PXE) di OS terpasang

| | A. Native tanpa IPv4 (link up, hanya parent VLAN) di ketiga distro (rekomendasi) | B. Native DHCP dipertahankan | C. Native dimatikan (link down) |
|---|---|---|---|
| Ubuntu / Debian | Sudah begitu (`dhcp4: false` / `inet manual`) | Perlu ubah generator | Mematikan VLAN anak (parent wajib up) |
| Rocky | Perlu perbaikan: anaconda kemungkinan menyalin profil boot (`ip=dhcp`) ke target dengan autoconnect | Sudah (kemungkinan) | — |
| Uji `verify-node` "tidak ada IPv4 di NIC lain" | Lulus | Gagal | — |
| Production | Host tidak memakan lease PXE; boot ulang tetap PXE di native (iPXE menyajikan boot lokal) | Dual-homed | Rusak |

**Rekomendasi: A.** Rocky: `%post` (target) memastikan profil NetworkManager untuk parent (MAC host)
`ipv4.method=disabled`, `ipv6.method=disabled` (atau `ignore`), dan tidak ada profil DHCP lain untuk
parent; profil VLAN dari baris `network --vlanid` tetap. Hanya berlaku bila `vlan ≠ null`. Mekanisme
persis (keyfile tulis langsung vs `nmcli --offline`) dipilih dev, dibuktikan unit test + KVM.

---

## O7. Verifikasi SSH ke node di VLAN management

| | A. Relay di dalam `pxe-test-server`: host `ssh -i .agent/keys/infra_ed25519 root@10.99.0.2 'bash -s' < infra/vlan/relay.sh` dengan mode terbatas (rekomendasi) | B. `ProxyJump` dari host | C. Sub-interface VLAN di host |
|---|---|---|---|
| DEC-023 §4 | Sesuai | Dilarang | Butuh sudo (dilarang) |
| Hook | Hanya ssh ke `10.99.0.2` | — | — |
| Kendali | Mode allowlist: `verify`, `pwcheck`, `wait-ssh`, `reboot`, `probe` (ping/curl ke tujuan tetap); IP tujuan wajib `10.99.20.0/24` | — | — |

**Rekomendasi: A.** Key node sekali pakai disalin ke `/root/pxe-relay/` (0600, root) di VM server
khusus run itu, dihapus di `finish` (juga pada run parsial) sebelum server dimatikan; overlay server
juga dihapus saat cleanup. `verify-node.sh` disalin ke tempat yang sama. Playwright memakai helper
`relay()` di `kvm-harness.ts` (env `PXE_KVM_INFRA_KEY` di `.agent/keys/`); `ssh()` langsung tetap
menolak IP selain `10.99.0.*`.

---

## O8. Struktur run KVM M7

| | A. Tiga skenario: `vlanneg`, `vlancore`, `vlandistro` (rekomendasi) | B. Satu run besar |
|---|---|---|
| Batas `kvm-run.sh` 1–3 node/run | Terpenuhi | Perlu dilonggarkan |
| Ulang setelah perubahan (iterasi gate) | Hanya skenario terdampak | Semua |
| Port 2 dengan dua profil berurutan (uji negatif) | Alur khusus di `vlanneg`, satu node pada satu waktu | Rumit |

**Rekomendasi: A.** Bulk 3× UEFI Ubuntu **tidak** diulang di KVM M7 (tidak termasuk matriks DEC-023
§5; jalur bulk tidak bergantung pada VLAN di sisi node selain perencanaan IP, yang diuji unit + E2E
mock). Bila Orchestrator ingin bulk VLAN di KVM, tambahkan skenario `vlanbulk` (node 45–47) dengan
mode gelombang M6.

---

## O9. Bukti uji negatif isolasi

| | A. Capture DHCP saja (`udp port 67 or 68`, juga ber-tag) di server (`pxe0`, `trunk0`) + switch (`sw-p2`) bila `tcpdump` ada, + log dnsmasq/nginx + counter interface + API hosts (rekomendasi) | B. Log saja (dnsmasq/nginx) | C. VM pengamat khusus |
|---|---|---|---|
| Membuktikan "node mengirim DISCOVER tetapi tidak dijawab" | Ya (pcap: ≥ 1 DISCOVER, 0 reply) | Tidak (log kosong bisa berarti frame tidak pernah sampai) | Ya |
| Membuktikan native → tag (switch bekerja) | Ya: di `trunk0` DISCOVER node port 1 terlihat `vlan 10` | Tidak | Ya |
| Risiko secret di bukti | Rendah: filter hanya DHCP, disimpan sebagai ringkasan teks (`tcpdump -r -nn -e`) | Rendah | Rendah |
| Biaya | Kecil (tcpdump di server dari base Ubuntu; switch: fallback `ip -s link` bila tidak ada) | Nol | +1 VM, +RAM |

**Rekomendasi: A.** Tanpa capture HTTP (token tidak boleh masuk pcap). Bila `tcpdump` tidak ada di
cloud image switch, bukti sisi port memakai counter `ip -s link show sw-p2` (RX naik) dan
`virsh domifstat` (baca saja) — tidak memberi NAT ke switch tanpa decision.

---

## O10. Dukungan VLAN Debian di target

ifupdown Debian 12 membuat `$IF.<id>` lewat hook paket `vlan` atau dukungan bawaan (belum terbukti di
lab). Media hanya DVD-1 lokal (tanpa NAT).

| | A. Tidak ada perubahan; smoke membuktikan; bila gagal → B (rekomendasi) | B. `pkgsel/include` paket `vlan` (dari DVD-1) bila `vlan ≠ null` | C. Ganti ke netplan/systemd-networkd di target Debian |
|---|---|---|---|
| Perubahan | Nol | Kecil, kondisional; butuh paket ada di DVD-1 (dicek `server-check`) | Besar |

**Rekomendasi: A dengan cadangan B** yang diputuskan berdasarkan bukti smoke (M7-T10), bukan dugaan.

---

## Ringkasan rekomendasi (kandidat decision)

1. **O1-A** trunk terpisah `pxe-test-trunk`; admin `pxe-test` untagged tetap `10.99.0.0/24`.
2. **O2-A** switch: script iproute2 + unit oneshot, base dari cloud image Ubuntu yang ada, tanpa NAT.
3. **O3-A** profil VLAN server diterapkan saat runtime pada overlay baru; cadangan O3-B.
4. **O4-B** `PXE_VLAN_NETWORKS` + validasi per VLAN terdaftar; memperluas DEC-006.
5. **O5-A** server terjangkau dari VLAN management (gateway, tanpa forwarding); syarat dicatat; cadangan
   O5-B lewat decision bila smoke gagal.
6. **O6-A** native tanpa IPv4 di OS terpasang; perbaikan Rocky `%post`.
7. **O7-A** relay terbatas di VM server; key node sekali pakai dihapus per run.
8. **O8-A** skenario `vlanneg`/`vlancore`/`vlandistro`; bulk VLAN tidak di KVM.
9. **O9-A** capture DHCP-only + log + counter.
10. **O10-A/B** Debian: buktikan dulu; tambah paket `vlan` hanya bila perlu.
