// Generator Debian preseed (d-i). Setiap baris `d-i <key> <type> <value>`
// satu baris (CR/LF ditolak). Semua kerja pasca-install ada di satu script
// yang dikirim ke target sebagai base64 dan dijalankan lewat in-target.
import {
  debianExternalMediaError,
  InstallerInputError,
  isLocalMedia,
  prefixToNetmask,
  validateContext,
  type InstallContext,
} from "./context"
import { di } from "./lines"
import {
  authorizedKeysCmds,
  firstbootInstallCmds,
  SSHD_NO_PASSWORD_TEXT,
  sudoersText,
} from "./firstboot"
import { b64, b64write, callbackCmd, logCmd, logFileCmd, shQuote } from "./shell"

/** Penanda log installer (konstanta; M5 plan §2.5). */
export const DEBIAN_LOG = {
  start: "installer: preseed mulai",
  late: "installer: late_command mulai",
  lateDone: "installer: konfigurasi target selesai",
  disk: "installer: disk target dipilih",
  noDisk: "ERROR installer gagal: disk target tidak ditemukan",
  modules: "installer: modul disk virtio dimuat",
} as const

/**
 * BUG-M6-8: driver disk yang TIDAK ada di initrd netboot Debian dan tidak ada sebagai udeb di pool
 * DVD-1 (tertanam di initrd CD). Disajikan server di `<media>/debian-netboot/modules/<kver>/` (diisi
 * `infra/server/debian-disk-modules.sh` dari initrd DVD, kver sama).
 */
export const DEBIAN_DISK_MODULES = ["virtio_blk", "virtio_scsi"] as const
export const DEBIAN_MODULES_PATH = "debian-netboot/modules"
/** Berkas diagnosis jalur gagal disk (d-i, tanpa token). */
export const DEBIAN_DIAG_FILE = "/tmp/pxe-disk-diag.txt"

/**
 * Muat driver disk yang belum dimuat: unduh `<media>/debian-netboot/modules/$(uname -r)/<m>.ko` (tanpa
 * token) lalu `insmod` (dependensinya dimuat `modprobe` dari initrd netboot lebih dulu); idempoten (`/sys/module/<m>` ada → lewati); kegagalan diabaikan (hardware
 * non-virtio tidak memerlukannya). Lalu `udevadm settle` agar `/dev/vdX` muncul. Diekspor untuk test.
 */
export function debianModulesCmd(ctx: InstallContext): string {
  const c = validateContext(ctx)
  const base = shQuote(`${new URL(c.mediaUrl).href.replace(/\/$/, "")}/${DEBIAN_MODULES_PATH}`)
  return [
    // Dependensi (ada di initrd netboot): virtio, virtio_ring (virtio_blk), scsi_mod (virtio_scsi).
    "for m in virtio virtio_ring virtio_pci scsi_mod; do modprobe $m 2>/dev/null; done",
    `for m in ${DEBIAN_DISK_MODULES.join(" ")}; do [ -d "/sys/module/$m" ] || { wget -q -T 15 -O "/tmp/$m.ko" ${base}"/$(uname -r)/$m.ko" && insmod "/tmp/$m.ko"; }; done`,
    "udevadm settle --timeout=15 2>/dev/null || sleep 3",
    `if [ -d /sys/module/virtio_blk ]; then ${logCmd("preseed", c.mac, DEBIAN_LOG.modules)}; fi`,
  ].join("; ")
}

/** Perintah diagnosis disk (jalur gagal) → `DEBIAN_DIAG_FILE`; hanya nama perangkat/modul, tanpa token. */
export const DEBIAN_DIAG_CMD = `{ echo 'ERROR diagnosis disk d-i'; echo "kernel $(uname -r)"; echo '# ls /sys/block'; ls /sys/block; echo '# list-devices disk'; list-devices disk; echo '# ls -l /dev/vd* /dev/sd* /dev/nvme*'; ls -l /dev/vd* /dev/sd* /dev/nvme* 2>&1; echo '# lsmod (virtio/scsi/ata)'; lsmod | grep -E 'virtio|scsi|ata|sd_mod'; echo '# /proc/partitions'; cat /proc/partitions; } > ${DEBIAN_DIAG_FILE} 2>&1`

/**
 * BUG-M6-6: `partman/early_command` (d-i busybox, berjalan tepat sebelum partman). Disk target =
 * disk eksplisit dari config, atau (otomatis) disk pertama non-removable dari `list-devices disk`.
 * Disk ada → `debconf-set partman-auto/disk` + `grub-installer/bootdev` (tanpa ini partman tidak
 * memilih disk dan berhenti di "No root file system"). Disk tidak ada → log ERROR + callback
 * `failed` lalu exit 1 (job langsung final, tidak menunggu watchdog). Diekspor untuk test.
 */
export function debianDiskCmd(ctx: InstallContext): string {
  const c = validateContext(ctx)
  return [
    // BUG-M6-8: driver disk dimuat ulang (idempoten) tepat sebelum pemilihan disk.
    debianModulesCmd(c),
    `d=${shQuote(c.storage.disk)}`,
    'if [ -z "$d" ]; then for x in $(list-devices disk); do [ "$(cat "/sys/block/${x##*/}/removable" 2>/dev/null)" = 1 ] || { d=$x; break; }; done; fi',
    `if [ -n "$d" ] && [ -b "$d" ]; then debconf-set partman-auto/disk "$d"; debconf-set grub-installer/bootdev "$d"; ${logCmd("preseed", c.mac, DEBIAN_LOG.disk)}; else ${logCmd("preseed", c.mac, DEBIAN_LOG.noDisk)}; ${DEBIAN_DIAG_CMD}; ${logFileCmd("preseed", c.mac, DEBIAN_DIAG_FILE)}; ${callbackCmd("preseed", c.mac, "failed")}; exit 1; fi`,
  ].join("; ")
}

/**
 * CR-6-1: batas aman panjang satu baris `preseed/late_command` (byte). d-i menjalankannya sebagai satu
 * argumen `sh -c`, dan `in-target sh -c '…'` sekali lagi; Linux membatasi satu argumen pada
 * `MAX_ARG_STRLEN` = 131072. Di atas batas ini generator menolak (InstallerInputError) alih-alih
 * menghasilkan preseed yang gagal E2BIG di tengah instalasi. Validasi config membatasi total
 * `authorized_keys` (`AUTHORIZED_KEYS_MAX_BYTES`) sehingga batas ini tidak tercapai untuk input valid.
 */
export const DEBIAN_LATE_COMMAND_MAX_BYTES = 100_000

/**
 * DEC-021 / DEC-022 §2 (fail-closed): generator Debian hanya untuk media server PXE lokal. Media
 * eksternal tidak terbukti bertanda tangan → ditolak, sehingga `[trusted=yes]`,
 * `allow_unauthenticated true`, dan hook `50mirror` tidak pernah dikeluarkan untuk host media lain.
 */
function requireLocalMedia(c: InstallContext): void {
  if (!isLocalMedia(c.mediaUrl, c.serverIp)) throw new InstallerInputError(debianExternalMediaError(c.mediaUrl, c.serverIp))
}

/** Opsi sumber apt media lokal tidak bertanda tangan (DEC-021). */
export const DEBIAN_UNSIGNED_OPTS = "[trusted=yes by-hash=no]"
/** Hook base-installer (berjalan setelah base system, sebelum apt-setup) — DEC-021. */
export const DEBIAN_APT_HOOK = "/usr/lib/post-base-installer.d/05pxe-local-media"
const APT_MIRROR_GEN = "/usr/lib/apt-setup/generators/50mirror"

/**
 * BUG-M6-9 / DEC-021 (media lokal tidak bertanda tangan saja). apt 2.6 di target menolak repo DVD
 * (`Release` tanpa tanda tangan, `Acquire-By-Hash: yes` tanpa `by-hash/`). Generator `50mirror`
 * apt-setup selalu menulis `deb http://<mirror> …` lalu memverifikasinya dengan `apt-get update` →
 * gagal → "[!!] Configure the package manager" (dan pertanyaan `apt-setup/mirror/error` di-reset ke
 * Retry sehingga tidak bisa dipreseed). Maka: hook post-base-installer (dibuat di
 * `preseed/early_command`, dijalankan base-installer SETELAH kernel dari mirror terpasang dan
 * SEBELUM apt-setup) menonaktifkan `50mirror` (`chmod a-x` → apt-setup membuang keluarannya), dan
 * sumber satu-satunya ditulis generator resmi `60local` dari `apt-setup/local0/repository` dengan
 * `[trusted=yes by-hash=no]`. Diekspor untuk test.
 */
export function debianAptHookCmd(): string {
  return [
    "mkdir -p /usr/lib/post-base-installer.d",
    `printf '%s\\n' '#!/bin/sh' '# PXE dashboard (DEC-021): mirror media lokal tanpa tanda tangan -> sumber dari apt-setup/local0' 'if [ -f ${APT_MIRROR_GEN} ]; then chmod a-x ${APT_MIRROR_GEN}; logger -t pxe "50mirror dinonaktifkan (DEC-021)"; fi' > ${DEBIAN_APT_HOOK}`,
    `chmod 755 ${DEBIAN_APT_HOOK}`,
  ].join("; ")
}

/**
 * Baris late script (target, chroot): hapus `[trusted=yes by-hash=no]` dan nonaktifkan (komentari)
 * sumber media lokal, sehingga sistem terpasang tidak menyimpan sumber tak terautentikasi (DEC-021 §2).
 */
export const DEBIAN_UNTRUST_CMD =
  "for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do if [ -f \"$f\" ]; then sed -i 's#^deb[[:space:]]*\\[trusted=yes by-hash=no\\][[:space:]]*#\\# (media instalasi PXE tanpa tanda tangan, DEC-021) deb #' \"$f\"; fi; done; rm -f /etc/apt/apt.conf.d/00AllowUnauthenticated"

/**
 * Konfigurasi ifupdown `/etc/network/interfaces.d/mgmt` untuk interface `$IF` (dicari dari MAC saat
 * runtime, diganti `sed` di late script). Statis + `vlan` (DEC-023/024, O6-A): parent `inet manual`
 * (link up, tanpa IPv4 — native/VLAN PXE tidak memakan lease) + `$IF.<vlan>` static. ifupdown
 * menurunkan raw device dan VLAN ID dari nama `<iface>.<id>`. Dukungan VLAN ifupdown di target
 * (bawaan vs paket `vlan`) dibuktikan smoke KVM M7-T10 sebelum diubah (O10); fungsi ini tidak
 * menambah paket. Diekspor untuk test.
 */
export function debianInterfacesText(ctx: InstallContext): string {
  const n = validateContext(ctx).network
  if (n.mode === "dhcp") return "auto $IF\niface $IF inet dhcp\n"
  const name = n.vlan === null ? "$IF" : `$IF.${n.vlan}`
  return [
    n.vlan === null ? "" : "auto $IF\niface $IF inet manual\n",
    `auto ${name}\n`,
    `iface ${name} inet static\n`,
    `    address ${n.ip}/${n.prefix}\n`,
    `    netmask ${prefixToNetmask(n.prefix)}\n`,
    `    gateway ${n.gateway}\n`,
    `    dns-nameservers ${n.dns.join(" ")}\n`,
  ].join("")
}

/** Script pasca-install (dijalankan di chroot target). Diekspor untuk test. */
export function debianLateScript(ctx: InstallContext): string {
  const c = validateContext(ctx)
  requireLocalMedia(c)
  const n = c.network
  const ifaceLookup =
    n.mode === "static" && n.iface.by === "name"
      ? `IF=${shQuote(n.iface.name)}`
      : [
          "IF=",
          "for d in /sys/class/net/*; do",
          `  [ "$(cat "$d/address" 2>/dev/null)" = ${shQuote(c.mac)} ] && IF=$(basename "$d")`,
          "done",
          '[ -n "$IF" ] || IF=$(ip -o link | awk -F\': \' \'$2 != "lo" {print $2; exit}\')',
        ].join("\n")
  const lines = [
    "#!/bin/sh",
    "set -e",
    logCmd("preseed", c.mac, DEBIAN_LOG.late),
    callbackCmd("preseed", c.mac, "configuring"),
    ...authorizedKeysCmds("", c.username, c.authorizedKeys),
  ]
  if (c.sudo) lines.push(b64write(`/etc/sudoers.d/90-${c.username}`, "440", sudoersText(c.username)))
  if (c.disableSshPassword) {
    lines.push(
      "mkdir -p /etc/ssh/sshd_config.d",
      b64write("/etc/ssh/sshd_config.d/60-pxe-no-password.conf", "644", SSHD_NO_PASSWORD_TEXT),
    )
  }
  lines.push(
    // BUG-M6-3 (terkait): preseed diambil lewat jaringan SETELAH netcfg berjalan, sehingga
    // `netcfg/get_hostname` di preseed terlambat (hostname target = DHCP/"debian"). Hostname host
    // ditulis eksplisit di target.
    `printf '%s\\n' ${shQuote(c.hostname)} > /etc/hostname`,
    `sed -i '/^127\\.0\\.1\\.1[[:space:]]/d' /etc/hosts && printf '127.0.1.1\\t%s\\n' ${shQuote(c.hostname)} >> /etc/hosts`,
    ifaceLookup,
    // Interface management dari MAC; file interfaces utama hanya lo + include.
    b64write("/etc/network/interfaces", "644", "auto lo\niface lo inet loopback\n\nsource /etc/network/interfaces.d/*\n"),
    "mkdir -p /etc/network/interfaces.d",
    `printf %s '${b64(debianInterfacesText(c))}' | base64 -d | sed "s/\\$IF/$IF/g" > /etc/network/interfaces.d/mgmt`,
    // SR-6-6: sumber `trusted=yes` dibersihkan SEBELUM unit firstboot (callback done) dipasang; bila
    // pembersihan gagal (`set -e`), firstboot tidak terpasang → job tidak pernah Done.
    DEBIAN_UNTRUST_CMD,
    ...firstbootInstallCmds("", "preseed", c.mac),
    logCmd("preseed", c.mac, DEBIAN_LOG.lateDone),
  )
  return `${lines.join("\n")}\n`
}

/**
 * Baris locale d-i (BUG-M6-3): language + country + locale dipreseed bersama (country diturunkan dari
 * locale host, mis. `id_ID.UTF-8` → `ID`), plus supported-locales agar locale target terpasang.
 */
export function localeLines(locale: string): string[] {
  const m = /^([a-z]{2,3})_([A-Z]{2})\.UTF-8$/.exec(locale)
  if (!m) throw new Error(`locale tidak valid: ${locale}`)
  return [
    di("debian-installer/language", "string", "en"),
    di("debian-installer/country", "string", m[2]),
    di("debian-installer/locale", "string", `${m[1]}_${m[2]}.UTF-8`),
    di("localechooser/supported-locales", "multiselect", locale),
  ]
}

export function debianPreseed(ctx: InstallContext): string {
  const c = validateContext(ctx)
  requireLocalMedia(c)
  const lateCommand = `in-target sh -c 'echo ${b64(debianLateScript(c))} | base64 -d > /tmp/pxe-late.sh && sh /tmp/pxe-late.sh; rm -f /tmp/pxe-late.sh'`
  const lateBytes = Buffer.byteLength(lateCommand)
  if (lateBytes > DEBIAN_LATE_COMMAND_MAX_BYTES)
    throw new InstallerInputError(
      `Debian: preseed/late_command ${lateBytes} byte melebihi batas aman ${DEBIAN_LATE_COMMAND_MAX_BYTES} byte ` +
        "(kurangi jumlah/ukuran SSH key)",
    )
  const media = new URL(`${c.mediaUrl}/${c.imageRepo}`)
  const recipe = c.storage.partition === "lvm" ? "lvm" : "regular"
  const out = [
    "# Preseed dibuat PXE dashboard (jangan edit manual)",
    // BUG-M6-8: driver disk virtio dimuat sedini mungkin (sebelum disk-detect/partman).
    di(
      "preseed/early_command",
      "string",
      `${logCmd("preseed", c.mac, DEBIAN_LOG.start)}; ${debianModulesCmd(c)}; ${debianAptHookCmd()}`,
    ),
    // BUG-M6-3: dengan `auto=true`, localechooser berjalan SETELAH preseed dimuat. Bila language/
    // locale dipreseed terpisah, country WAJIB ikut (example-preseed Debian), kalau tidak d-i bertanya
    // "Select your location" dan instalasi macet. Bahasa installer tetap English; locale target dari
    // config host.
    ...localeLines(c.locale),
    di("keyboard-configuration/xkb-keymap", "select", "us"),
    di("keyboard-configuration/layoutcode", "string", "us"),
    // Tanpa firmware non-free di media (offline): jangan tanya "load missing firmware".
    di("hw-detect/load_firmware", "boolean", false),
    di("netcfg/choose_interface", "select", "auto"),
    di("netcfg/get_hostname", "string", c.hostname),
    di("netcfg/get_domain", "string", ""),
    di("netcfg/hostname", "string", c.hostname),
    di("mirror/country", "string", "manual"),
    di("mirror/protocol", "string", "http"),
    di("mirror/http/hostname", "string", media.host),
    di("mirror/http/directory", "string", media.pathname),
    di("mirror/http/proxy", "string", ""),
    di("mirror/suite", "string", "bookworm"),
    // DEC-021: hanya media lokal (requireLocalMedia di atas); dibersihkan di late script.
    di("debian-installer/allow_unauthenticated", "boolean", true),
    // Tanpa NAT: tidak ada security/updates/backports, non-free, contrib, deb-src.
    di("apt-setup/services-select", "multiselect", ""),
    di("apt-setup/non-free-firmware", "boolean", false),
    di("apt-setup/non-free", "boolean", false),
    di("apt-setup/contrib", "boolean", false),
    di("apt-setup/enable-source-repositories", "boolean", false),
    di("apt-setup/cdrom/set-first", "boolean", false),
    // DEC-021: media lokal tanpa tanda tangan → satu sumber dari 60local (lihat debianAptHookCmd).
    di("apt-setup/local0/repository", "string", `${DEBIAN_UNSIGNED_OPTS} ${media.href.replace(/\/$/, "")} bookworm main`),
    di("passwd/root-login", "boolean", false),
    di("passwd/user-fullname", "string", c.username),
    di("passwd/username", "string", c.username),
    di("passwd/user-password-crypted", "password", c.passwordHash),
    di("clock-setup/utc", "boolean", true),
    di("time/zone", "string", c.timezone),
    di("clock-setup/ntp", "boolean", false),
    // Disk dipilih/divalidasi saat runtime (BUG-M6-6); partman-auto/disk di-set lewat debconf-set.
    di("partman/early_command", "string", debianDiskCmd(c)),
    di("partman-auto/method", "string", recipe),
    di("partman-auto-lvm/guided_size", "string", "max"),
    di("partman-lvm/device_remove_lvm", "boolean", true),
    di("partman-md/device_remove_md", "boolean", true),
    di("partman-lvm/confirm", "boolean", true),
    di("partman-lvm/confirm_nooverwrite", "boolean", true),
    di("partman-auto/choose_recipe", "select", "atomic"),
    di("partman-auto/purge_lvm_from_device", "boolean", true),
    di("partman-auto-lvm/new_vg_name", "string", "pxe-vg"),
    di("partman-efi/non_efi_system", "boolean", true),
    di("partman-partitioning/choose_label", "select", "gpt"),
    di("partman-partitioning/default_label", "string", "gpt"),
    di("partman-basicfilesystems/no_swap", "boolean", false),
    di("partman-partitioning/confirm_write_new_label", "boolean", true),
    di("partman/choose_partition", "select", "finish"),
    di("partman/confirm", "boolean", true),
    di("partman/confirm_nooverwrite", "boolean", true),
    // Hanya ssh-server (paket standard tidak diperlukan; lebih sedikit paket dari DVD offline).
    di("tasksel/first", "multiselect", "ssh-server"),
    di("pkgsel/include", "string", "openssh-server curl sudo"),
    di("pkgsel/upgrade", "select", "none"),
    di("pkgsel/update-policy", "select", "none"),
    di("popularity-contest/popularity-contest", "boolean", false),
    di("grub-installer/only_debian", "boolean", true),
    di("grub-installer/with_other_os", "boolean", false),
    // UEFI: salinan juga di jalur removable \EFI\BOOT\BOOTX64.EFI (boot dari disk tanpa entri NVRAM).
    di("grub-installer/force-efi-extra-removable", "boolean", true),
    // Nilai awal; `partman/early_command` menimpanya dengan disk terpilih (otomatis maupun eksplisit).
    di("grub-installer/bootdev", "string", c.storage.disk || "default"),
    di("preseed/late_command", "string", lateCommand),
    di("finish-install/reboot_in_progress", "note"),
  ]
  return `${out.join("\n")}\n`
}
