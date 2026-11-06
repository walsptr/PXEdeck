# Bug M6 (test-engineer)

Dicatat test-engineer; tidak diperbaiki test-engineer (kode produk/infra milik dev).

## BUG-M6-1 — `kvm-run.sh` server-check menuntut `rocky-9/BaseOS/repodata/repomd.xml`, padahal ISO minimal Rocky memakai repo `Minimal/`

- Ditemukan: smoke T15, 2026-11-05T22:27Z, commit `30c88c9` (worktree smoke).
- Komponen: `infra/kvm-run.sh:349` (`media_paths` untuk `os=rocky`).
- Severity (usulan): **major** — setiap run dengan node `os=rocky` (smoke T15, run `distro` AC-6.49)
  gagal di tahap `server-check` sebelum node dibuat; Rocky 9 kickstart tidak bisa diuji KVM.
- Reproduksi:
  1. `PXE_RUNS_DIR=<dir> infra/kvm-run.sh m6 --nodes "41:uefi:os=debian 42:uefi:os=rocky 43:uefi:failpath"`
  2. Tahap `server-check` → `HEAD http://10.99.0.2/media/rocky-9/BaseOS/repodata/repomd.xml` → 404,
     `# server-check exit=1`, run berhenti (`failedStage: server-check`), cleanup berjalan normal.
- Bukti: `.agent/runs/m6/smoke/attempt1-servercheck-rocky/server-check.txt` (baris `curl: (22) … 404`),
  `kvm-run.txt`, `results.json` (`failedStage: server-check`).
- Akar masalah: `.agent/media/Rocky-9-latest-x86_64-minimal.iso` (Rocky Linux Minimal 9.8) berisi
  `Minimal/repodata/repomd.xml`; `.treeinfo` `[general] repository = Minimal`, `variants = Minimal`.
  Tidak ada direktori `BaseOS/` maupun `AppStream/` (hasil `bsdtar -tf` ISO). `.treeinfo`,
  `images/pxeboot/{vmlinuz,initrd.img}` tersedia (200).
- Saran perbaikan (dev): cek `rocky-9/Minimal/repodata/repomd.xml` (atau baca `repository` dari
  `.treeinfo`), plus test shell infra yang mengunci path ini. Opsi O11 di `M6-options.md` ("Rocky
  minimal: `@core` … tersedia") juga perlu dicek ulang terhadap repo `Minimal` (kickstart tidak boleh
  merujuk repo `BaseOS`/`AppStream` — saat ini generator `rocky.ts` tidak merujuknya).

## BUG-M6-2 — `assert_server_logs` tetap dijalankan dan menulis FAIL CR-4-12 per node walaupun run gagal sebelum node dibuat

- Komponen: `infra/kvm-run.sh` `finish()` (kondisi `server_started` saja).
- Severity (usulan): minor — tidak menutupi kegagalan (exit tetap ≠ 0, `failedStage` benar), tetapi
  `results.json` memuat 6 entri `CR-4-12-*` FAIL yang menyesatkan ("tidak ada TFTP snponly.efi …")
  untuk node yang tidak pernah ada.
- Reproduksi: sama dengan BUG-M6-1 (gagal di `server-check`).
- Bukti: `.agent/runs/m6/smoke/attempt1-servercheck-rocky/results.json`, `server-log-asserts.txt`.
- Saran: jalankan asersi log server hanya bila tahap `nodes` sudah dimulai, atau catat entri
  `NOT_RUN` dengan alasan `failedStage`.

## BUG-M6-3 — Instalasi Debian 12 (preseed) macet di pertanyaan interaktif "[!!] Select your location"

- Ditemukan: smoke T15 attempt 2, 2026-11-05T22:29Z, commit `30c88c9`, node `pxe-test-m6-node41`
  (UEFI, `os=debian`, `debian-12`, disk otomatis, locale `en_US.UTF-8`, timezone `UTC`).
- Komponen: `dashboard/src/lib/server/installers/debian.ts` (`debianPreseed`, blok locale).
- Severity (usulan): **critical untuk AC-6.48** — Debian tidak pernah selesai; job berakhir
  `failed/timeout-installing` (15 mnt). Tidak ada workaround dari UI.
- Reproduksi:
  1. `PXE_RUNS_DIR=<dir> infra/kvm-run.sh m6 --nodes "41:uefi:os=debian 43:uefi:failpath"`
     (suite `e2e-kvm/m6-smoke.spec.ts`: PATCH konfigurasi via API → install → `node.sh reset`).
  2. iPXE → kernel/initrd netboot → d-i mengambil `preseed.cfg` (nginx 200, 9397 byte) → early_command
     berjalan (event `installer: preseed mulai` 22:29:31) → network terkonfigurasi → d-i menampilkan
     `[!!] Select your location` (daftar negara untuk bahasa English) dan menunggu input sampai watchdog
     `Timeout di tahap Installing (> 15 mnt)` pada 22:44:32.
- Bukti: `.agent/runs/m6/smoke/attempt2-debian-failpath/pxe-test-m6-node41-console.txt` (baris ~1042,
  layar "Select your location" dengan jam d-i 22:30→22:43 tanpa progres),
  `pxe-test-m6-node41-job1-events.txt` (hanya 6 event; tidak ada late_command/first-boot),
  `pxe-test-m6-node41-timeline.txt`, `server-nginx.txt` (preseed.cfg 200, POST log 200).
- Dugaan akar masalah (belum diverifikasi): preseed men-set `debian-installer/language=en` dan
  `debian-installer/locale=en_US` secara terpisah tanpa `debian-installer/country`. Menurut
  example-preseed Debian, bila nilai dipreseed satu per satu (language/country/locale), `country`
  juga harus diisi; bila tidak, localechooser menanyakan negara. Saran: tambah
  `d-i debian-installer/country string <dari locale, mis. US>` (atau hanya preseed
  `debian-installer/locale` tanpa `language`), plus test generator; lalu smoke ulang.
- Yang SUDAH terbukti di run ini (CR-4-6 bagian Debian): `url=` d-i menerima `:` dalam path
  `/boot/52:54:00:99:00:41/<token>/preseed.cfg` (nginx 200 UA `debian-installer`), dan
  `preseed/early_command` berhasil menurunkan URL callback dari `/proc/cmdline` (POST `/log` 200,
  event `preseed mulai`). `late_command` (chroot) dan sed BRE busybox di chroot BELUM terbukti
  karena instalasi tidak sampai ke sana. Kernel netboot = kernel DVD (sha256 `d8808aa4…` sama untuk
  `debian-netboot/linux` dan `debian-12/install.amd/vmlinuz`, lihat `server-check.txt`).

## BUG-M6-4 — Rocky 9 kickstart tidak bisa boot di node 2 GB: dracut mengunduh `install.img` 1,2 GB ke RAM → `No space left on device`

- Ditemukan: smoke T15 attempt 3 (diagnostik manual karena BUG-M6-1), 2026-11-05T22:47Z, commit
  `30c88c9`, node `pxe-test-m6-node42` (UEFI, 2048 MB sesuai CLAUDE.md, `rocky-9`).
- Komponen: `dashboard/src/lib/server/boot-script.ts` (`installerScript`, `case "kickstart"`:
  `inst.repo=http://10.99.0.2/media/rocky-9`), dan/atau ukuran RAM node.
- Severity (usulan): **critical untuk AC-6.49** — installer tidak pernah mulai; ks.cfg tidak pernah
  diambil; job tetap `booting` sampai timeout Booting.
- Reproduksi: script diagnostik `.agent/runs/m6/smoke/attempt3-rocky-manual/rocky-manual.sh`
  (memakai net-up/server-up/deploy-dashboard/node.sh/cleanup.sh tanpa modifikasi + suite
  `m6-smoke.spec.ts`, node `os=rocky`): konfigurasi via API → install → reset → iPXE memuat
  kernel + initrd (213 MB) → dracut `curl` `images/install.img` (1.225.621.504 byte di ISO
  minimal 9.8) ke `/tmp` (tmpfs, RAM) → berhenti di 590 MB.
- Bukti: `attempt3-rocky-manual/pxe-test-m6-node42-console.txt`:
  `Memory: 1523296K/2093488K available`, `curl: (23) Failure writing output to destination`,
  `dracut: FATAL: Failed to find a root filesystem in /tmp/curl_fetch_url1/install.img`,
  `No space left on device`, `reboot: System halted`; `server-nginx.txt`: `GET /media/rocky-9/images/install.img 200 590479360`, tanpa `GET …/ks.cfg`.
- Akibat: CR-4-6 untuk `inst.ks=` (`:` di path MAC) belum bisa dibuktikan dengan node 2 GB.
- Saran (perlu keputusan dev/architect): stage2 lewat NFS yang sudah dipakai Ubuntu
  (`inst.stage2=nfs:10.99.0.2:/srv/pxe/media/rocky-9` atau `inst.repo=nfs:…`, perlu export NFS
  rocky-9) sehingga `install.img` di-mount, bukan disalin ke RAM; atau RAM node Rocky ≥ 4 GB
  (menyimpang dari CLAUDE.md "2 GB RAM" → butuh decision). Lihat attempt 4 (diagnostik 4 GB).

## BUG-M6-5 — Kickstart Rocky menambah `repo --name=AppStream --baseurl=<repo>/AppStream` yang tidak ada di ISO minimal → anaconda macet sebelum instalasi paket

- Ditemukan: smoke T15 attempt 4 (diagnostik, node Rocky **4096 MB** untuk melewati BUG-M6-4),
  2026-11-05T22:58Z, commit `30c88c9`, node `pxe-test-m6-node42`.
- Komponen: `dashboard/src/lib/server/installers/rocky.ts` (baris `repo --name=AppStream …`).
- Severity (usulan): **critical untuk AC-6.49** — anaconda berhenti setelah membaca metadata repo;
  tidak ada paket yang diunduh; `%onerror` tidak terpicu (anaconda menunggu di UI teks tty1, bukan
  serial), job `failed/timeout-installing` setelah 15 mnt.
- Reproduksi: `NODE_RAM_MB=4096` + script `.agent/runs/m6/smoke/attempt3-rocky-manual/rocky-manual.sh`
  (salinan dengan direktori bukti attempt4).
- Bukti `attempt4-rocky-manual-4g/server-nginx.txt`: `GET …/ks.cfg 200`, `POST …/log 200`
  (event `installer: kickstart mulai`), `GET /media/rocky-9/Minimal/repodata/*` 200 (UA libdnf), lalu
  `GET /media/rocky-9/AppStream/repodata/repomd.xml 404` ×4, tidak ada satu pun `GET …/Packages/…`.
  `pxe-test-m6-node42-timeline.txt`: installing 22:58:57 → `failed/timeout-installing` 23:13:59.
  Console serial berhenti di "Starting pre-anaconda logging service" (UI anaconda di tty0).
- Akar masalah: ISO `Rocky-9-latest-x86_64-minimal.iso` (9.8) hanya memiliki repo `Minimal/`
  (lihat BUG-M6-1). `url --url=<repo>` sudah cukup (anaconda membaca `.treeinfo` → `Minimal`).
  Paket yang diminta (`@^minimal-environment`, `curl`) + `openssh-server`, `sudo` ada di
  `Minimal/Packages` (`curl-7.76.1-40.el9`, `openssh-server-9.9p1-7.el9_8`, `sudo-1.9.17p2-3.el9_8`).
- Saran: hapus `repo --name=AppStream` (atau jadikan bergantung pada isi media), test generator yang
  mengunci kickstart untuk media minimal; smoke ulang Rocky setelah BUG-M6-1/-4/-5 diperbaiki.
- Yang SUDAH terbukti (CR-4-6 bagian Rocky): `inst.ks=http://10.99.0.2/boot/52:54:00:99:00:42/<token>/ks.cfg`
  diterima dracut (`:` di path MAC tidak ditolak; ks.cfg 200), dan `%pre` menurunkan URL callback dari
  `/proc/cmdline` (POST `/log` 200). `%post` belum terbukti.

## Catatan harness (bukan bug produk)

- `kvm-run.sh` keluar sebelum `verify-node.sh` bila Playwright gagal (`exit "$e2e_rc"`), sehingga node
  yang sukses di run yang sama (attempt 2: node43 Ubuntu Done + SSH key OK) tidak diverifikasi
  lengkap. Untuk run resmi: pertimbangkan verifikasi per node yang Done walau node lain gagal.

## BUG-M6-6 — Preseed Debian dengan disk "otomatis" (tanpa `partman-auto/disk`) macet di "[!!] Partition disks — No root file system"

- Ditemukan: smoke ulang attempt 5, 2026-11-05T23:35Z, commit `a67bcf6`, node `pxe-test-m6-node41`
  (UEFI, 2048 MB, `debian-12`, disk kosong = otomatis, partisi `auto`).
- Komponen: `dashboard/src/lib/server/installers/debian.ts` — `partman-auto/disk` hanya ditulis bila
  `c.storage.disk` diisi (`...(c.storage.disk ? [di("partman-auto/disk", …)] : [])`), dan
  `grub-installer/bootdev` = `default`. Golden `debian-preseed.cfg` hanya menguji disk `/dev/vda`.
- Severity (usulan): **critical untuk AC-6.48** — mode disk otomatis (default UI) tidak pernah
  mempartisi; d-i menampilkan error kritis dan menunggu `<Continue>`; job `failed/timeout-installing`
  setelah 15 mnt (23:48:51).
- Reproduksi: `PXE_RUNS_DIR=<dir> infra/kvm-run.sh m6 --nodes "41:uefi:os=debian 42:uefi:os=rocky"`
  (suite `m6-smoke.spec.ts`, PATCH `os.disk = ""`).
- Bukti: `.agent/runs/m6/smoke/attempt5-debian-rocky/pxe-test-m6-node41-console.txt` (sekitar baris
  1260: `[!!] Partition disks` / `No root file system` / `No root file system is defined.` /
  `Please correct this from the partitioning menu.`; jam d-i 23:35→23:44 tanpa progres);
  `pxe-test-m6-node41-job1-events.txt` (6 event, berhenti setelah `preseed mulai`).
- Perbaikan BUG-M6-3 terkonfirmasi: tidak ada lagi prompt bahasa/lokasi/keyboard; mirror DVD
  terbaca ("Retrieving" dari mirror lokal) sebelum partman.
- Saran: untuk disk otomatis, tentukan disk saat runtime di `preseed/early_command`
  (mis. `debconf-set partman-auto/disk "$(list-devices disk | head -n1)"` dan
  `debconf-set grub-installer/bootdev` yang sama), atau ekuivalen; tambah golden/test untuk disk
  otomatis; smoke ulang Debian.

## BUG-M6-7 — Rocky jalur gagal (disk `/dev/vdz`): `%onerror` tidak pernah mengirim `stage=failed` (mode `inst.cmdline`)

- Ditemukan: smoke ulang attempt 6, 2026-11-05T23:50Z, commit `a67bcf6`, node `pxe-test-m6-node44`
  (UEFI, 2048 MB, `rocky-9`, disk `/dev/vdz`, spec `44:uefi:failpath:os=rocky` — harness mendukung
  `:failpath` untuk Rocky).
- Komponen: `dashboard/src/lib/server/installers/rocky.ts` (`%onerror`, `ignoredisk --only-use=vdz`,
  `clearpart --drives=vdz`), `boot-script.ts` (`inst.cmdline`).
- Severity (usulan): **major** — kegagalan nyata Rocky tidak dilaporkan installer; job baru gagal
  oleh watchdog (`timeout-installing`, 15 mnt) tanpa event log installer (tidak ada tail
  anaconda.log/program.log di job). Paritas SR-5-5(c) Ubuntu tidak tercapai untuk Rocky. (AC-6.45
  sendiri hanya Ubuntu; ini celah, bukan regresi AC.)
- Reproduksi: `PXE_RUNS_DIR=<dir> infra/kvm-run.sh m6 --nodes "44:uefi:failpath:os=rocky"`.
- Bukti `.agent/runs/m6/smoke/attempt6-rocky-failpath/`: `server-nginx.txt` — `GET …/ks.cfg 200`,
  `POST …/log 200` (`%pre`: `installer: kickstart mulai` 23:51:11), lalu **tidak ada** request lagi
  dari node (tidak ada `Minimal/repodata`, tidak ada `POST …/log` tail, tidak ada `POST …/status`);
  `pxe-test-m6-node44-job1-events.txt` (5 event); timeline: masih `installing` pada +902 dtk (suite
  berhenti di batas 15 mnt, sebelum watchdog menandai `timeout-installing`). Console serial berhenti di
  "Starting pre-anaconda logging service" — UI/pesan anaconda keluar di `tty0` (console terakhir di
  cmdline), jadi pesan error tidak terekam.
- Dugaan: error validasi storage kickstart (disk tidak ada) terjadi sebelum fase instalasi; anaconda
  `cmdline` berhenti/menunggu tanpa menjalankan `%onerror`.
- Saran: di `%pre`, validasi disk target (`[ -b /dev/vdz ]`) dan kirim tail log + `stage=failed` bila
  tidak ada; atau gunakan mekanisme lain yang dijamin jalan pada error storage; pertimbangkan
  `console=tty0 console=ttyS0,…` (serial terakhir = console utama) agar pesan anaconda terekam di bukti.
  Smoke ulang Rocky failpath sesudahnya.
- Catatan suite: `m6-smoke.spec.ts` membatasi job gagal 15 mnt (`FAIL_TIMEOUT_MS`) sesuai AC-6.45; job
  yang belum final pada batas itu tidak diinstal ulang (instal ulang ditolak selama job aktif).

## BUG-M6-8 — Debian: `partman/early_command` selalu melapor "disk target tidak ditemukan", juga untuk disk eksplisit `/dev/vda`

- Ditemukan: smoke ulang attempt 7/8/9, 2026-11-06T00:17Z–00:44Z, commit `f2f848d`, node UEFI 2048 MB.
- Komponen: `dashboard/src/lib/server/installers/debian.ts` (`partman/early_command` pemilih disk), dan/atau
  ketersediaan disk virtio di lingkungan d-i netboot.
- Severity (usulan): **critical untuk AC-6.48** — Debian tidak bisa diinstal sama sekali (otomatis maupun
  eksplisit); job gagal cepat `failed/installer-error` (±70 dtk) dengan event
  `ERROR installer gagal: disk target tidak ditemukan`.
- Reproduksi:
  1. Disk otomatis: `infra/kvm-run.sh m6 --nodes "41:uefi:os=debian 42:uefi:os=rocky"` (attempt7) →
     node41 gagal 70 dtk.
  2. Failpath + install ulang otomatis: `--nodes "45:uefi:failpath:os=debian …"` (attempt8) → job1
     `/dev/vdz` gagal 70 dtk (benar), job2 disk otomatis gagal 70 dtk dengan pesan yang sama (salah).
  3. Disk eksplisit: `PXE_KVM_SMOKE_DISK=/dev/vda infra/kvm-run.sh m6 --nodes "41:uefi:os=debian"`
     (attempt9) → `d='/dev/vda'` tetap masuk cabang ERROR, artinya `[ -b /dev/vda ]` gagal saat
     `partman/early_command`.
- Bukti: `attempt7-debian-rocky-auto/pxe-test-m6-node41-{timeline,job1-events,console}.txt` (log d-i
  di console: `preseed: running preseed command partman/early_command: d=''; …` lalu tidak ada
  `disk target dipilih`); `attempt9-debian-explicit-vda/pxe-test-m6-node41-*` (`d='/dev/vda'`);
  `attempt8-failpath-debian-rocky/pxe-test-m6-node45-*`. Pada node, Rocky dan Ubuntu di VM yang sama
  (definisi `node.sh` sama) melihat `vda` 20G.
- Dugaan (belum terverifikasi): d-i tidak melihat disk virtio sama sekali saat partman (konsisten dengan
  attempt5: partman-auto tanpa disk → "No root file system" alih-alih memilih satu-satunya disk), mis.
  modul `virtio_blk`/node `/dev/vda` tidak tersedia; atau ada kesalahan logika/kutipan di perintah
  yang berjalan di `log-output … sh -c`.
- Saran: buat cabang ERROR mencetak data diagnosis ke `/log` (mis. `ls /sys/block`, `list-devices disk`,
  `grep -c virtio /proc/modules`, `ls -l /dev/vd* /dev/sd*`) supaya smoke berikutnya menunjukkan akar
  masalahnya; tambahkan unit test yang menjalankan perintah early_command di sandbox busybox/sh dengan
  `/sys/block` palsu. Debian d-i syslog untuk fixture AC-6.17 masih belum bisa diambil.

## BUG-M6-9 — Debian: apt-setup di target menolak mirror DVD tanpa tanda tangan → "[!!] Configure the package manager — The installer failed to access the mirror"

- Ditemukan: smoke attempt 10, 2026-11-06T01:10Z, commit `feb866e`, node `pxe-test-m6-node41` (disk
  otomatis) dan `pxe-test-m6-node45` (job2 setelah failpath), UEFI 2048 MB.
- Komponen: `dashboard/src/lib/server/installers/debian.ts` (blok `mirror/*`, `apt-setup/*`,
  `debian-installer/allow_unauthenticated`) dan/atau cara media DVD disajikan (`infra/server-up.sh`).
- Severity (usulan): **critical untuk AC-6.48** — d-i menunggu input; job `failed/timeout-installing`
  (15 mnt). `late_command`, Configuring, Done, SSH belum tercapai.
- Perbaikan BUG-M6-8 terkonfirmasi: `GET /media/debian-netboot/modules/6.1.0-50-amd64/virtio_blk.ko`
  dan `virtio_scsi.ko` 200 (nginx), event `modul disk virtio dimuat` ×2 → `disk target dipilih`,
  partman tanpa prompt, base system (debootstrap dari DVD, 253 request `/pool/` 200) terpasang.
  Failpath `/dev/vdz` gagal cepat (40 dtk) dengan event `ERROR diagnosis disk d-i` yang memuat `vda`
  di `/sys/block`, `list-devices disk` = `/dev/vda`, `virtio_blk` di lsmod, `/proc/partitions` vda.
- Reproduksi: `PXE_RUNS_DIR=<dir> infra/kvm-run.sh m6 --nodes "41:uefi:os=debian 45:uefi:failpath:os=debian"`.
- Bukti `.agent/runs/m6/smoke/attempt10-debian-auto-failpath/`:
  - `pxe-test-m6-node41-console.txt` (~baris 1470): `[!!] Configure the package manager` / `The
    installer failed to access the mirror` / `Downloading a file failed: Retry / Change mirror / Ignore`.
  - `server-nginx.txt`: UA `Debian APT-HTTP/1.3 (2.6.1)` (apt di target) →
    `GET /media/debian-12/dists/bookworm/InRelease 404`, `Release 304`, `Release.gpg 404`, lalu tidak
    ada request `Packages` — apt menolak repo tanpa tanda tangan (DVD hanya punya `dists/bookworm/Release`
    tanpa `InRelease`/`Release.gpg`). Juga `Release` DVD menyatakan `Acquire-By-Hash: yes` padahal
    direktori `by-hash/` tidak ada (`…/main/binary-amd64/by-hash/SHA256/… 404` dari d-i/wget).
  - `pxe-test-m6-node41-job1-events.txt`, `pxe-test-m6-node45-job{1,2}-events.txt`.
- Dugaan: `debian-installer/allow_unauthenticated=true` hanya berlaku untuk retriever d-i/debootstrap,
  tidak membuat apt 2.6 di target menerima repo tanpa tanda tangan.
- Opsi (keputusan dev/architect): (a) sajikan repo lokal bertanda tangan (Release ditandatangani key
  lab sekali pakai, key dipasang via `apt-setup/local0/key`/keyring), (b) atur apt target agar
  repo media dipercaya (mis. entri `[trusted=yes]`/`Acquire::AllowInsecureRepositories` yang
  dibuat sebelum apt-setup), (c) `apt-setup/use_mirror false` + sumber lain untuk pkgsel. Tambahkan
  test generator; smoke ulang Debian.
- Akibat: d-i syslog untuk fixture AC-6.17 masih belum bisa diambil (instalasi tidak selesai).
  Run disk eksplisit `/dev/vda` (permintaan poin 4) tidak dijalankan: akan berhenti di tahap yang sama.

## BUG-M6-10 — `kvm-run.sh` berhenti setelah verifikasi node PERTAMA bila Playwright lulus (set -e + substitusi perintah di `verify_one`)

- **Status: FIXED** — commit `9aeac33` (`9aeac331cb65ddd79442afef21b44d2ee89ca078`), backend-dev,
  2026-11-06. `verify_one` memakai `verify_partial_suffix` (if, selalu status 0) + `return 0`;
  pola sama di `finish` (`step cleanup … "$(if …)"`) dan clamp `max_nodes` (if/elif) ikut diganti.
  Test: `infra/test/m6-bug10.sh` (jalur verifikasi non-dry lewat `PXE_KVM_DRY_VERIFY_EXEC=1` + ssh
  palsu): Playwright lulus 2 node & `--waves` 3 node → semua PASS exit 0; Playwright gagal → catatan
  parsial + FAIL; node1 gagal → node2 tetap diverifikasi; cek statis. Suite infra 76/76
  (`infra-bug10.log`); mutasi baris asli → 4 test merah (`mutation-dev-BUG10.txt`). Belum diverifikasi
  ulang di KVM (run core/bulk ulang diperlukan).
- Ditemukan: run resmi `core` (`.agent/runs/m6/kvm/core/`), 2026-11-06T02:11Z, commit `97d6d44`.
- Komponen: `infra/kvm-run.sh` `verify_one()` (dari `b36a7db`):
  `VERIFY_NOTE[$i]="verify-node.sh exit=$rc + cek login password$( ((e2e_rc != 0)) && echo " (verifikasi parsial, …)")"`.
  Bila `e2e_rc == 0`, substitusi `$( ((e2e_rc != 0)) && … )` keluar 1 → status assignment = 1 → di bawah
  `set -euo pipefail` (verify_one dipanggil sebagai perintah terakhir `verify_eligible && verify_one`,
  dan langsung pada mode `--waves`) skrip keluar → trap `finish`.
- Severity (usulan): **major** — setiap run yang Playwright-nya LULUS ditandai FAIL (`failedStage: verify`)
  dan node ke-2 dst. tidak diverifikasi harness (`verify-node … NOT_RUN: run berhenti di tahap verify`).
  Di `core`: node21 PASS, node22 NOT_RUN walaupun suite sudah memverifikasi node22 sendiri
  (`pxe-test-m6core-node22-verify-ssh.txt`, verify-node.sh exit 0 sebelum & sesudah reboot). Juga mengenai
  `bulk` (`--waves`) dan `distro`.
- Reproduksi minimal:
  `bash -c 'set -euo pipefail; declare -a A=(); e=0; f(){ A[0]="x$( ((e != 0)) && echo y)"; echo after; }; for i in 1 2; do true && f; done; echo end'; echo rc=$?`
  → tidak mencetak `after`/`end`, `rc=1`.
- Bukti: `.agent/runs/m6/kvm/core/kvm-run.txt` (`playwright ok exit=0`, `verify ok …node21`, tanpa baris
  node22, `result FAIL exit=1 stage=verify`), `results.json` (entri `verify-node` node22 NOT_RUN).
- Saran: `local suffix=""; ((e2e_rc != 0)) && suffix=" (…)" || true` atau `if`; tambah kasus test infra
  "Playwright lulus, 2 node → keduanya diverifikasi" (dry-run dengan PXE_KVM_DRY_PLAYWRIGHT_RC=0).

## Verifikasi final (rerun gate lokal @ 105727e, test-engineer, 2026-11-06)

BUG-M6-1..9 tidak punya baris "Status" formal di atas; diverifikasi di commit final (kode produk = 019502a):

| Bug | Commit perbaikan (git log --grep) | Bukti di commit final |
|---|---|---|
| BUG-M6-1 | b36a7db | infra `M6 BUG-M6-1 server-check Rocky memakai repo Minimal/` lulus (`final/infra-test.log`); `kvm/distro` server-check PASS |
| BUG-M6-2 | b36a7db | infra `M6 BUG-M6-2 gagal sebelum node -> CR-4-12 NOT_RUN` lulus |
| BUG-M6-3/-4/-5 | a67bcf6 | `m6-smoke-fixes.test.ts` (BUG-M6-3, BUG-M6-4/DEC-020, BUG-M6-5) lulus; `kvm/distro` AC-6.48/6.49 PASS |
| BUG-M6-6/-7 | f2f848d | `m6-smoke-fixes.test.ts` (BUG-M6-6, BUG-M6-7) lulus; AC-6.48/6.49 PASS |
| BUG-M6-8 | feb866e | `m6-smoke-fixes.test.ts` + infra `m6-debian-modules.sh` lulus; AC-6.48 PASS |
| BUG-M6-9 | fc2f31a | `m6-smoke-fixes.test.ts` (BUG-M6-9/DEC-021) lulus; AC-6.48 PASS |
| BUG-M6-10 | 9aeac33 | FIXED (di atas); infra `m6-bug10.sh` lulus; `kvm/core` dan `kvm/bulk` memverifikasi semua node |

Tidak ada bug terbuka baru dari rerun final (lihat `final/SUMMARY.md`).
