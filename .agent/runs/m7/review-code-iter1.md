# Code review M7 "PXE lewat VLAN" — iterasi 1

Verdict: PASS

- Reviewer: code-reviewer
- Branch `milestone/7-vlan`, HEAD `339f234`, worktree `.agent/wt-m7`
- Diff yang direview: `main...HEAD -- dashboard infra` (101 file)
- Sumber kebenaran: SPEC, M7-plan/options, DEC-023..027, CLAUDE.md

## Pemeriksaan yang dijalankan sendiri (read-only)

| Perintah | Hasil |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npx vitest run src/lib src/app src/components/host-config src/components/auth src/hooks` | 83 file, 2045 test lulus |
| grep `.skip/.only/.todo/fixme/xit/xdescribe` di diff dashboard | 0 |
| test lama yang berubah dibanding `main` | 11 file. Golden/inline Debian ditambah token, field fixture `pxeDns` ditambah, path axe/screenshot dipindah. Semuanya tercatat di `test-migration.md`; `assertion-counts.txt` vs `m6-approved`: 0 file turun |
| `git diff --stat d9d5308 HEAD -- dashboard/src infra` (syarat DEC-027 §4) | hanya form login, `/login/submit`, map log nginx, redact-evidence, dan test. Tidak ada perubahan generator/validasi, jadi syarat pemakaian ulang bukti vlanneg/vlancore terpenuhi |

Playwright, KVM, `next build`, dan port 3100–3199 tidak dijalankan (sesuai instruksi).

## Hal yang diverifikasi dan dinilai benar
- `vlanNetworksFromEnv` (net.ts) mencakup semua aturan DEC-024 §4 / AC-7.1: VLAN 1–4094 unik, prefix 8–30 dinormalisasi, gateway berupa host di CIDR, tidak overlap dengan mgmt maupun antarentri, maksimal 16 entri, entri kosong atau pemisah salah ditolak. Error dibungkus fail-fast oleh `settingsFromEnv`. `PXE_VLAN_NETWORKS` ada di `SETTINGS_ENV_KEYS`.
- `resolveStaticNetwork`: `vlan` null/undefined atau tidak terdaftar mengembalikan objek `MgmtNetwork` yang sama, sehingga jalur DEC-006 di `validateStaticIp`/`validateStaticNetwork` identik secara byte (test regresi VLAN 99 dan null ada).
- Server (`config-service.ts:373`): satu jaringan per payload untuk semua host bulk. Bentrok IP tetap global (`ipUsage` di semua host + lease), gateway payload ditandai terpakai, dan validasi berjalan di transaksi yang sama seperti M6. Test paralel "tepat satu sukses" dan "422 tanpa efek" ada.
- `/api/network` dan `/api/settings`: key `vlanNetworks` hanya ada bila ada entri (DEC-025 §3). Klien membaca `?? []`.
- Debian cmdline: `netcfg/no_default_route=true` dan `netcfg/get_nameservers=<dns[0]>` ada sebelum ` ---` sehingga tidak tersalin ke GRUB target. `pxeDns` divalidasi `isIpv4` lalu `ipxeSafe`, jadi aman untuk iPXE. `dns[0]` dijamin ada karena `PXE_MGMT_DNS` divalidasi 1–4 IPv4.
- Rocky `%post`: hanya untuk `static && vlan ≠ null`. Profil `type=vlan` tidak disentuh, profil parent yang dirujuk `parent=<uuid>` ditulis ulang di tempat, dan `pxe-native` dibuat bila tidak ada. Script berjalan dengan `sh` tanpa `-e` dan sudah diuji dengan fixture NM.
- UI: `vlanPatch` hanya mengganti prefix/gateway/range yang masih bernilai default jaringan sebelumnya. Validasi klien memakai `resolveStaticNetwork` yang sama dengan server.
- DEC-027: `method="post"`, `action=/login/submit?next=…`, dan tombol nonaktif sampai `useSyncExternalStore` hydrate. Route fallback tidak membaca body, mengembalikan 303 dengan `next` yang disanitasi (`safeNextPath`), dan GET menghasilkan 405. E2E memblokir bundel JS (keadaan sebelum hydration yang stabil) dan mengasersi tidak ada request/URL yang membawa kredensial. Mutation log masuk akal (M1/M2 merah).
- Map log nginx flat dan VLAN identik (diverifikasi dengan `diff`). Query hanya dipertahankan untuk `/boot/<mac>.ipxe`, sedangkan path ber-token dan path lain dimasker `?***`.
- Infra:
  - XML network tanpa `<ip>`/`<forward>`/`<dhcp>`, divalidasi sebelum virsh.
  - `node.sh --net` memakai allowlist.
  - `cleanup.sh` menolak run id `switch*|trunk*|port*` dan melewati domain/disk switch.
  - `apply-profile.sh` menghentikan dnsmasq dulu dan memakai regex `STAGE`.
  - `verify-listen-vlan.sh` mewajibkan `udp *%pxe10:67` (DEC-026 §3) dan menjalankan `systemctl stop dnsmasq` bila FAIL.
  - Relay hanya menerima `NODE_IP` 10.99.20.x dan `NODE_USER` yang ter-regex. Key ditulis lewat STDIN dengan umask 077 + chmod 600 dan tidak pernah dicetak. `teardown` dijalankan sebelum server dimatikan.
  - Harness KVM menolak relay ke selain 10.99.20.* dan key di luar `.agent/keys`.

## Temuan

| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-7-1 | minor | infra/server/nginx-pxe.conf:11-17; infra/server/vlan/nginx-pxe-vlan.conf:14-20 (tanpa direktif `error_log`) | Map DEC-027 §2 hanya berlaku untuk access log. Error log default nginx tetap mencatat `request: "GET /login?username=…&password=… HTTP/1.1"` untuk event yang menulis ke error log, misalnya `access forbidden by rule` (klien non-admin, `deny all` di `location /`) atau `connect() failed` saat upstream mati. Skenario: GET berkredensial dari klien lama/bookmark ke dashboard yang sedang restart, sehingga password masuk `/var/log/nginx/error.log` di server. Bukti KVM tetap fail-closed karena `redact-evidence.sh` memindai `server-nginx-error.txt`, dan perbaikan produk (§1) mencegah form menghasilkan URL seperti itu. Jadi ini celah defense-in-depth, bukan kebocoran aktif. | Set `error_log /var/log/nginx/pxe-error.log crit;` (atau level yang tidak mencatat forbidden/upstream) di server block, atau catat batasan ini di README/REPORT-m7. |
| CR-7-2 | minor | infra/redact-evidence.sh:41,108-109; dashboard/e2e-kvm/m7-shared.ts:119 | Pengecualian placeholder (`<REDACTED`, `***`, `…`, backtick) berlaku untuk nilai yang *diawali* karakter itu, sehingga password yang kebetulan diawali `*`/backtick lolos scan. Varian `password%3D…` dan JSON-escaped `&password=` (misalnya trace/log JSON Playwright) juga tidak terdeteksi. | Kecualikan hanya token placeholder yang utuh (mis. `=(<REDACTED[^&]*>\|\*\*\*)(&\|$\|[[:space:]"])`), dan tambahkan pola `\\u0026(password\|username)=` serta `(password\|username)%3D`. |
| CR-7-3 | minor | dashboard/src/components/auth/login-form.tsx:34-63 | `useHydrated`, `LOGIN_NATIVE_ACTION`, dan `loginNativeAction` disisipkan di antara JSDoc `loginErrorText` (baris 34-37) dan fungsinya. Akibatnya doc "Pesan error login…" menempel ke `noopSubscribe`, dan `loginErrorText` kehilangan dokumentasi. | Pindahkan blok baru ke atas JSDoc tersebut. |
| CR-7-4 | minor | dashboard/src/components/host-config/plan-table.tsx:36-37 | Region scroll (`role=region aria-label="Preview X"`) dan `<table aria-label="Preview X">` memakai label yang sama, sehingga pembaca layar mengumumkan nama yang sama dua kali. Lolos axe, tapi berlebihan. | Beri label berbeda pada region (mis. "Area gulir preview X") atau hapus `aria-label` tabel dan pakai `aria-labelledby` ke judul. |
| CR-7-5 | info | infra/vlan/relay.sh:71-74,125,138 | `teardown`/`capture-*` melakukan `kill $(cat pidfile)` tanpa memastikan PID masih milik tcpdump. Bila tcpdump sudah mati dan PID dipakai ulang, proses root lain di VM uji bisa terbunuh. Dampaknya kecil karena hanya di VM `pxe-test-server`. | Pakai `pkill -F pidfile -x tcpdump`, atau cek `/proc/<pid>/comm` sebelum `kill`. |
| CR-7-6 | info | dashboard/src/components/auth/login-form.tsx:193-199 | Bila JS mati total, tombol Masuk nonaktif permanen, sehingga login tanpa JS tidak mungkin dan route `/login/submit` hanya terjangkau lewat manipulasi DOM. Ini sesuai DEC-027 §1 (minimal), dicatat agar tidak dianggap regresi. | Tidak perlu tindakan. Opsional: `<noscript>` berisi pesan "aktifkan JavaScript". |

## Ringkasan severity

| Severity | Jumlah |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 4 |
| info | 2 |

Catatan: laporan ini bukan approval; keputusan ada di gatekeeper.
