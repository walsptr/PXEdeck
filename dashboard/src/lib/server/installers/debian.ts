// Generator Debian preseed (d-i). Setiap baris `d-i <key> <type> <value>`
// satu baris (CR/LF ditolak). Semua kerja pasca-install ada di satu script
// yang dikirim ke target sebagai base64 dan dijalankan lewat in-target.
import { prefixToNetmask, validateContext, type InstallContext } from "./context"
import { di } from "./lines"
import {
  authorizedKeysCmds,
  firstbootInstallCmds,
  SSHD_NO_PASSWORD_TEXT,
  sudoersText,
} from "./firstboot"
import { b64, b64write, callbackCmd, logCmd, shQuote } from "./shell"

/** Penanda log installer (konstanta; M5 plan §2.5). */
export const DEBIAN_LOG = {
  start: "installer: preseed mulai",
  late: "installer: late_command mulai",
  lateDone: "installer: konfigurasi target selesai",
} as const

/** Konfigurasi ifupdown untuk interface `$IF` (dicari dari MAC saat runtime). */
function interfacesText(c: InstallContext): string {
  const n = c.network
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
    `printf %s '${b64(interfacesText(c))}' | base64 -d | sed "s/\\$IF/$IF/g" > /etc/network/interfaces.d/mgmt`,
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
  const media = new URL(`${c.mediaUrl}/${c.imageRepo}`)
  const recipe = c.storage.partition === "lvm" ? "lvm" : "regular"
  const out = [
    "# Preseed dibuat PXE dashboard (jangan edit manual)",
    di("preseed/early_command", "string", logCmd("preseed", c.mac, DEBIAN_LOG.start)),
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
    di("debian-installer/allow_unauthenticated", "boolean", true),
    di("apt-setup/services-select", "multiselect", ""),
    di("apt-setup/non-free-firmware", "boolean", false),
    di("apt-setup/cdrom/set-first", "boolean", false),
    di("passwd/root-login", "boolean", false),
    di("passwd/user-fullname", "string", c.username),
    di("passwd/username", "string", c.username),
    di("passwd/user-password-crypted", "password", c.passwordHash),
    di("clock-setup/utc", "boolean", true),
    di("time/zone", "string", c.timezone),
    di("clock-setup/ntp", "boolean", false),
    ...(c.storage.disk ? [di("partman-auto/disk", "string", c.storage.disk)] : []),
    di("partman-auto/method", "string", recipe),
    di("partman-auto-lvm/guided_size", "string", "max"),
    di("partman-lvm/device_remove_lvm", "boolean", true),
    di("partman-md/device_remove_md", "boolean", true),
    di("partman-lvm/confirm", "boolean", true),
    di("partman-lvm/confirm_nooverwrite", "boolean", true),
    di("partman-auto/choose_recipe", "select", "atomic"),
    di("partman-efi/non_efi_system", "boolean", true),
    di("partman-partitioning/confirm_write_new_label", "boolean", true),
    di("partman/choose_partition", "select", "finish"),
    di("partman/confirm", "boolean", true),
    di("partman/confirm_nooverwrite", "boolean", true),
    di("tasksel/first", "multiselect", "standard, ssh-server"),
    di("pkgsel/include", "string", "openssh-server curl sudo"),
    di("pkgsel/upgrade", "select", "none"),
    di("popularity-contest/popularity-contest", "boolean", false),
    di("grub-installer/only_debian", "boolean", true),
    di("grub-installer/bootdev", "string", c.storage.disk || "default"),
    di(
      "preseed/late_command",
      "string",
      `in-target sh -c 'echo ${b64(debianLateScript(c))} | base64 -d > /tmp/pxe-late.sh && sh /tmp/pxe-late.sh; rm -f /tmp/pxe-late.sh'`,
    ),
    di("finish-install/reboot_in_progress", "note"),
  ]
  return `${out.join("\n")}\n`
}
