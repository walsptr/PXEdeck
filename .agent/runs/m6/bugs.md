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
