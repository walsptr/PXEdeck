# Review kode M4 — iterasi 1 (code-reviewer)

- Branch `milestone/4-backend-ipxe` @ `2b9d88e`. Diff: `git diff main...HEAD`, berisi M4-T1..T13 dan perbaikan B-1..B-5.
- Yang dibaca: `CLAUDE.md`, `docs/SPEC.md`, `docs/design/M4-plan.md` (AC-4.1..4.34), DEC-007..012, `.agent/runs/m4/{ac-trace,test-migration}.md`, `kvm/results.json` beserta bukti KVM resmi (`kvm/`, 20261105T135915Z), `.agent/runs/m3/gate-iter3.md` §Carry-over.
- Yang dijalankan ulang (read-only) di worktree:
  - `npx tsc --noEmit` exit 0.
  - `npm run lint` exit 0.
  - `npx vitest run`: 766/766 lulus (30 file), exit 0.
- Yang tidak dijalankan ulang: E2E, test infra, dan KVM. Hasilnya diambil dari `e2e.log` (69/69), `infra-test.log` (33/33), dan `kvm/results.json` (AC-4.29..4.34 PASS).
- Kode produk sejak run KVM resmi: `git diff b3a7ed4 2b9d88e` hanya mengubah `dashboard/e2e-kvm/*`. Kode produk yang diuji KVM sama dengan HEAD (`deploy-dashboard.txt`: commit b3a7ed4).

## Pemeriksaan pelemahan test

- **Skip/only:** grep `.skip|.only|.todo|.fixme|xit(|xdescribe(|test.fail|skipIf|runIf|expect.soft` di `dashboard/src`, `dashboard/e2e`, `dashboard/e2e-kvm`, dan `infra/test` memberi 0 hit.
- **Config test:**
  - `vitest.config.mts` tidak berubah. Ambang 80/80 tetap, dan `src/app/boot/**` sudah masuk include DEC-004.
  - `playwright.config.ts` tetap `forbidOnly: true`, `retries: 0`, `reuseExistingServer: false`. Guard CR-1-9 kini rekursif (CR-1-10).
  - `e2e-kvm/playwright.config.ts` memakai `forbidOnly`, `retries: 0`, dan trace/video off.
- **Asersi yang dihapus:** 38 baris `expect` hilang di diff test (selain `mock-hosts.test.ts`). Semuanya ditelusuri:
  - Sebagian besar dipindah 1:1 dari `s.configs.get(…)` ke `peekConfig(…)`. Contohnya `verify(...)` hash, `updatedAt` yang tidak berubah, `username` ops/dev, dan `DISC3 passwordHash null` di `config-routes.test.ts:242-361`.
  - Sisanya diganti sesuai P1–P6 di `test-migration.md`:
    - reboot menjadi 501 (DEC-012), dengan asersi baru `dbSnapshot` identik;
    - id OS kanonik (plan §2.2);
    - discovery mock diganti `/boot/{mac}.ipxe`. Batas ≤ 6 dtk tetap, ditambah cek tanpa duplikat dan `count === initial + 1` (lebih ketat dari `> initial`).
  - Tidak ada pelemahan.
- **Perubahan test-engineer di `dashboard/e2e-kvm/m4-install.spec.ts:95-124`:** tidak melemahkan (lihat CR-4-16).

## Temuan

| ID | Severity | File:baris | Temuan | Rekomendasi |
|---|---|---|---|---|
| CR-4-1 | minor | dashboard/src/lib/server/discovery.ts:114-144 | **Install bisa berulang dan menghapus disk lagi bila callback `configuring` hilang.** Script installer dilayani untuk job `booting` **dan** `installing`, dan setiap request membuat token baru. Bila callback `configuring` tidak sampai, job tetap `installing`. Reboot akhir installer lalu PXE boot ulang, sehingga installer jalan lagi dan disk di-wipe lagi. Tokennya baru, jadi URL di `/etc/pxe-callback/url` milik run sebelumnya mati. Kejadian ini berulang tanpa batas karena TTL ikut diperbarui. Callback bisa hilang karena: jaringan, `curl -f`/`wget` gagal, atau `u` kosong karena derivasi `/proc/cmdline` gagal (CR-4-6). Akibatnya fail-unsafe: perintah yang merusak diulang tanpa batas. Jalur Ubuntu terbukti benar di KVM; risikonya ada pada jalur gagal. Perilaku ini juga akan bertabrakan dengan uji M5 "`virsh destroy` di tengah install → Failed setelah timeout + install ulang": dengan logika sekarang, node yang dinyalakan ulang langsung menginstal lagi. | Catat jumlah `boot_served_at` atau stage `booting` di `jobs.stages`, lalu batasi. Contoh: installer hanya dilayani saat status `booting`, atau maksimal N kali per job. Setelah itu boot lokal dan biarkan watchdog M5 menandai `failed`. Setidaknya dokumentasikan perilaku ini di plan M5 dan tambahkan test integration untuk batas tersebut. |
| CR-4-2 | minor | docs/design/M4-plan.md:121, :135-136, :138, :332 (AC-4.14), :432 (AC-4.33), :448-449 (R2/R3) | **Dokumen architect basi setelah B-4.** Plan masih menulis `exit` tanpa status, termasuk teks AC-4.14 `iseq ${platform} efi && exit` dan entry tanpa `chain --replace`. Implementasi dan test kini memakai `exit 1` dan `--replace` (`boot-script.ts:33, :49, :52, :63-64, :78`). Teks AC lama masih cocok sebagai substring, jadi test tetap lulus, tetapi rasionalnya hilang: `exit` berstatus 0 justru bug di OVMF. Pembaca plan akan mengimplementasikan ulang bug B-4. | Architect mengamandemen plan, atau Orchestrator mencatat DEC: boot lokal = `exit 1` (alasan BDS OVMF/EFI_SUCCESS) dan entry = `chain --replace`. Perbarui teks AC-4.14. |
| CR-4-3 | minor | docs/design/M4-plan.md:177-187 (§2.5 Ubuntu/Debian/Rocky), :230-232 (§2.7 `node-create.sh`, `server-config.sh`), AC-4.28 | **Drift dokumen lain.** (a) §2.5 menyebut URL callback dan token ditulis generator ke file 0600. Setelah B-5, URL diturunkan saat runtime dari `/proc/cmdline` (`shell.ts:50-57`), yang menimbulkan kontrak baru: generator bergantung pada argumen kernel `installerScript`. (b) Nama script infra di plan (`node-create.sh`, `server-config.sh`) berbeda dari implementasi (`node.sh create`, `server-up.sh`/`server-base.sh`). AC-4.28 merujuk `node-create.sh`. | Amandemen plan/DEC: kontrak cmdline (`CMDLINE_CONFIG_PARAM`) dan nama script yang berlaku. |
| CR-4-4 | minor | dashboard/src/lib/server/installers/installers.test.ts:50-55 (`KCMD`) | **Kopling generator ↔ `installerScript` hanya lewat konstanta tulis-tangan.** `KCMD` adalah salinan manual cmdline `installerScript`. Test "selaras dengan installerScript" (:632-633) hanya membandingkan `CMDLINE_CONFIG_PARAM` dengan literal, tidak dengan output nyata `installerScript`. Bila `boot-script.ts` mengubah argumen (mis. `inst.ks=` jadi `ks=`, atau urutan/quoting), unit test generator tetap hijau sementara callback Debian/Rocky diam-diam mati. Jalur ini belum punya bukti KVM sampai M6. | Bangun `KCMD` dari `installerScript({...})`: ambil baris `kernel`, buang URL kernel, lalu `evalCallbackUrl` per metode. Dengan begitu perubahan cmdline langsung memecahkan test. |
| CR-4-5 | minor | dashboard/src/lib/server/boot-script.ts:72-80 | `waitScript` memakai `chain --autofree … \|\| exit 1` tanpa `--replace`, sehingga script bersarang hingga 20 level. Hasil akhirnya masih benar (`exit 1` dari script dalam membuat `chain` gagal, lalu `exit 1` lagi), tetapi tidak konsisten dengan alasan `--replace` di `entryScript`. Mode `wait` juga belum pernah diuji di KVM. | Pakai `chain --replace --autofree` seperti entry, dan tambahkan asersinya di `boot-script.test.ts`. |
| CR-4-6 | minor | dashboard/src/lib/server/installers/shell.ts:50-57; debian.ts:119; rocky.ts:194-199 | **Perbaikan B-5 untuk Debian/Rocky hanya teruji unit.** Unit test (`sh` terhadap cmdline palsu) membuktikan pola sed. Ada asumsi runtime yang belum terbukti: (a) `/proc/cmdline` tersedia di chroot `in-target` d-i dan `%post` anaconda; (b) dracut/anaconda dan d-i menerima URL dengan `:` di path (`/boot/52:54:00:…/`) untuk `inst.ks=` dan `url=`; (c) sed BRE `\{43\}` di busybox/dash. Bila salah satu gagal, `u` kosong: callback `configuring`/`failed` tidak terkirim dan file URL first-boot tidak ditulis. Bersama CR-4-1, ini berujung pada install berulang. Sesuai DEC-010 cakupan KVM Debian/Rocky ada di M6, jadi bukan pelanggaran gate M4. | Jadikan item wajib di plan M6 (KVM Debian/Rocky). Pertimbangkan fallback: bila `u` kosong, kirim `failed` lewat jalur lain, atau catat ke console tanpa token. Pertimbangkan juga memakai MAC tanpa `:` di path `/boot/` agar aman untuk parser `inst.ks`. |
| CR-4-7 | minor | dashboard/src/lib/server/installers/windows.ts:54, :77-79 | Residu B-5: unattend Windows masih menyisipkan URL callback berisi token (PowerShell `-EncodedCommand` UTF-16LE). Komentar dan test (`installers.test.ts`, kontrol positif) mengakuinya. Aman di M4 karena `INSTALLER_FILES.unattend = {}` (tidak dilayani). | Catat sebagai prasyarat sebelum unattend dilayani: turunkan URL saat runtime seperti Linux, atau gunakan token terpisah. |
| CR-4-8 | minor | dashboard/src/app/boot/[name]/[token]/[file]/route.ts:21; dashboard/src/app/boot/[name]/[token]/status/route.ts:22; dashboard/src/lib/server/boot-http.ts:20-21 | Komentar `logBootDenied` menyatakan "`mac` sudah dinormalisasi atau '-' bila invalid", tetapi route mengirim `name.slice(0, 17)` mentah. Input penyerang (≤ 17 karakter, termasuk CR/LF hasil decode param) masuk ke log server, sehingga log bisa disusupi baris palsu. Token tidak ikut karena ada di segmen lain. | Kirim `parseBootMac(name) ?? "-"`, sesuai komentar. |
| CR-4-9 | minor | dashboard/src/app/boot/[name]/route.ts:20 | `decodeURIComponent` dipanggil pada param route. Bila Next sudah men-decode `params`, nilai yang memuat `%` tidak valid (mis. `/boot/%25zz.ipxe`) membuat `URIError`, sehingga respons menjadi 500, bukan 400 "MAC tidak valid". Tidak berbahaya, tetapi kontrak "MAC invalid → 400" (AC-4.8) tidak berlaku untuk kasus ini. | Bungkus dengan try/catch dan kembalikan 400, atau hapus decode ganda. Tambahkan kasus test integration. |
| CR-4-10 | minor | dashboard/src/lib/server/settings.ts:76 vs dashboard/src/lib/server/boot-script.ts:12 | `httpUrl` menerima `[`/`]` (base URL IPv6), tetapi `ipxeSafe` menolaknya. Dengan `PXE_BASE_URL=http://[fd00::2]` server start normal, lalu setiap `/boot/*.ipxe` gagal dengan 500 saat runtime. Ini bertentangan dengan prinsip fail-fast settings. | Tolak IPv6 literal di `PXE_BASE_URL`/`PXE_MEDIA_URL` saat parse settings, atau samakan kedua regex. |
| CR-4-11 | minor | dashboard/e2e-kvm/m4-install.spec.ts:169-222 | AC-4.31 menuntut "status tetap Done, **tidak ada job baru**" setelah reboot. Test hanya menegaskan status `done`, jumlah kernel installer di serial tetap, dan script lokal. Jumlah job tidak diperiksa (belum ada API jobs di M4). Bukti tidak langsung sudah kuat: installer tidak boot lagi, dan `osAssigned=null` mencegah install baru. | Tambahkan pemeriksaan jumlah job (mis. lewat `ssh` ke server: `sqlite3 … 'select count(*) from jobs where host_id=…'`, atau endpoint read-only), atau catat penerimaan eksplisit di gate. |
| CR-4-12 | minor | dashboard/e2e-kvm/m4-install.spec.ts (AC-4.30); infra/kvm-run.sh:82-83 | Sub-klausul AC-4.30 "log dnsmasq memuat TFTP `snponly.efi` dan nginx memuat fetch `user-data`" tidak diasersi otomatis. Bukti dikumpulkan dan diperiksa manual di `ac-trace.md`. Saya memverifikasi `kvm/server-dnsmasq.txt` (16 baris `snponly.efi`) dan `kvm/server-nginx.txt` (`GET /boot/52:54:00:99:00:11/***/user-data` 200 dari `10.99.0.184`, Cloud-Init). | Tambahkan `grep -q` di `kvm-run.sh` setelah `collect_evidence`, dengan hasil ke `results.json`. |
| CR-4-13 | minor | infra/cleanup.sh:38 (glob disk) | `cleanup.sh server` lolos validasi `^[a-z0-9]+$` dan bukan nama terlindungi. Prefixnya menjadi `pxe-test-server-`, sehingga glob `pxe-test-server-*.qcow2` menghapus `pxe-test-server-base.qcow2` tanpa `--base`. Masih di dalam `.agent/vms/` dan base bisa di-provision ulang (tidak melanggar batas keras), tetapi perilakunya tidak diharapkan. | Tolak run id `server` (dan id yang menghasilkan prefix VM infra), atau batasi glob ke `pxe-test-<run>-node[0-9][0-9].qcow2` seperti plan §2.7. |
| CR-4-14 | minor | infra/redact-evidence.sh:84-90 | `sed -i` dan `_b64_redact` dijalankan pada **semua** file di `kvm/`, termasuk PNG/JSON biner. Kemungkinan kecocokan pola di PNG sangat kecil, tetapi penggantian in-place dapat merusak gambar bukti tanpa tanda. | Batasi ke file teks (`*.txt`, `*.log`, `*.json`, `*.md`) atau lewati file biner (`grep -Iq .`). Scan tetap mencakup semua file. |
| CR-4-15 | minor | dashboard/src/lib/server/http.ts:65 | `requestHost` selalu mempercayai `X-Forwarded-Host`, tidak di-gate `PXE_TRUST_PROXY` (beda dengan `requestIp`). Allowlist Host (SR-3-5) bisa dilewati dengan header itu bila Next diakses langsung. Cek `Origin === requestHost` masih menutup skenario DNS rebinding dari browser, dan nginx membuang header tersebut, jadi ini defense-in-depth. Rincian dinilai security-reviewer. | Hanya baca `X-Forwarded-Host` bila `trustProxy`. |
| CR-4-16 | info (closed) | dashboard/e2e-kvm/m4-install.spec.ts:95-124 | **Perubahan test-engineer bukan pelemahan.** (a) Bila key run sudah ada di library (cocok type+blob), node berikutnya mencentang `#lib-<id>` dan menegaskan `aria-checked=true`. Ini perilaku produk yang benar (G3-3 menolak duplikat fingerprint dengan 422). Node pertama tetap menguji jalur "tempel key baru", dan verifikasi `authorized_keys` berisi persis key itu (verify-node.sh) tetap untuk kedua node. (b) Asersi baru PATCH 200 menambah ketat, dengan gagal cepat dan body error. (c) `expect.poll` firmware (attempt1) menuntut nilai yang sama. | — |
| CR-4-17 | info (closed) | dashboard/src/lib/server/boot-script.ts:33-78; boot-script.test.ts:83-90; boot-routes.test.ts:261-280 | **B-4 benar dan lengkap di kode produk.** Semua jalur keluar iPXE memakai `IPXE_EXIT_TO_NEXT = "exit 1"` (entry `:fail`, local EFI, local BIOS fallback `sanboot \|\| exit 1`, wait). Test menegaskan setiap `exit` berstatus 1. `chain --replace` di entry terbukti di KVM resmi karena dnsmasq menyajikan `entry.ipxe`: UEFI `exit 1` diikuti BdsDxe Boot0008 "Ubuntu", dan BIOS `Booting from SAN device 0x80`. Jalur retry/`:fail` dan `wait` hanya teruji unit/integration. `infra/smoke/boot-smoke.ipxe` tidak memakai exit. Dokumen: CR-4-2. | — |
| CR-4-18 | info (closed) | dashboard/src/lib/server/installers/{shell,firstboot,ubuntu,debian,rocky}.ts | **B-5 benar untuk Ubuntu dan terbukti di KVM.** `evidence-scan.txt` bersih, `redact-evidence` bersih, dan first-boot `done` tercapai (URL dari `ds=nocloud-net;s=`). Pola sed hanya menerima MAC host sendiri dan token tepat 43 karakter (diuji negatif). Debian/Rocky: CR-4-4, CR-4-6. Windows: CR-4-7. | — |
| CR-4-19 | info (closed) | infra/node.sh:43-58; infra/test/run.sh:582-627 | **B-3 benar.** `--install no_install=yes` ditambah pemeriksaan XML live `on_reboot=restart` (gagal berarti VM dihapus dan exit ≠ 0), dengan 3 test shell. **B-1** ditutup di `installers/context.ts:84-89`, **B-2** di `infra/cleanup.sh:22-25`. | — |
| CR-4-20 | info (closed) | .agent/runs/m4/test-migration.md | **Migrasi test sah.** Penghapusan `mock-hosts.test.ts` dan penggantian test reboot, simulasi, dan seed bersumber dari plan §1.1, DEC-007, DEC-012, serta carry-over SR-2-1/CR-3-12. Pengganti ditemukan dan sering lebih ketat (seed tanpa `$6$` sama sekali, dump semua tabel; reboot 501 + `dbSnapshot` identik). Tidak ada asersi yang dilonggarkan tanpa dasar. | — |
| CR-4-21 | info | docs/agent-workflow/decisions/DEC-008 vs dashboard/src/lib/server/provisioning.ts:250-254 | DEC-008 menyebut akses file hanya untuk "IP lease dnsmasq untuk MAC itu". Plan §2.3 dan kode juga menerima `current_ip`. Nilai itu hanya diisi dari request boot terverifikasi lease (bila lease dikonfigurasi), sehingga risikonya rendah. Kode mengikuti plan; ada drift dengan teks DEC. | Selaraskan teks DEC/plan (bagian Orchestrator). |

## Carry-over gate M3 → M4 (diperiksa)

| Item | Status | Bukti |
|---|---|---|
| I-3-14 hash lab di `configs/autoinstall/user-data` | closed | File kini template `@PXE_PASSWORD_HASH@`/`@PXE_ADMIN_SSH_KEY@`, di-render `scripts/setup-pxe-server.sh` dari env. Grep `pxelab`/`wals@wal` di `dashboard/src` (non-test), `configs`, `scripts`, `infra` memberi 0 hit, kecuali komentar di `db/seed.ts:5`. Riwayat git: ranah security-reviewer. |
| SR-3-5 allowlist Host | closed | `http.ts` `isHostAllowed` + `guardMutation`, dengan test `http.test.ts` dan `iter2-routes.test.ts`. Catatan CR-4-15. |
| SR-2-1 / CR-3-12 | closed | Seed demo tanpa hash/key. `installBlocker` (`install-service.ts:144-166`) menuntut credentials eksplisit; ada test-nya. |
| CR-3-4 peekConfig | closed | `peekConfig`/`configOrDefault` dipakai di validasi, provisioning, dan install. Test "tidak menulis baris". |
| CR-3-15 budget planIps | closed | `net-carryover.test.ts` |
| CR-1-7 status server nyata | closed | `server-status.ts` (pidfile + EPERM = hidup, file TFTP, media), AC-4.7. |
| CR-1-10 guard spec rekursif | closed | `playwright.config.ts`; `guard-cr-1-10.log` |
| DR-1-3, DR-2-3, I-3-8, CR-2-11 | closed (kode) | `sonner.tsx`, `iter3-ui.spec.ts`, `use-now.ts`, `m4-hooks.test.ts`. Penilaian visual: design-reviewer. |
| Gate 5 KVM | terpenuhi (Ubuntu UEFI + BIOS) | `kvm/results.json`: AC-4.29..4.34 PASS. Node11 UEFI 603 s dan node12 BIOS 393 s sampai Done. SSH dengan key yang di-inject, password ditolak, reboot dari disk tanpa installer kedua. Cleanup dan libvirt before/after identik. |

## Kesesuaian AC (ringkas)

- Setiap AC-4.1..4.34 punya test yang lulus (lihat `ac-trace.md`). Saya mencocokkan sampel AC-4.8/4.9/4.14/4.15/4.23/4.24/4.26 dengan `boot-routes.test.ts` dan semuanya ketat:
  - 404 dengan body identik untuk 13 penolakan;
  - `sha256(token) = token_hash`;
  - log console yang ditangkap dengan `logBootDenied` aktif, tanpa token.
- Sub-klausul yang hanya terbukti manual: AC-4.30 (log dnsmasq/nginx, CR-4-12) dan AC-4.31 ("tidak ada job baru", CR-4-11).
- Transaksi sinkron (`db/index.ts` `tx`, `BEGIN IMMEDIATE`, menolak fn async) dipakai konsisten di discovery, provisioning, install, library, dan config-service. G3-2 tertutup secara struktural.

## Ringkasan

| Severity | Jumlah | ID |
|---|---|---|
| critical | 0 | — |
| major | 0 | — |
| minor | 15 | CR-4-1 … CR-4-15 |
| info | 6 | CR-4-16 … CR-4-21 (CR-4-16..20 closed/terverifikasi) |

Prioritas perbaikan yang disarankan:
1. CR-4-1: install berulang yang merusak disk saat callback hilang. Perlu diselesaikan paling lambat M5, karena bertabrakan dengan uji `virsh destroy`.
2. CR-4-4 dan CR-4-6: kopling cmdline dan validasi KVM Debian/Rocky di M6.
3. CR-4-2 dan CR-4-3: amandemen plan atau DEC untuk `exit 1`, `chain --replace`, dan kontrak URL callback B-5.

Reviewer tidak meng-approve. Keputusan ada di gatekeeper.
