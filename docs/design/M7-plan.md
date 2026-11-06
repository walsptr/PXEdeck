# M7 — PXE lewat VLAN (plan)

- Milestone: 7 (tambahan, DEC-023) · Branch: `milestone/7-vlan` · Worktree `.agent/wt-m7`
- Sumber: **DEC-023** (cakupan wajib), SPEC §Network ("Static: IP, prefix, gateway, DNS (multiple),
  VLAN opsional … Validasi format, subnet, konflik host lain/lease aktif"), §Model data
  (`host_configs.vlan`); CLAUDE.md §Gate approval, §Batas keras, §Pengujian KVM; DEC-003/009
  (topologi, NAT hanya untuk server), DEC-006 (aturan subnet IP statis), DEC-011 (DNS bebas subnet),
  DEC-013 (binding IP), DEC-015/017 (allowlist admin, login), DEC-018 (struktur run KVM), DEC-020
  (stage2 Rocky NFS), DEC-021/022 (media Debian lokal ⇔ host `PXE_MEDIA_URL` = `PXE_SERVER_IP`).
- Opsi & rekomendasi: `docs/design/M7-options.md` (O1–O10). Plan ini mengasumsikan rekomendasi
  diterima; AC yang bergantung pada opsi ditandai `[O<n>]`.
- Kode dasar: `main` @ `c9db581` (M6 approved). Gate **identik** dengan CLAUDE.md (§4 akhir).

## 0. Temuan dari kode (dasar keputusan)

| # | Fakta | Bukti | Dampak M7 |
|---|---|---|---|
| F1 | Dashboard mengenal **satu** jaringan: subnet PXE = subnet IP statis. IP di luar `PXE_MGMT_CIDR` → "Di luar subnet …"; prefix wajib = prefix subnet; gateway wajib host di subnet. `PXE_SERVER_IP`, gateway, range DHCP wajib di CIDR yang sama. | `lib/net.ts:111-135,147-172,339-353`; `config-service.ts:367-388`; `tab-network.tsx:54-55`; `form-state.ts:227-251` | **Celah produk**: IP VLAN management `10.99.20.41` + gateway `10.99.20.1` ditolak server dan form → O4 |
| F2 | Ubuntu: `ethernets.mgmt` (match MAC, `dhcp4/6: false`) + `vlans."mgmt.<id>"` (`link: mgmt`, alamat/route/DNS) | `installers/ubuntu.ts:43-67` | Benar untuk topologi; tidak diubah |
| F3 | Debian: `/etc/network/interfaces.d/mgmt` → parent `inet manual` + `$IF.<id>` static; d-i tetap DHCP selama instalasi | `installers/debian.ts:130-143,180-184,238` | Benar; dukungan VLAN ifupdown di target belum terbukti → O10 |
| F4 | Rocky: satu baris `network --device=<mac> --bootproto=static … --vlanid=<id> --activate`; parent tidak diatur | `installers/rocky.ts:83-88` | Parent kemungkinan tetap DHCP di target (profil boot `ip=dhcp`) → O6 |
| F5 | **Subiquity menerapkan network target ke lingkungan installer**: node21 M6 mengambil `user-data` dari lease `10.99.0.200`, callback late-commands dari IP statis `10.99.0.31` | `.agent/runs/m6/kvm/core/server-nginx.txt` baris 174 vs 276–277, 1047–1048 | Ubuntu pindah ke VLAN management di tengah instalasi (root live tetap NFS) → server wajib terjangkau dari VLAN management, ekspor NFS mencakup subnet management → O5 |
| F6 | Callback status/log menerima IP lease ∪ `current_ip` ∪ IP statis ∪ `mgmt_ip`; fetch file konfigurasi hanya lease ∪ `current_ip`; `done` menyetel `current_ip` = IP sumber | `provisioning.ts:67-71,92,189,223,306` | Tidak perlu perubahan; diuji regresi (AC-7.5) |
| F7 | Discovery & binding lease: `ipMatchesLease(mac, ip)`; `syncLeases` dari file lease | `discovery.ts:117-133,225-254` | Lease ada di VLAN PXE (`10.99.10.x`); path file lease tidak berubah |
| F8 | Media Debian lokal ⇔ host `PXE_MEDIA_URL` sama persis dengan `PXE_SERVER_IP` | `installers/context.ts:75-82`; `install-service.ts:59` | `PXE_SERVER_IP`, `PXE_BASE_URL`, `PXE_MEDIA_URL` wajib alamat VLAN PXE `10.99.10.2` |
| F9 | `baseUrl` hanya dipakai jalur boot (iPXE, URL config/callback) dan teks Settings; UI/redirect tidak memakainya | grep `baseUrl` di `src/` | UI tetap di `http://10.99.0.2` (admin), node memakai `http://10.99.10.2` |
| F10 | Infra terikat `10.99.0.2`/`pxe0`: dnsmasq `interface=pxe0`, nginx `listen 10.99.0.2:80`, nfsd `host=10.99.0.2`, rpcbind `-h 10.99.0.2`, ekspor `10.99.0.0/24`, `verify-listen.sh ok_local`, `deploy-dashboard.sh EXPECT_CIDR`, `node.sh` selalu `network=pxe-test`, `kvm-run.sh verify_one` ssh langsung ke IP node, `kvm-harness.ts` regex `10.99.0.*` | `infra/server/*`, `infra/{node,kvm-run,deploy-dashboard}.sh`, `e2e-kvm/kvm-harness.ts:48,99` | Profil topologi `vlan` di infra; flat tetap default |
| F11 | `verify-node.sh` mencari NIC berdasarkan MAC dan mewajibkan IP di NIC itu; sub-interface VLAN punya MAC yang sama dengan parent | `e2e-kvm/verify-node.sh:67-77` | Perlu mode `EXPECT_VLAN` (parent + id VLAN) |
| F12 | Hook: ssh/scp/curl dari host hanya ke `10.99.0.*`; host tidak punya route ke `10.99.10/20` sehingga paket ke sana akan keluar lewat default route fisik | `.claude/hooks/guard_bash.py:29-40,197-209` | Semua akses ke node/server VLAN lewat relay di VM server; asersi statis tidak ada skrip host yang menyasar `10.99.10.*`/`10.99.20.*` |
| F13 | M6-T16 menghapus `pxe-test`, `pxe-test-nat`, base disk server, dan key | `docs/agent-workflow/reports/REPORT-m6.md`, AC-6.54 | Base server di-provision ulang (±20 mnt) di awal M7 |

## 1. Ruang lingkup

Masuk M7:
1. **Topologi uji VLAN** (DEC-023 §2–§3) [O1–O3]: network terisolasi tambahan `pxe-test-trunk`,
   `pxe-test-port1`, `pxe-test-port2`; VM `pxe-test-switch` (bridge `vlan_filtering`); profil VLAN
   di `pxe-test-server` (sub-interface ber-tag, dnsmasq hanya di VLAN PXE).
2. **Perubahan produk** [O4, O6, O10]: jaringan VLAN management terdaftar di Settings
   (`PXE_VLAN_NETWORKS`), validasi IP statis per VLAN (server + form + pratinjau bulk), tampilan
   Settings; Rocky: native tanpa IPv4 di OS terpasang; Debian: dukungan VLAN target bila smoke
   membuktikan perlu.
3. **Harness** [O7–O9]: relay SSH di VM server, `verify-node.sh` mode VLAN, skenario `kvm-run.sh`
   `vlanneg`/`vlancore`/`vlandistro`, capture DHCP, cleanup switch/network.
4. **KVM**: matriks DEC-023 §5 (UEFI Ubuntu 24.04, BIOS Ubuntu 24.04, UEFI Debian 12, UEFI Rocky 9)
   lewat alur E2E dashboard yang sama dengan M6 + uji negatif isolasi + uji validasi di server nyata.
5. **Dokumentasi**: `infra/README.md` §Topologi VLAN (termasuk syarat jaringan production), `.env.example`.
6. **Penutupan** (setelah APR M7): hapus semua network/VM `pxe-test-*` milik M7 (DEC-023 §7).

Tidak masuk M7: bulk KVM di VLAN [O8] (bulk VLAN diuji unit + E2E mock); Windows (tetap generator
saja); VLAN PXE ber-tag di sisi node (iPXE VLAN) — topologi production DEC-023 adalah PXE native;
pengaturan VLAN switch/router dari dashboard; IPv6; perubahan SPEC (perluasan DEC-006 cukup lewat
decision).

## 2. Rancangan teknis

### 2.1 Topologi

```
 host 10.99.0.1 (Playwright, ssh 10.99.0.*)
   │ virbr-pxe  ── network pxe-test (admin, untagged, 10.99.0.0/24, tanpa dhcp/forward) ──┬──────────────┐
   │                                                                                    │              │
   │                                              pxe-test-server                       │ sw-mgmt      │ (uji N1:
   │                                    pxe0 10.99.0.2 ─────────────────────────────────┘ 10.99.0.3    │  node di
   │                                    nat0 192.168.199.2 ── pxe-test-nat (apt saja, DEC-009)         │  segmen admin)
   │                                    trunk0 (tanpa IP) ── pxe-test-trunk ── sw-up  [10T,20T]        │
   │                                      ├ pxe10  VLAN 10  10.99.10.2/24  (dnsmasq, nginx, nfsd)      │
   │                                      └ mgmt20 VLAN 20  10.99.20.1/24  (gateway node, tanpa forward)
   │                                                        pxe-test-switch: br0 vlan_filtering=1
   │                                                          sw-p1 [10U PVID, 20T] ── pxe-test-port1 ── node31..34 (+smoke 41..43)
   │                                                          sw-p2 [profil: access20 = 20U PVID | tagged10 = 10T]
   │                                                                                 ── pxe-test-port2 ── node37 (N2), node38 (N3)
```

| Network | Bridge host | IP host | Peran | Isi |
|---|---|---|---|---|
| `pxe-test` | `virbr-pxe` | `10.99.0.1/24` | Admin untagged (UI, ssh, bukti) | server `pxe0` `10.99.0.2`, switch `sw-mgmt` `10.99.0.3`, node uji N1 |
| `pxe-test-nat` | `virbr-pxenat` | `192.168.199.1` | NAT apt server saja (DEC-009) | server `nat0` |
| `pxe-test-trunk` | `virbr-pxetrk` | **tanpa `<ip>`** | Trunk server ↔ switch | server `trunk0`, switch `sw-up` |
| `pxe-test-port1` | `virbr-pxep1` | **tanpa `<ip>`** | Port node: VLAN 10 native, VLAN 20 ber-tag | node matriks & smoke |
| `pxe-test-port2` | `virbr-pxep2` | **tanpa `<ip>`** | Port uji negatif (profil diganti saat uji) | node N2/N3 |

Semua network baru: tanpa `<forward>`, tanpa `<dhcp>`, tanpa `<ip>` (host tidak punya kehadiran L3,
libvirt tidak menjalankan dnsmasq), tanpa interface fisik, nama `^pxe-test-`, bridge ≤ 15 karakter.
Linux bridge host (`vlan_filtering=0`) meneruskan frame ber-tag apa adanya.

| VLAN | Subnet | Alamat tetap | Catatan |
|---|---|---|---|
| (untagged admin) | `10.99.0.0/24` | host `.1`, server `.2`, switch `.3` | Tidak ada DHCP di segmen ini |
| 10 PXE (native di port node, ber-tag di trunk) | `10.99.10.0/24` | server `pxe10` `.2`; `.1` cadangan (gateway Settings, tidak dipakai perangkat) | DHCP `.100–.200`, **tanpa opsi router**, DNS `.2` |
| 20 management (ber-tag) | `10.99.20.0/24` | server `mgmt20` `.1` (gateway node, `ip_forward=0`) | IP node `10.99.20.(10+NN)` |

MAC: server `pxe0 52:54:00:99:01:02`, `nat0 …:01:03`, `trunk0 …:01:04`; switch `sw-mgmt
52:54:00:99:02:01`, `sw-up …:02:02`, `sw-p1 …:02:03`, `sw-p2 …:02:04`; node `52:54:00:99:00:NN`
(semua lolos `assert_mac`).

### 2.2 VM `pxe-test-switch` [O2]

- `infra/switch-base.sh`: sekali, `qemu-img convert` cloud image Ubuntu 24.04 (`.agent/media/`) →
  `.agent/vms/pxe-test-switch-base.qcow2` + marker `.ready` (tanpa boot, tanpa paket).
- `infra/switch-up.sh`: overlay `.agent/vms/pxe-test-switch.qcow2`, seed
  `.agent/vms/pxe-test-switch-seed.iso` (`cloud-localds`): root key-only dengan
  `.agent/keys/infra_ed25519.pub`, `write_files` `/usr/local/sbin/pxe-switch.sh` (dari
  `infra/switch/pxe-switch.sh`), `/etc/pxe-switch.conf`, unit `pxe-switch.service` (oneshot,
  `After=systemd-networkd.service`); network-config: `sw-mgmt` statis `10.99.0.3/24` tanpa gateway,
  `sw-up/sw-p1/sw-p2` di-match MAC tanpa alamat (`dhcp4/6: false`, `link-local: []`). RAM 768 MB,
  1 vCPU, serial ke `.agent/runs/m7/kvm/<s>/pxe-test-switch-serial.log` (socat, port 45902).
- `pxe-switch.sh apply` (idempoten): `br0 type bridge vlan_filtering 1 vlan_default_pvid 0
  stp_state 0`, tanpa IP; `bridge vlan` per port:

  | Port | VLAN | Profil |
  |---|---|---|
  | `sw-up` | 10 tagged, 20 tagged | tetap |
  | `sw-p1` | 10 `pvid untagged`, 20 tagged | tetap (production DEC-023) |
  | `sw-p2` | `access20`: 20 `pvid untagged` (default) · `tagged10`: 10 tagged tanpa PVID | `pxe-switch.sh apply-port sw-p2 <profil>` |

  `br0 self` tanpa VLAN. Profil lain → exit ≠ 0. `pxe-switch.sh show` → `bridge -d vlan show`,
  `ip -d link show br0`, `ip -s link` (bukti `switch-check.txt`).
- Akses: `ssh -i .agent/keys/infra_ed25519 root@10.99.0.3` (di dalam `10.99.0.*`). Tidak ada NAT.

### 2.3 Profil VLAN `pxe-test-server` [O1, O3, O5]

`infra/server-up.sh --topology vlan` (default `flat` = perilaku M6 utuh):
1. VM dibuat dengan NIC ketiga `network=pxe-test-trunk,mac=52:54:00:99:01:04`.
2. Setelah SSH siap: `ssh_root 'bash -s' < infra/server/vlan/apply-profile.sh` (root di dalam VM):
   `systemctl stop dnsmasq` → pasang `infra/server/vlan/*`:
   - `netplan-vlan.yaml` (tambahan, base tetap): `trunk0` (match MAC, `set-name`, tanpa alamat),
     `vlans.pxe10 {id 10, link trunk0, 10.99.10.2/24}`, `vlans.mgmt20 {id 20, link trunk0,
     10.99.20.1/24}`; `netplan apply`.
   - `dnsmasq-vlan.conf` menggantikan `/etc/dnsmasq.d/pxe.conf`: `interface=pxe10`,
     `bind-interfaces`, `except-interface=lo,nat0,pxe0,mgmt20`, `no-dhcp-interface=pxe0,mgmt20`,
     `dhcp-range=pxe10,10.99.10.100,10.99.10.200,255.255.255.0,1h`, `dhcp-option=3` (tanpa router),
     `dhcp-option=option:dns-server,10.99.10.2`, boot URL `http://10.99.10.2/boot/${mac}.ipxe…`,
     `dhcp-boot=…,10.99.10.2`, TFTP, `log-dhcp`; file lease **tetap** `/var/lib/misc/dnsmasq.leases`.
   - nginx: `listen 10.99.0.2:80` **dan** `listen 10.99.10.2:80` (satu server block, isi lokasi sama
     dengan M6; allowlist admin `10.99.0.1` tetap; `/boot/`, `/media/` tanpa allow/deny); tidak listen
     di `10.99.20.1`.
   - NFS: `[nfsd] host=10.99.10.2`; rpcbind `-h 10.99.10.2`; ekspor ro `10.99.10.0/24` dan
     `10.99.20.0/24` (Ubuntu pindah ke VLAN management di tengah instalasi, F5).
   - sysctl `net.ipv4.ip_forward=0` (eksplisit), `rp_filter` default.
   - nftables: aturan `nat0` M6 tetap.
   - Log dnsmasq dipotong (bukti dimulai setelah profil aktif), `systemctl start dnsmasq`.
3. `infra/server/vlan/verify-listen-vlan.sh` (root VM) → `server-listen-vlan.txt`: dnsmasq hanya
   `%pxe10`/`10.99.10.2` (67/69/53); nginx hanya `10.99.0.2:80` + `10.99.10.2:80`; nfsd hanya
   `10.99.10.2:2049`; tidak ada socket dnsmasq/nginx/nfsd di `10.99.0.2` (kecuali nginx :80),
   `10.99.20.1`, `%pxe0`, `%mgmt20`, `nat0`; `ip_forward=0`; `bridge`/`ip -d link` menunjukkan
   `pxe10` id 10 dan `mgmt20` id 20 di `trunk0`. Gagal → `systemctl stop dnsmasq`, exit 1.
4. Switch dan node **hanya** dibuat setelah langkah 3 PASS [O3 mitigasi jendela].

Env dashboard VLAN (`infra/server/dashboard-vlan.env`, dipilih `deploy-dashboard.sh --topology
vlan`; tanpa rahasia):
```
PXE_MGMT_CIDR=10.99.10.0/24        # subnet PXE (nama variabel lama, DEC-006)
PXE_MGMT_GATEWAY=10.99.10.1        # cadangan, wajib ada menurut Settings
PXE_MGMT_DNS=10.99.10.2
PXE_SERVER_IP=10.99.10.2           # nfsroot, inst.stage2, isLocalMedia (DEC-021)
PXE_DHCP_RANGE=10.99.10.100-10.99.10.200
PXE_DHCP_INTERFACE=pxe10
PXE_BASE_URL=http://10.99.10.2
PXE_MEDIA_URL=http://10.99.10.2/media
PXE_ALLOWED_HOSTS=10.99.0.2,10.99.10.2
PXE_VLAN_NETWORKS=20:10.99.20.0/24:10.99.20.1
(sisanya identik dashboard.env M6: lease, pidfile, trust proxy, timeout, admin placeholder)
```
`deploy-dashboard.sh --topology vlan` mengasersi `cidr 10.99.10.0/24` dan `vlanNetworks` memuat
VLAN 20 di `GET /api/settings` (dari host lewat `10.99.0.2`). `PXE_ADMIN_ALLOW` tetap `10.99.0.1`.

### 2.4 Alur paket per tahap (topologi VLAN)

| Tahap | Node di | IP sumber node | Tujuan | Jalur |
|---|---|---|---|---|
| DHCP + TFTP + iPXE `/boot/<mac>.ipxe` | VLAN 10 native | lease `10.99.10.1xx` | `10.99.10.2` | `sw-p1` (untagged→tag 10) → `trunk0.10` |
| Kernel/initrd, `/media`, NFS root (Ubuntu), stage2 NFS (Rocky), repo HTTP (Debian/Rocky) | VLAN 10 | lease | `10.99.10.2` | sama |
| Fetch `user-data`/`preseed.cfg`/`ks.cfg` | VLAN 10 | lease (wajib, F6) | `10.99.10.2` | sama |
| Ubuntu setelah subiquity menerapkan network (F5): sisa NFS root, late-commands, log, status `configuring` | VLAN 20 | `10.99.20.(10+NN)` | `10.99.10.2` via gateway `10.99.20.1` (= server, penerimaan lokal, tanpa forwarding) | `sw-p1` tag 20 → `trunk0.20` |
| Debian/Rocky late/`%post` callback | VLAN 10 | lease | `10.99.10.2` | VLAN 10 |
| First-boot `done` dari OS terpasang (semua distro) | VLAN 20 | IP statis | `10.99.10.2` via `10.99.20.1` | VLAN 20; `done` menyetel `current_ip` = IP VLAN 20 |
| Reboot verifikasi → PXE di native → iPXE boot lokal → disk | VLAN 10 lalu 20 | lease lalu statis | — | `current_ip` kembali ke lease (F7), status tetap Done |
| Verifikasi SSH | — | — | server → node `10.99.20.x` lewat `mgmt20` | relay (§2.6) |

Syarat production yang didokumentasikan [O5]: `PXE_SERVER_IP` harus terjangkau dari VLAN management
lewat HTTP (callback `done` dari OS terpasang, semua distro) dan, untuk Ubuntu, juga NFS (root live
setelah subiquity menerapkan network). Tanpa itu job berhenti di Configuring sampai timeout.

### 2.5 Perubahan produk

**a. Settings `PXE_VLAN_NETWORKS` [O4]** — `lib/net.ts` (tipe + parser murni `vlanNetworksFromEnv`),
`lib/server/settings.ts` (masuk `Settings.vlanNetworks`, `SETTINGS_ENV_KEYS`, `SettingsResponse`),
`lib/server/net-config.ts`, route `GET /api/settings` dan `GET /api/network`, `.env.example`.
- Format `"<vlan>:<cidr>:<gateway>[;…]"`; aturan: maks 16; VLAN 1–4094 unik; CIDR valid prefix 8–30
  (dinormalisasi ke alamat network); gateway host di CIDR; CIDR tidak tumpang tindih dengan
  `PXE_MGMT_CIDR` maupun entri lain. Error → `Konfigurasi server tidak valid: PXE_VLAN_NETWORKS …`
  (fail fast, sama dengan variabel lain). Kosong → `[]`.
- Respons: `vlanNetworks: [{vlan, cidr, prefix, gateway}]`.

**b. Validasi IP statis** — `lib/net.ts` (dipakai server **dan** form):
`resolveStaticNetwork(vlan, settings)` → jaringan VLAN terdaftar atau jaringan PXE (DEC-006).
`validateStaticNetwork`, `validateStaticIp`, `validateIpAssignments`, `planIps` menerima jaringan
hasil resolusi. Aturan untuk VLAN terdaftar: IP host di CIDR (bukan network/broadcast), ≠ gateway
VLAN, prefix = prefix CIDR, gateway payload host di CIDR, bentrok (host lain: `mgmt_ip` dan lease
aktif; gateway payload; duplikat batch) — tanpa aturan range DHCP. Pesan: `Di luar subnet
10.99.20.0/24 (VLAN 20)`, `Prefix /16 tidak sesuai subnet VLAN 20 10.99.20.0/24 (harus /24)`,
`Gateway 10.99.10.1 di luar subnet VLAN 20 10.99.20.0/24`. `vlan = null` atau VLAN tidak terdaftar →
aturan dan pesan DEC-006 **tanpa perubahan** (test lama tidak diubah). `config-service.ts`
memakai resolusi itu di dalam transaksi yang sama.

**c. UI** (`components/host-config/{tab-network,form-state}.tsx|ts`, `components/settings/settings-view.tsx`,
`hooks/use-settings.ts`):
- Tab Network: field "VLAN ID (opsional)" menampilkan petunjuk VLAN terdaftar (`20 · 10.99.20.0/24`,
  mono). VLAN terdaftar diketik → prefix & gateway diisi dari jaringan VLAN **bila belum diubah
  pengguna**; deskripsi IP "Di dalam `10.99.20.0/24` (VLAN 20)" (tanpa kalimat range dinamis);
  `prefixInvalid`/`gatewayInvalid` dan ringkasan error memakai jaringan hasil resolusi; pratinjau
  bulk (range/increment) dimulai dari `.11` jaringan VLAN. Deskripsi mode Static tidak lagi
  menyebut "reservasi DHCP" bila VLAN terdaftar dipilih (IP itu bukan di VLAN PXE).
- Settings: blok read-only "VLAN management" (tabel VLAN · Subnet · Gateway, mono; empty state
  "Tidak ada VLAN management terdaftar (PXE_VLAN_NETWORKS)"). Design system SPEC §1: hairline, tanpa
  shadow, tanpa oranye baru, label 11/600 uppercase.

**d. Generator** [O6, O10] — hanya bila `vlan ≠ null`:
- Ubuntu: tidak berubah (F2). Docstring menjelaskan perpindahan network di tengah instalasi (F5).
- Rocky: `%post` memastikan profil NetworkManager parent (MAC host) `ipv4.method=disabled`,
  `ipv6.method=disabled|ignore`, autoconnect yes, dan menghapus profil DHCP lain yang terikat parent;
  profil VLAN (`--vlanid`) tidak disentuh. Tanpa VLAN → golden lama identik.
- Debian: tidak berubah kecuali smoke (M7-T10) membuktikan `$IF.<id>` tidak naik di target; maka
  `pkgsel/include vlan` (DVD-1 lokal) kondisional + `server-check` memeriksa paket ada di media.
  Keputusan dicatat Orchestrator (O10).
- Token tetap tidak masuk konfigurasi installer mana pun (B-5); batas `late_command` Debian tetap.

### 2.6 Infra & harness

- **Network**: `infra/net/pxe-test-{trunk,port1,port2}.xml`; `net-up.sh --topology vlan`
  mendefinisikan/menyalakan kelimanya (idempoten) dan menolak XML network baru yang memuat
  `<forward>`, `<dhcp>`, atau `<ip>`; `net-down.sh --topology vlan` menghapus kelimanya (teardown).
- **`lib.sh`**: konstanta `NET_TRUNK`, `NET_PORT1`, `NET_PORT2`, `SWITCH_NAME=pxe-test-switch`,
  `SWITCH_IP=10.99.0.3`, `SERVER_MAC_TRUNK`, `SERVER_PXE_VLAN_IP=10.99.10.2`, `SERVER_MGMT_VLAN_IP=10.99.20.1`;
  `ssh_switch_root`. Konstanta lain M6 tidak berubah.
- **`node.sh`**: argumen/env jaringan node (`--net pxe-test|pxe-test-port1|pxe-test-port2`,
  default `pxe-test`), divalidasi allowlist; selain itu identik (qcow2 20 GB, 2 GB, 2 vCPU,
  `--pxe --boot network,hd`, UEFI OVMF, `no_install=yes`, cek `on_reboot`).
- **`cleanup.sh`**: `--switch` (destroy + undefine `pxe-test-switch`, hapus overlay + seed; `--base`
  juga base switch); run id berawalan `switch` ditolak (sama dengan `server*`/`nat*`).
- **Relay** [O7] `infra/vlan/relay.sh` (dijalankan root di VM server lewat
  `ssh -i .agent/keys/infra_ed25519 root@10.99.0.2 'MODE=… NODE_IP=… … bash -s' < relay.sh`):
  - `MODE=setup` (dari kvm-run): `/root/pxe-relay/` 0700; key node + `verify-node.sh` disalin
    sebelumnya oleh `scp` ke `10.99.0.2` (key 0600). `MODE=teardown`: hapus direktori, cetak
    `relay-clean: absent`.
  - `MODE=verify|pwcheck|wait-ssh|reboot|probe|capture-start|capture-stop`; `NODE_IP` wajib
    `^10\.99\.20\.[0-9]{1,3}$`; `probe` hanya tujuan tetap (`ping 10.99.0.1`, `curl
    http://10.99.10.2/api/hosts`, `curl http://10.99.0.2/api/hosts`) yang dijalankan **di node**.
    Mode lain → exit 2. Tidak pernah mencetak isi key.
  - `capture-start <if>` (`pxe0` atau `trunk0`): `tcpdump -i <if> -nn -e -w /root/pxe-cap/<if>.pcap
    '(udp port 67 or udp port 68) or (vlan and (udp port 67 or udp port 68))'` di latar; `capture-stop`
    → ringkasan teks `tcpdump -r … -nn -e` ke stdout (pcap mentah tidak dibawa ke host).
- **`verify-node.sh` mode VLAN**: env opsional `EXPECT_VLAN`; bila ada: parent = interface ber-MAC
  `EXPECT_MAC` yang **bukan** perangkat VLAN; anak = perangkat `vlan protocol 802.1Q id
  EXPECT_VLAN` dengan link parent itu (dibaca `ip -d -o link`, bukan nama); anak memuat
  `EXPECT_IP/EXPECT_PREFIX`; parent tanpa IPv4; tidak ada IPv4 di interface lain. Tanpa `EXPECT_VLAN`
  → perilaku M6 identik.
- **`kvm-run.sh`**:
  - Skenario `vlanneg`, `vlancore`, `vlandistro` (run id `m7vlanneg`, `m7vlancore`, `m7vlandistro`;
    bukti `.agent/runs/m7/kvm/<s>/`, ringkasan `.agent/runs/m7/kvm/results.json`), menyiratkan
    `--topology vlan`. Default node: `vlancore` `"31:uefi 32:bios"`, `vlandistro`
    `"33:uefi:os=debian 34:uefi:os=rocky"`, `vlanneg` `"36:uefi:neg=admin 37:bios:neg=access20
    38:uefi:neg=tagged10"`. Smoke: `--scenario vlansmoke` `"41:uefi 42:uefi:os=rocky 43:uefi:os=debian"`.
  - Spec node: `NN:uefi|bios[:destroy|:failpath][:os=…][:neg=admin|access20|tagged10]`. IP node VLAN
    = `10.99.20.(10+NN)`; jaringan node: `neg=admin` → `pxe-test`, `access20|tagged10` →
    `pxe-test-port2`, lainnya → `pxe-test-port1`.
  - Urutan VLAN: libvirt-before → preflight → `net-up --topology vlan` → `server-up --topology vlan`
    (profil + verifikasi) → deploy (`--topology vlan`) → `switch-up` + `switch-check` →
    server-check → key sekali pakai → relay setup → node / Playwright (`vlancore`/`vlandistro`) atau
    alur negatif (`vlanneg`, §2.7) → verifikasi via relay → bukti → relay teardown (sebelum server
    dimatikan) → cleanup (node, `--switch`, `--server`) → libvirt-after/diff → redaksi + scan.
    Network `pxe-test*` dibiarkan sampai teardown (M7-T12).
  - Paralel: `max_nodes = clamp((MemAvailable − 3072 (server, bila belum jalan) − 768 (switch, bila
    belum jalan) − 4096) / 2048, 1, 3)`; `vlanneg` selalu satu node pada satu waktu.
  - Env Playwright tambahan: `PXE_KVM_TOPOLOGY=vlan`, `PXE_KVM_VLAN=20`, `PXE_KVM_GATEWAY=10.99.20.1`,
    `PXE_KVM_DNS=10.99.10.2`, `PXE_KVM_PREFIX=24`, `PXE_KVM_INFRA_KEY`, `PXE_KVM_RELAY_CMD`.
    `PXE_KVM_BASE_URL` tetap `http://10.99.0.2`.
  - Entri `cleanup` di `results.json` (semua tahap, termasuk run parsial) ditambah `switchStopped`,
    `relayClean`.
- **`kvm-harness.ts`**: `kvmNodes()` menerima `10.99.20.*` hanya bila `PXE_KVM_TOPOLOGY=vlan`;
  `ssh()`/`passwordLoginRejected()` tetap menolak selain `10.99.0.*`; helper baru `relay(mode, node,
  …)` (memanggil `ssh -i <PXE_KVM_INFRA_KEY> root@10.99.0.2 … bash -s < infra/vlan/relay.sh`, key
  wajib di `.agent/keys/`).
- **Dokumentasi**: `infra/README.md` §Topologi VLAN (diagram §2.1, tabel VLAN, alur §2.4, syarat
  production O5, cara menjalankan skenario, cleanup/teardown); `.env.example` `PXE_VLAN_NETWORKS=`
  (kosong) + contoh berkomentar.

### 2.7 Uji negatif isolasi (`vlanneg`) [O9]

Per node, berurutan (satu VM node hidup): `capture-start` (server `pxe0` untuk N1, `trunk0` untuk
N2/N3; switch `sw-p2` bila `tcpdump` tersedia, selain itu snapshot `ip -s link show sw-p2`) → `node.sh
create` di jaringan sesuai `neg` → tunggu 240 dtk → `capture-stop` → kumpulkan: log dnsmasq (grep MAC),
log nginx (`GET /boot/<mac>.ipxe`), `GET /api/hosts` (sesi admin, dari host ke `10.99.0.2`), serial
node, `virsh domifstat` node (baca saja, TX > 0) → `node.sh destroy`.

| ID | Kasus | Port | Ekspektasi |
|---|---|---|---|
| N1 | Node di segmen admin untagged | `pxe-test` | `pxe0` pcap: ≥ 1 DISCOVER dari MAC, 0 reply BOOTP; dnsmasq tanpa entri MAC |
| N2 | Port tanpa VLAN PXE (access VLAN 20) | `pxe-test-port2` profil `access20` | `trunk0` pcap: DISCOVER dari MAC ber-tag `vlan 20`, 0 reply; dnsmasq tanpa OFFER/ACK |
| N3 | VLAN ber-tag tidak cocok (port hanya VLAN 10 ber-tag, tanpa native) | `pxe-test-port2` profil `tagged10` | `trunk0` pcap: 0 frame dari MAC; sisi port: frame/RX dari node > 0 (node memang mengirim) |

Ketiganya juga: tanpa `GET /boot/<mac>.ipxe` di nginx, MAC tidak ada di `/api/hosts`, tidak ada lease
untuk MAC. Setelah N3 profil `sw-p2` dikembalikan ke `access20`. Kontrol positif (bukti capture
bekerja) ada di `vlancore`: `trunk0` memperlihatkan DISCOVER node31 ber-tag `vlan 10` dan OFFER/ACK
server ber-tag `vlan 10`.

## 3. Task

| ID | Owner | Deskripsi | Dependensi | File |
|---|---|---|---|---|
| M7-T1 | backend-dev | Settings `PXE_VLAN_NETWORKS` (§2.5a), validasi IP statis per VLAN (§2.5b) di `lib/net.ts` + `config-service.ts`, `vlanNetworks` di `GET /api/settings` & `GET /api/network`, `.env.example`. | — | `src/lib/net.ts`, `src/lib/server/{settings,net-config,config-service}.ts`, `src/app/api/{settings,network}/route.ts`, `dashboard/.env.example` |
| M7-T2 | backend-dev | Generator §2.5d: Rocky parent tanpa IPv4 di target; docstring Ubuntu; Debian kondisional (setelah T10, O10); golden file. | — (Debian: T10) | `src/lib/server/installers/{rocky,ubuntu,debian}.ts`, golden/fixture generator |
| M7-T3 | backend-dev | Network & switch §2.1–2.2: XML 3 network, `net-up/net-down --topology vlan`, `lib.sh`, `switch-base.sh`, `switch-up.sh`, `switch-down.sh`, `infra/switch/pxe-switch.sh` + unit oneshot, `cleanup.sh --switch`. | — | `infra/net/pxe-test-{trunk,port1,port2}.xml`, `infra/{lib,net-up,net-down,switch-base,switch-up,switch-down,cleanup}.sh`, `infra/switch/**` |
| M7-T4 | backend-dev | Profil VLAN server §2.3: `server-up.sh --topology vlan` (NIC trunk), `infra/server/vlan/{netplan-vlan.yaml,dnsmasq-vlan.conf,nginx-pxe-vlan.conf,exports-vlan,nfs-vlan.conf,apply-profile.sh,verify-listen-vlan.sh}`, `dashboard-vlan.env`, `deploy-dashboard.sh --topology vlan`. | T1 (env baru) | `infra/server-up.sh`, `infra/deploy-dashboard.sh`, `infra/server/vlan/**`, `infra/server/dashboard-vlan.env` |
| M7-T5 | backend-dev | Harness §2.6–2.7: `infra/vlan/relay.sh`, `node.sh --net`, `kvm-run.sh` skenario VLAN + alur `vlanneg` + capture + entri cleanup, `verify-node.sh` mode `EXPECT_VLAN`, `kvm-harness.ts` (`relay()`, regex topologi), `infra/README.md` §Topologi VLAN. | T3, T4 | `infra/{node,kvm-run}.sh`, `infra/vlan/**`, `dashboard/e2e-kvm/{verify-node.sh,kvm-harness.ts}`, `infra/README.md` |
| M7-T6 | frontend-dev | UI §2.5c: tab Network VLAN-aware (petunjuk, isi otomatis, validasi, pratinjau bulk, deskripsi), Settings blok "VLAN management", tipe `use-settings`. Audit mandiri 375/768/1280/1440. | T1 (kontrak API) | `src/components/host-config/{tab-network.tsx,form-state.ts}`, `src/components/settings/settings-view.tsx`, `src/hooks/use-settings.ts` |
| M7-T7 | test-engineer | Unit + integration: parser `PXE_VLAN_NETWORKS`, validasi VLAN (+ regresi DEC-006 tanpa perubahan), API settings/network/config/bulk, callback dari IP VLAN, `isLocalMedia` dengan env VLAN, `dashboard-vlan.env` di-parse `settingsFromEnv`, generator (Ubuntu/Debian/Rocky VLAN golden). | T1, T2, T4 | `src/**/*.test.ts` |
| M7-T8 | test-engineer | E2E Playwright (mock, webServer dengan `PXE_VLAN_NETWORKS`): form single/bulk VLAN, Settings blok VLAN, axe, lebar layar; regresi M1–M6 (tanpa pelemahan, `test-migration.md` bila ada perubahan). | T6 | `dashboard/e2e/**`, `dashboard/playwright.config.ts` (server tambahan) |
| M7-T9 | test-engineer | Test shell infra (`INFRA_DRY_RUN`, `ip`/`bridge`/`ss`/`ssh`/`virsh` palsu): XML network, switch script, profil server, verify-listen-vlan, relay, verify-node VLAN, kvm-run skenario/spec/paralel/cleanup, asersi statis "host tidak menyasar 10.99.10/20". | T3, T4, T5 | `infra/test/m7*.sh`, `infra/test/fake-bin/*` (tambahan `bridge`, `ip`, `tcpdump` palsu) |
| M7-T10 | test-engineer | **Smoke KVM dini** (setelah T1–T5, sebelum UI): `vlansmoke` lewat API (sesi admin) — node41 UEFI Ubuntu, node42 UEFI Rocky, node43 UEFI Debian di port1 → Done + verifikasi relay + `ping -M do -s 1472` VLAN 20. Tujuan: membuktikan O5 (Ubuntu pindah VLAN di tengah instalasi), O6 (Rocky parent), O10 (Debian ifupdown), MTU frame ber-tag. Bukti `.agent/runs/m7/kvm/smoke/`. Bila gagal → laporan ke Orchestrator untuk decision (bukan perbaikan diam-diam). | T1, T2, T3, T4, T5 | `.agent/runs/m7/kvm/smoke/**` |
| M7-T11 | test-engineer | Suite KVM `dashboard/e2e-kvm/m7-{vlan,vlanneg}.spec.ts` (login UI, Sheet VLAN, relay) + jalankan `vlanneg`, `vlancore`, `vlandistro`; `results.json`; scan bukti. | T5, T6, T8, T10 | `dashboard/e2e-kvm/**`, `.agent/runs/m7/kvm/**` |
| M7-T12 | test-engineer (infra) | **Setelah APR M7**: `net-down.sh --topology vlan` (lima network), `cleanup.sh --server --switch --base`, hapus `.agent/keys/*`; snapshot libvirt sebelum/sesudah → `.agent/runs/m7/teardown.txt`. | APR M7 | `.agent/runs/m7/teardown.txt` |

Urutan: (T1 ∥ T2 ∥ T3) → T4 → T5 → T10 (smoke; keputusan O5/O6/O10 bila perlu) → T6 → (T7 ∥ T9) →
T8 → T11 → review/gate → APR → **T12 terakhir**.

Aturan kerja (dari M5/M6): setiap perbaikan disertai test yang merah bila di-revert (mutasi dicatat di
`.agent/runs/m7/mutation-iter<k>.txt`); perubahan jalur boot/installer/infra setelah run KVM resmi →
run konfirmasi atau `kvm-path-diff.txt` kosong; fakta terbukti dipertahankan (iPXE UEFI `exit 1`,
`chain --replace --autofree`, `--install no_install=yes`, token tidak masuk config installer).

## 4. Acceptance criteria

### Produk: Settings & validasi
- **AC-7.1** (unit) `PXE_VLAN_NETWORKS`: `20:10.99.20.0/24:10.99.20.1` → `[{vlan:20, cidr:"10.99.20.0/24",
  prefix:24, gateway:"10.99.20.1"}]`; `20:10.99.20.7/24:10.99.20.1` → CIDR dinormalisasi; kosong →
  `[]`; masing-masing ditolak dengan pesan yang menyebut `PXE_VLAN_NETWORKS`: VLAN 0/4095/teks, VLAN
  ganda, prefix /7 dan /31, gateway = alamat network/broadcast atau di luar CIDR, CIDR tumpang
  tindih `PXE_MGMT_CIDR`, dua entri tumpang tindih, 17 entri, pemisah salah. `SETTINGS_ENV_KEYS`
  memuat variabel itu (ganti env → `getSettings()` berubah).
- **AC-7.2** (integration) `GET /api/settings` dan `GET /api/network` (dengan sesi) memuat
  `vlanNetworks` sesuai env (dan `[]` tanpa env); field lain identik dengan M6 (snapshot); tanpa sesi
  → 401 (regresi AC-6.7).
- **AC-7.3** (unit) [O4] Validasi VLAN terdaftar (VLAN 20): `10.99.20.41/24` gw `10.99.20.1` → valid;
  `10.99.21.5` → "Di luar subnet 10.99.20.0/24 (VLAN 20)"; `.0`/`.255` → network/broadcast; IP =
  gateway VLAN → ditolak; prefix 16 → pesan prefix VLAN; gateway `10.99.10.1` → pesan gateway VLAN;
  IP dipakai `mgmt_ip` host lain → "Bentrok dengan …"; `10.99.20.150` (setara range DHCP PXE) → valid
  (tanpa aturan range). `planIps` VLAN 20 range `.41–.44` untuk 3 host dengan `.42` terpakai dan
  `skipUsed` → `.41, .43, .44`. `vlan = null` dan VLAN 99 (tidak terdaftar) → hasil & pesan identik
  DEC-006; seluruh test `net*.test.ts` lama lulus tanpa perubahan.
- **AC-7.4** (integration) `PATCH /api/hosts/:id/config` dan `POST` bulk config (sesi + guard mutasi):
  VLAN 20 + `10.99.20.41` → 200, tersimpan `vlan: 20`, `mgmt_ip` `10.99.20.41`; IP di luar subnet
  VLAN, prefix salah, gateway di luar, IP bentrok `mgmt_ip` host lain, VLAN 99 + `10.99.20.50` → 422
  `section: network` dengan pesan §2.5b dan snapshot DB tidak berubah; bulk 3 host VLAN 20 → IP
  sesuai pratinjau server; dua request paralel dengan IP VLAN sama → tepat satu sukses.
- **AC-7.5** (integration) Regresi binding IP (F6) dengan host ber-VLAN: `POST …/status`
  `configuring`/`done` dan `POST …/log` dari IP statis VLAN `10.99.20.41` → 200; `done` menyetel
  `current_ip = 10.99.20.41`; dari IP lain (`10.99.20.99`, `10.99.0.1`) → 404 seragam; `GET
  …/user-data` dari `10.99.20.41` (bukan lease/`current_ip`) → 404; dari IP lease → 200.
- **AC-7.6** (unit) DEC-021/022 dengan env VLAN: `infra/server/dashboard-vlan.env` di-parse
  `settingsFromEnv` tanpa error (`NODE_ENV=production`, hash admin uji); `isLocalMedia(mediaUrl,
  pxeServer)` true; install Debian diizinkan; varian `PXE_MEDIA_URL=http://10.99.0.2/media` dengan
  `PXE_SERVER_IP=10.99.10.2` → `debianExternalMediaError` (fail-closed); `PXE_SERVER_IP=10.99.20.1`
  dengan `PXE_MGMT_CIDR=10.99.10.0/24` → start ditolak (DEC-006 tetap).

### Produk: generator
- **AC-7.7** (unit, golden) Ubuntu VLAN 20 (iface MAC dan nama): `network.ethernets.mgmt` = `{match,
  dhcp4:false, dhcp6:false}` tanpa `addresses`; `network.vlans["mgmt.20"]` = `{id:20, link:"mgmt",
  addresses:["10.99.20.41/24"], routes:[{to:"default", via:"10.99.20.1"}], nameservers}`; tanpa VLAN
  → golden M6 identik; user-data bebas token (regresi).
- **AC-7.8** (unit) Debian VLAN 20: isi `interfaces.d/mgmt` hasil decode = `auto $IF` / `iface $IF
  inet manual` + `auto $IF.20` / `iface $IF.20 inet static` + address/netmask/gateway/dns; lookup
  `$IF` dari MAC; panjang `late_command` < batas; [O10] bila paket `vlan` ditambahkan: `pkgsel/include`
  memuat `vlan` hanya untuk `vlan ≠ null` (golden non-VLAN identik).
- **AC-7.9** (unit) Rocky VLAN 20: baris `network --device=<mac> --bootproto=static --ip=10.99.20.41
  … --vlanid=20 --activate --onboot=yes`; `%post` memuat langkah §2.5d yang (dijalankan di fixture
  direktori NetworkManager palsu, `sh`) menghasilkan profil parent ber-MAC host dengan
  `method=disabled` untuk IPv4, menghapus profil DHCP parent lain, dan tidak menyentuh profil VLAN;
  tanpa VLAN → golden M6 identik; kickstart bebas token.

### Produk: UI
- **AC-7.10** (e2e, server mock `PXE_VLAN_NETWORKS=20:10.99.20.0/24:10.99.20.1`) Sheet satu host, tab
  Network: petunjuk "20 · 10.99.20.0/24" (font JetBrains Mono); ketik VLAN `20` → prefix 24 & gateway
  `10.99.20.1` terisi, deskripsi IP "Di dalam 10.99.20.0/24 (VLAN 20)"; IP `10.99.10.41` → error
  field "Di luar subnet 10.99.20.0/24 (VLAN 20)", tombol simpan nonaktif; IP `10.99.20.41` → valid,
  simpan → payload `vlan: 20` dan status 200; gateway yang diubah manual tidak ditimpa saat VLAN
  diganti; VLAN dikosongkan → aturan subnet PXE kembali.
- **AC-7.11** (e2e) Bulk 3 host, VLAN 20, range mulai `10.99.20.41`: pratinjau MAC → IP
  `.41/.42/.43` (dengan satu IP terpakai → dilewati), hasil tersimpan (via API) identik dengan
  pratinjau.
- **AC-7.12** (e2e) `/settings`: blok "VLAN management" menampilkan VLAN · Subnet · Gateway (mono),
  card hairline tanpa shadow, tanpa elemen oranye baru; server tanpa env → empty state; di 375 dan
  1440 `scrollWidth` = viewport; axe 0 pelanggaran selain pengecualian kontras terdaftar (DEC-019).
- **AC-7.13** (e2e regresi) Seluruh spec M1–M6 lulus; grep `skip|only|fixme` = 0; jumlah asersi per
  file lama tidak turun (skrip hitung terlampir); perubahan test lama hanya lewat `test-migration.md`.

### Infra (unit-shell / static-shell)
- **AC-7.14** (static-shell) `infra/net/pxe-test-{trunk,port1,port2}.xml` tanpa `<forward>`, `<dhcp>`,
  `<ip>`; nama `^pxe-test-`; bridge ≤ 15 karakter dan berbeda dari `virbr-pxe`/`virbr-pxenat`;
  `net-up.sh --topology vlan` (dry-run) mendefinisikan + menyalakan kelimanya, idempoten, dan menolak
  XML uji yang memuat `<ip>`/`<forward>`/`<dhcp>`; `net-down.sh --topology vlan` merencanakan hapus
  kelimanya; nama terlindungi ditolak.
- **AC-7.15** (unit-shell) Switch: `switch-up.sh` dry-run → overlay & seed di `.agent/vms/`, 4 NIC
  dengan MAC `52:54:00:99:02:0{1..4}` di network yang benar, RAM ≤ 1024, tanpa NIC `pxe-test-nat`;
  `pxe-switch.sh apply` dengan `ip`/`bridge` palsu menghasilkan tepat himpunan perintah tabel §2.2
  (termasuk `vlan_filtering 1`, `vlan_default_pvid 0`, tanpa alamat di `br0`); `apply-port sw-p2
  tagged10` dan `access20` sesuai tabel; profil lain → exit ≠ 0.
- **AC-7.16** (static-shell + unit-shell) Profil server: `dnsmasq-vlan.conf` memuat `interface=pxe10`,
  `bind-interfaces`, `except-interface` untuk `lo,nat0,pxe0,mgmt20`, satu `dhcp-range` (pxe10,
  `.100–.200`), `dhcp-option=3`, tanpa `option:router` bernilai, URL boot `10.99.10.2`; nginx VLAN
  listen tepat `10.99.0.2:80` dan `10.99.10.2:80`, allowlist admin di `location /` dan SSE, `/boot/` &
  `/media/` tanpa allow/deny, `nginx -t` di apply; ekspor hanya `10.99.10.0/24` & `10.99.20.0/24`
  `ro`; nfsd/rpcbind `10.99.10.2`; `ip_forward=0`. `verify-listen-vlan.sh` dengan keluaran `ss`
  palsu: konfigurasi baik → PASS; dnsmasq di `%pxe0`, `0.0.0.0:67` tanpa device, `10.99.20.1:53`,
  atau nfsd di `10.99.0.2` → FAIL + `systemctl stop dnsmasq` dipanggil + exit 1.
- **AC-7.17** (unit-shell + static) Relay & batas host: `relay.sh` menolak `NODE_IP` di luar
  `10.99.20.0/24` dan `MODE` tak dikenal (exit 2, tanpa ssh); tidak mencetak isi key; `kvm-run.sh`
  dry-run skenario VLAN hanya memuat ssh/scp/curl ke `10.99.0.2`/`10.99.0.3`; test statis atas
  `infra/*.sh`, `infra/server/*.sh` (bagian host), `dashboard/e2e-kvm/*.ts` tidak menemukan
  ssh/scp/curl/`page.goto` ke `10.99.10.*`/`10.99.20.*` di luar `infra/vlan/relay.sh` dan file yang
  dijalankan di dalam VM; relay key disalin mode 0600 dan `MODE=teardown` dipanggil di `finish` untuk
  run yang digagalkan di setiap tahap setelah relay setup.
- **AC-7.18** (unit-shell) `verify-node.sh` dengan `ip` palsu: mode `EXPECT_VLAN=20` — anak VLAN id 20
  di parent ber-MAC memuat IP → OK; IP di parent, parent punya IPv4 tambahan, VLAN id salah (30),
  atau anak di parent lain → FAIL (exit ≠ 0); tanpa `EXPECT_VLAN` → keluaran M6 identik (regresi test
  infra M6 lulus).
- **AC-7.19** (unit-shell) `kvm-run.sh`: skenario `vlanneg|vlancore|vlandistro|vlansmoke` → run id &
  node default §2.6; spec `:neg=` hanya di `vlanneg`; IP node `10.99.20.(10+NN)`; jaringan node sesuai
  `neg`; `max_nodes` mengurangi RAM server dan switch bila keduanya belum jalan (MemAvailable palsu
  10240 → 1, 12288 → 2, 16384 → 3); `cleanup.sh switchx` ditolak, `cleanup.sh --switch` merencanakan
  destroy/undefine `pxe-test-switch` + hapus disk di `.agent/vms/`; skenario flat M6
  (`core|distro|bulk`) tidak berubah (regresi `infra/test/m6.sh` lulus); entri `cleanup` selalu ada di
  `results.json` untuk kegagalan di setiap tahap (termasuk `switch-up`, `relay-setup`).

### KVM (syarat gate: bukti KVM milestone ≥ 4; semua AC kvm wajib untuk M7 — DEC-023 §5)
- **AC-7.20** (kvm, `vlancore`) Topologi & perimeter: `switch-check.txt` = tabel §2.2 (`vlan_filtering
  1`, PVID/untagged benar); `server-listen-vlan.txt` PASS (§2.3 langkah 3); `ip -d link` server:
  `pxe10` id 10, `mgmt20` id 20 di `trunk0`; dari host: `GET http://10.99.0.2/login` 200,
  `/api/settings` tanpa sesi 401, dengan sesi `cidr 10.99.10.0/24` + `vlanNetworks` VLAN 20,
  `HEAD /media/ubuntu-24.04/casper/vmlinuz` 200; `ip route get 10.99.10.2` di host dicatat (baca saja)
  dan `kvm-run.txt` tidak memuat koneksi host ke `10.99.10.*`/`10.99.20.*`.
- **AC-7.21** (kvm, wajib gate) UEFI Ubuntu 24.04 `pxe-test-m7vlancore-node31` (port1, IP
  `10.99.20.41`) **alur E2E penuh via dashboard dengan login**: VM PXE boot di VLAN 10 native (lease
  `10.99.10.x` di log dnsmasq `pxe10`; pcap `trunk0` memuat DISCOVER MAC node ber-tag `vlan 10` dan
  OFFER/ACK server ber-tag `vlan 10`) → host muncul tanpa reload → Sheet: hostname `m7-node31`,
  Static VLAN `20`, IP `10.99.20.41/24`, gateway `10.99.20.1`, DNS `10.99.10.2`, credentials (password
  generator, sudoer, nonaktifkan login password SSH), key ed25519 sekali pakai → "Simpan & Install" →
  Booting → Installing → Configuring → Done ≤ 30 mnt tanpa reload; log nginx: file konfigurasi dari IP
  lease `10.99.10.x`, callback `done` dari `10.99.20.41`. Verifikasi lewat relay: hostname; anak VLAN
  id 20 di parent ber-MAC `…:31` memuat `10.99.20.41/24`; parent tanpa IPv4; default via `10.99.20.1`;
  DNS `10.99.10.2`; user + `sudo -n true`; `authorized_keys` tepat key itu; `sshd -T`
  `passwordauthentication no`; login password ditolak; target bebas token; root dari disk; `reboot`
  → serial tanpa kernel installer baru, iPXE menyajikan boot lokal, status tetap Done, jumlah job 1,
  SSH relay kembali sukses.
- **AC-7.22** (kvm, wajib gate) BIOS Ubuntu 24.04 `pxe-test-m7vlancore-node32` (`10.99.20.42`):
  paritas AC-7.21 (termasuk pcap native→tag dan reboot tanpa reinstall).
- **AC-7.23** (kvm, `vlancore`) Validasi VLAN di server nyata (sesi admin): UI — IP node32 =
  `10.99.20.41` (milik node31) VLAN 20 → error field, tidak tersimpan; API `PATCH` sama → 422;
  `10.99.30.5` VLAN 20 → 422 "Di luar subnet 10.99.20.0/24 (VLAN 20)"; VLAN 99 + `10.99.20.50` → 422;
  konfigurasi kedua host identik sebelum/sesudah (dibandingkan via API).
- **AC-7.24** (kvm, `vlandistro`) UEFI Debian 12 preseed `pxe-test-m7vlandistro-node33`
  (`10.99.20.43`): alur penuh via dashboard → Done ≤ 30 mnt; event `early_command`, `late_command`,
  first-boot berurutan; install tidak ditolak media eksternal (DEC-021 dengan `PXE_SERVER_IP` VLAN);
  verifikasi relay paritas AC-7.21 (anak VLAN `$IF.20` naik setelah reboot); reboot tanpa reinstall.
- **AC-7.25** (kvm, `vlandistro`) UEFI Rocky 9 kickstart `pxe-test-m7vlandistro-node34`
  (`10.99.20.44`): paritas AC-7.24 untuk `%pre`/`%post`/first-boot; parent tanpa IPv4 dan tidak ada
  lease baru dari MAC node34 di log dnsmasq setelah Done (selain boot PXE ulang); firewalld mengizinkan
  ssh di anak VLAN.
- **AC-7.26** (kvm, `vlanneg`) N1 segmen admin: `pxe-test-m7vlanneg-node36` (UEFI, `pxe-test`) dalam
  240 dtk — pcap `pxe0` ≥ 1 DISCOVER dari MAC dan 0 reply BOOTP; log dnsmasq tanpa entri MAC; nginx
  tanpa `GET /boot/<mac>.ipxe`; MAC tidak ada di `/api/hosts`; `domifstat` TX > 0.
- **AC-7.27** (kvm, `vlanneg`) N2 port tanpa VLAN PXE: `…-node37` (BIOS, port2 `access20`) — pcap
  `trunk0` memuat DISCOVER dari MAC ber-tag `vlan 20` dan 0 reply; sisa pemeriksaan sama dengan
  AC-7.26.
- **AC-7.28** (kvm, `vlanneg`) N3 tag tidak cocok: `…-node38` (UEFI, port2 `tagged10`) — pcap
  `trunk0` 0 frame dari MAC; sisi port menunjukkan frame dari node (pcap `sw-p2` atau RX counter
  naik); tidak ada DHCP/iPXE/host; profil `sw-p2` kembali `access20` (dicatat `switch-check`).
- **AC-7.29** (kvm, `vlancore`) Isolasi lapis 3: server `ip_forward=0`; dari node31 lewat relay `probe`:
  `ping 10.99.0.1` gagal, `curl http://10.99.10.2/api/hosts` → 403, `curl http://10.99.0.2/api/hosts`
  → 403; dari host `GET http://10.99.0.2/api/hosts` dengan sesi → 200 (tidak terdampak).
- **AC-7.30** (kvm, semua run M7 termasuk smoke) Bukti & cleanup: `results.json` memuat status +
  durasi setiap AC kvm + entri `cleanup` (`switchStopped`, `relayClean`, `protectedIdentical`); setelah
  run tidak ada domain `pxe-test-m7*` maupun disknya, `pxe-test-switch` mati/terhapus (kecuali
  `--keep-server`), `relay-clean: absent` tercatat sebelum server dimatikan; `pxe-test-node01`,
  `ubuntu24.04`, `default`, `int` identik di `libvirt-before/after`; seluruh `.agent/runs/m7/**` lolos
  scan: tanpa password run/admin, `scrypt$`, token, `$6$`, private key (teks & base64); pcap mentah
  tidak ada di bukti (hanya ringkasan teks DHCP).

### Dokumentasi & penutupan
- **AC-7.31** (static) `infra/README.md` §Topologi VLAN memuat diagram/tabel §2.1, alur §2.4, syarat
  production O5 (VLAN management → `PXE_SERVER_IP` untuk HTTP dan NFS Ubuntu), cara menjalankan tiap
  skenario, cleanup/teardown; `.env.example` memuat `PXE_VLAN_NETWORKS` (kosong + contoh berkomentar);
  `git grep` tidak menemukan hash/secret nyata baru.
- **AC-7.32** (infra, setelah APR M7) Teardown: `virsh net-list --all` tanpa `pxe-test`,
  `pxe-test-nat`, `pxe-test-trunk`, `pxe-test-port1`, `pxe-test-port2`; tidak ada domain `pxe-test-*`
  selain `pxe-test-node01`; `default`, `int`, `ubuntu24.04`, `pxe-test-node01` identik
  sebelum/sesudah; `.agent/vms/pxe-test-server*`, `.agent/vms/pxe-test-switch*`, `.agent/keys/*`
  hilang; media dipertahankan; bukti `.agent/runs/m7/teardown.txt`.

Total: **32 AC**. Per jenis (AC gabungan dihitung di setiap jenisnya): unit 6 · integration 3 ·
e2e 4 · unit-shell/static-shell 6 · static 2 · kvm 11 (AC-7.21 dan AC-7.22 wajib gate, seluruh AC kvm
wajib untuk cakupan DEC-023 §5) · infra 1 (AC-7.32, setelah approval; tidak dinilai gate M7 tetapi
wajib sebelum `REPORT-m7.md` final).

Gate M7 **identik CLAUDE.md**: typecheck & lint bersih; semua unit/integration/E2E lulus dengan
coverage kode baru ≥ 80% (`lib/net.ts`, `settings.ts`, `config-service.ts`, generator, `form-state.ts`,
komponen baru); setiap AC punya ≥ 1 test; tidak ada temuan critical/major terbuka; bukti KVM (PXE boot
→ konfigurasi diterima → Done → login SSH dengan key yang di-inject) — di M7 lewat VLAN; tanpa
secret/password plaintext di repo/log; men-skip/melemahkan test = critical; maks 3 iterasi.

## 5. Matriks & cakupan KVM M7

Batas resource: `max_nodes = clamp((MemAvailable − 3072 server − 768 switch − 4096)/2048, 1, 3)`
(RAM VM yang sudah berjalan tidak dikurangi dua kali). Preflight per run → `kvm-run-preflight.txt`
(+ `ip route get 10.99.10.2`, `/proc/sys/net/bridge/*` bila ada — baca saja). Timeout 30 mnt/VM. Base
server di-provision ulang sekali di awal (F13, ±20 mnt).

| Run | Skenario (urutan) | Node (fw, OS, port) | AC | Paralel | Estimasi |
|---|---|---|---|---|---|
| smoke (T10) | Lewat API: Ubuntu, Rocky, Debian VLAN 20 → Done + relay verify + MTU | 41 UEFI Ubuntu, 42 UEFI Rocky, 43 UEFI Debian (port1) | 7.30 (+ bukti O5/O6/O10) | ≤ `max_nodes` | ±60 mnt |
| `vlanneg` | N1 admin → N2 access20 → N3 tagged10 (satu node pada satu waktu) | 36 UEFI (`pxe-test`), 37 BIOS (port2), 38 UEFI (port2) | 7.26–7.28, 7.30 | 1 | ±25 mnt |
| `vlancore` | Perimeter; node31 alur penuh + reboot; node32 alur penuh + reboot; validasi VLAN UI/API; isolasi L3 | 31 UEFI Ubuntu, 32 BIOS Ubuntu (port1) | 7.20–7.23, 7.29, 7.30 | 2 bila `max_nodes ≥ 2`, selain itu berurutan | ±60 / ±100 mnt |
| `vlandistro` | Debian 12 preseed; Rocky 9 kickstart | 33 UEFI Debian, 34 UEFI Rocky (port1) | 7.24, 7.25, 7.30 | 2 bila mungkin | ±50 / ±80 mnt |

Matriks DEC-023 §5 → bukti: UEFI Ubuntu (node31), BIOS Ubuntu (node32), UEFI Debian 12 (node33),
UEFI Rocky 9 (node34); uji negatif isolasi N1–N3 + `ss -lunp` (AC-7.20). Bukti di
`.agent/runs/m7/kvm/{smoke,vlanneg,vlancore,vlandistro}/` + `.agent/runs/m7/kvm/results.json`. Media
hanya dari `.agent/media/` (tanpa unduhan baru); node tanpa NAT; switch tanpa NAT; `pxe-test-nat`
hanya server.

## 6. Risiko

| ID | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Ubuntu pindah ke VLAN 20 di tengah instalasi (F5): koneksi NFS root macet sampai TCP reconnect dari IP baru | Instalasi Ubuntu lambat/macet | Server = gateway VLAN 20 + ekspor mencakup `10.99.20.0/24` (O5-A); smoke dini T10; cadangan O5-B lewat decision |
| R2 | Anaconda menyalin profil boot `ip=dhcp` ke target → Rocky dual-homed | AC-7.25 gagal (`verify-node`), lease PXE dipakai OS terpasang | `%post` O6-A + unit test fixture + smoke |
| R3 | ifupdown Debian 12 tidak menaikkan `$IF.20` tanpa paket `vlan`/modul `8021q` | Node Debian tidak terjangkau setelah reboot, Done tidak tiba | Smoke; O10-B (`pkgsel/include vlan` dari DVD-1, dicek `server-check`) |
| R4 | Host tidak punya route ke `10.99.10/20`; alat host yang menyasar alamat itu mengirim paket ke LAN fisik (melanggar batas curl/ssh) | Pelanggaran batas keras | UI & semua skrip host hanya `10.99.0.2/.3`; relay di VM; AC-7.17 statis; hook tetap |
| R5 | Jendela dnsmasq flat di `pxe0` saat overlay server boot (O3-A) | DHCP sempat dilayani di segmen admin | Belum ada node/switch saat itu; profil + verifikasi sebelum switch/node; log dipotong; N1 sesudahnya; cadangan O3-B |
| R6 | Frame ber-tag (1518 byte) dibuang bridge host/virtio atau `br_netfilter` | Paket besar VLAN 20 hilang (NFS/HTTP macet) | Smoke `ping -M do -s 1472` lewat VLAN 20; catat sysctl bridge host; turunkan MTU sub-interface hanya lewat decision |
| R7 | `tcpdump` tidak ada di cloud image switch (switch tanpa NAT) | Bukti sisi port N3 lebih lemah | Counter `ip -s link`/`domifstat`; capture di server (`pxe0`, `trunk0`) tetap jadi bukti utama |
| R8 | RAM: server 3 GB + switch 0,75 GB + node 2 GB | Paralelisme turun ke 1 | Rumus §5; `vlanneg` satu node; run berurutan bila perlu (durasi dicatat) |
| R9 | Base server terhapus di M6-T16 (F13) | +±20 mnt; ketergantungan nodejs.org/mirror Ubuntu | Provision sekali di awal, dipakai ulang sampai T12; media lokal tetap |
| R10 | Key node berada di VM server (relay) | Key bocor ke bukti/VM | 0600 root, `MODE=teardown` di `finish` (juga run parsial), overlay server dihapus, scan bukti |
| R11 | Penamaan anak VLAN berbeda per distro (`mgmt.20`, `ens3.20`, `vlan20`) | Verifikasi salah positif/negatif | `verify-node.sh` memakai id VLAN + parent MAC, bukan nama |
| R12 | Perubahan semantik validasi IP mematahkan test lama / menggoda pelemahan test | Regresi, critical di gate | VLAN tak terdaftar & `null` = DEC-006 persis; test lama tidak diubah; `test-migration.md` bila ada; mutasi |
| R13 | Callback `done` bergantung rute VLAN management → server; production tanpa rute itu macet di Configuring | Job timeout di production | Didokumentasikan sebagai syarat (AC-7.31); kandidat decision |
| R14 | Node negatif UEFI berputar antara PXE dan disk kosong; teks serial berbeda per firmware | Asersi serial rapuh | Bukti utama pcap/log/API dalam jendela 240 dtk; serial hanya pelengkap |
| R15 | DNS dnsmasq di `10.99.10.2` juga menjawab query dari VLAN 20 (penerimaan lokal) | Bukan DHCP; tidak melanggar isolasi DHCP | Dicatat; AC hanya mengasersi DHCP/TFTP tidak dilayani di segmen lain |
| R16 | Teardown menghapus network & base lagi | Iterasi pasca-approval butuh bangun ulang | T12 hanya setelah APR M7; skrip idempoten |

## 7. Trace DEC-023 → task/AC

| Kewajiban DEC-023 | Task | AC |
|---|---|---|
| §2 switch VM `vlan_filtering`, trunk server ber-tag, port node trunk native PXE + mgmt ber-tag | T3, T4, T11 | 7.14, 7.15, 7.16, 7.20, 7.21 |
| §3 network `pxe-test-*` tanpa `<forward>`/`<dhcp>`/interface fisik; dnsmasq hanya di server, `bind-interfaces` di VLAN PXE, `ss -lunp` | T3, T4, T9, T11 | 7.14, 7.16, 7.20 |
| §4 SSH ke node lewat `pxe-test-server`, key sekali pakai disalin per run & dihapus, tanpa ProxyJump | T5, T9, T11 | 7.17, 7.21, 7.30 |
| §5 alur E2E dashboard (IP statis VLAN mgmt + field VLAN → Done → SSH → reboot) | T1, T6, T11 | 7.21, 7.22, 7.24, 7.25 |
| §5 matriks UEFI/BIOS Ubuntu, UEFI Debian, UEFI Rocky | T10, T11 | 7.21, 7.22, 7.24, 7.25 |
| §5 negatif: tanpa VLAN PXE → tanpa DHCP; dnsmasq tidak menjawab segmen untagged/admin | T5, T11 | 7.20, 7.26, 7.27, 7.28 |
| §6 perbaikan produk (validasi subnet, generator VLAN) dengan test | T1, T2, T6, T7, T8 | 7.1–7.13 |
| §7 teardown network & VM M7 | T12 | 7.32 |
| CLAUDE.md: uji negatif IP bentrok (UI+API) di konteks VLAN | T1, T6, T11 | 7.4, 7.10, 7.23 |
| CLAUDE.md: cleanup tiap run, resource terlindungi | T5, T11 | 7.19, 7.30 |

## 8. Kandidat decision (untuk Orchestrator)

1. **Topologi (O1–O3)**: trunk terpisah `pxe-test-trunk`; port `pxe-test-port1/2`; VLAN 10 PXE
   `10.99.10.0/24` (native di port node), VLAN 20 management `10.99.20.0/24` (ber-tag), admin
   `10.99.0.0/24` untagged tetap; switch VM tanpa NAT dengan script iproute2; profil VLAN server
   diterapkan saat runtime (cadangan base kedua).
2. **Validasi IP VLAN (O4)**: `PXE_VLAN_NETWORKS` + validasi per VLAN terdaftar, **memperluas
   DEC-006** (VLAN tak terdaftar / tanpa VLAN = DEC-006 persis).
3. **Jaringan installer (O5)**: server terjangkau dari VLAN management (gateway tanpa forwarding,
   ekspor NFS mencakup subnet management); syarat production didokumentasikan; cadangan O5-B hanya
   lewat decision setelah smoke.
4. **Native di OS terpasang (O6)**: tanpa IPv4 di ketiga distro; perbaikan Rocky `%post`.
5. **Relay SSH (O7)**: mode terbatas di VM server; key node per run dihapus di `finish`.
6. **Struktur run (O8)**: `vlanneg`/`vlancore`/`vlandistro` (+ `vlansmoke`); bulk VLAN tidak di KVM.
7. **Bukti negatif (O9)**: capture DHCP-only + log + counter; tanpa NAT untuk switch.
8. **Debian VLAN (O10)**: ditentukan oleh bukti smoke.
9. **Teardown**: T12 setelah APR M7 menghapus lima network, server, switch, base, key; media tetap.
