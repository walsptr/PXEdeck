// Generator kickstart Rocky 9 (anaconda). Satu direktif per baris (CR/LF
// ditolak), key SSH dinormalisasi tanpa tanda kutip, kerja pasca-install di
// %post lewat payload base64.
import { prefixToNetmask, validateContext, type InstallContext } from "./context"
import {
  authorizedKeysCmds,
  firstbootInstallCmds,
  SSHD_NO_PASSWORD_TEXT,
  sudoersText,
} from "./firstboot"
import { singleLine } from "./lines"
import { b64, b64write, callbackCmd, logCmd, logTailCmd, shQuote } from "./shell"

/** Penanda log installer (konstanta; M5 plan §2.5). */
export const ROCKY_LOG = {
  start: "installer: kickstart mulai",
  post: "installer: post mulai",
  postDone: "installer: konfigurasi target selesai",
  disk: "installer: disk target dipilih",
  noDisk: "ERROR installer gagal: disk target tidak ditemukan",
} as const

/** Berkas kickstart partisi yang ditulis %pre untuk disk otomatis (BUG-M6-7). */
export const ROCKY_DISK_INCLUDE = "/tmp/pxe-disk.ks"

/**
 * BUG-M6-7: baris %pre (bash anaconda) yang memvalidasi disk target SEBELUM anaconda memproses
 * storage. Disk eksplisit dari config, atau (otomatis) disk pertama non-removable dari `lsblk`
 * (tanpa zram/loop). Ada → log + (otomatis) tulis `ROCKY_DISK_INCLUDE` (`ignoredisk` + `clearpart`
 * untuk disk itu saja). Tidak ada → log ERROR + tail log anaconda + callback `failed`, exit 1
 * (`%pre --erroronfail` menghentikan anaconda) — error storage di mode cmdline tidak menjalankan
 * %onerror, jadi job difinalkan dari sini. Diekspor untuk test.
 */
export function rockyDiskPreLines(ctx: InstallContext): string[] {
  const c = validateContext(ctx)
  return [
    `p=${shQuote(c.storage.disk)}`,
    `if [ -z "$p" ]; then n=$(lsblk -dnro NAME,TYPE,RM | awk '$2 == "disk" && $3 == "0" && $1 !~ /^(zram|loop)/ {print $1; exit}'); [ -n "$n" ] && p=/dev/$n; fi`,
    `if [ -n "$p" ] && [ -b "$p" ]; then`,
    `  ${logCmd("kickstart", c.mac, ROCKY_LOG.disk)}`,
    ...(c.storage.disk
      ? []
      : [`  d=\${p#/dev/}; printf 'ignoredisk --only-use=%s\\nclearpart --all --initlabel --drives=%s\\n' "$d" "$d" > ${ROCKY_DISK_INCLUDE}`]),
    "else",
    `  ${logCmd("kickstart", c.mac, ROCKY_LOG.noDisk)}`,
    `  ${logTailCmd("kickstart", c.mac, ROCKY_ERROR_LOGS)}`,
    `  ${callbackCmd("kickstart", c.mac, "failed")}`,
    "  exit 1",
    "fi",
  ]
}

/** Log anaconda yang di-tail saat gagal. */
export const ROCKY_ERROR_LOGS = ["/tmp/anaconda.log", "/tmp/program.log"]

/** Lokasi konfigurasi jaringan di target (dapat diganti test ke direktori fixture). */
export type RockyNetPaths = {
  /** Keyfile NetworkManager. */
  nmDir: string
  /** ifcfg lama (initscripts); dibersihkan juga bila ada. */
  ifcfgDir: string
  /** sysfs NIC untuk mencari nama interface dari MAC. */
  sysNet: string
  /** Sumber UUID profil baru. */
  uuidFile: string
}

export const ROCKY_NET_PATHS: RockyNetPaths = {
  nmDir: "/etc/NetworkManager/system-connections",
  ifcfgDir: "/etc/sysconfig/network-scripts",
  sysNet: "/sys/class/net",
  uuidFile: "/proc/sys/kernel/random/uuid",
}

/** Nama keyfile profil parent yang dibuat %post bila tidak ada profil parent yang dipertahankan. */
export const ROCKY_NATIVE_PROFILE = "pxe-native"

/**
 * M7 (DEC-024 §6, O6-A): baris %post (sh, chroot target) yang membuat interface native (parent
 * VLAN, = VLAN PXE di topologi trunk) TANPA IPv4/IPv6 di OS terpasang. Hanya untuk `vlan ≠ null`
 * (tanpa VLAN → `[]`, %post identik M6).
 *
 * Anaconda menyalin profil boot (`ip=dhcp`) ke target sebagai profil ethernet DHCP autoconnect untuk
 * parent; tanpa langkah ini host memakan lease di VLAN PXE setelah reboot (dual-homed). Langkah:
 * 1. Parent = `--device` kickstart: nama interface (iface by name) atau MAC host (nama dicari dari
 *    sysfs untuk mencocokkan profil yang diikat `interface-name`).
 * 2. Setiap profil non-VLAN yang terikat parent (keyfile `mac-address`/`interface-name`, ifcfg
 *    `HWADDR`/`DEVICE`) dihapus — kecuali satu keyfile yang UUID-nya dirujuk `parent=` profil VLAN:
 *    profil itu ditulis ulang di tempat (`[ipv4]`/`[ipv6]` → `method=disabled`, autoconnect true)
 *    agar rujukan VLAN tetap sah.
 * 3. Tanpa profil yang dipertahankan → keyfile baru `pxe-native` (ethernet, autoconnect, IPv4/IPv6
 *    disabled) diikat ke parent.
 * Profil VLAN (`type=vlan`, dari `network --vlanid`) tidak disentuh. Diekspor untuk test (fixture
 * direktori NetworkManager palsu lewat `paths`).
 */
export function rockyNativeNoIpv4Lines(
  ctx: InstallContext,
  paths: RockyNetPaths = ROCKY_NET_PATHS,
): string[] {
  const c = validateContext(ctx)
  const n = c.network
  if (n.mode !== "static" || n.vlan === null) return []
  const byName = n.iface.by === "name" ? n.iface.name : ""
  const bind = byName
    ? String.raw`printf 'interface-name=%s\n' "$IFN"`
    : String.raw`printf '\n[ethernet]\nmac-address=%s\n' "$MAC"`
  return [
    `# M7 (DEC-024 §6): native/parent VLAN ${n.vlan} tanpa IPv4 di OS terpasang`,
    `NMD=${shQuote(paths.nmDir)}`,
    `IFCD=${shQuote(paths.ifcfgDir)}`,
    `MAC=${shQuote(c.mac)}`,
    `IFN=${shQuote(byName)}`,
    byName
      ? "BYMAC="
      : `BYMAC=1; for d in ${shQuote(paths.sysNet)}/*; do [ "$(cat "$d/address" 2>/dev/null)" = "$MAC" ] && IFN=$(basename "$d"); done`,
    String.raw`mkdir -p "$NMD"`,
    String.raw`VP=$(sed -n 's/^parent=//p' "$NMD"/*.nmconnection 2>/dev/null)`,
    "KEEP=",
    String.raw`for f in "$NMD"/*.nmconnection; do`,
    String.raw`  [ -f "$f" ] || continue`,
    String.raw`  grep -qx 'type=vlan' "$f" && continue`,
    String.raw`  if { [ -n "$BYMAC" ] && grep -qixF "mac-address=$MAC" "$f"; } || { [ -n "$IFN" ] && grep -qxF "interface-name=$IFN" "$f"; }; then`,
    String.raw`    U=$(sed -n 's/^uuid=//p' "$f" | head -n 1)`,
    String.raw`    if [ -z "$KEEP" ] && [ -n "$U" ] && printf '%s\n' "$VP" | grep -qxF "$U"; then KEEP=$f; else rm -f "$f"; fi`,
    "  fi",
    "done",
    String.raw`for f in "$IFCD"/ifcfg-*; do`,
    String.raw`  [ -f "$f" ] || continue`,
    String.raw`  grep -qiE '^VLAN="?yes"?$' "$f" && continue`,
    String.raw`  if { [ -n "$BYMAC" ] && grep -qiE "^HWADDR=\"?$MAC\"?$" "$f"; } || { [ -n "$IFN" ] && grep -qE "^DEVICE=\"?$IFN\"?$" "$f"; }; then rm -f "$f"; fi`,
    "done",
    String.raw`if [ -n "$KEEP" ]; then`,
    String.raw`  awk '/^\[/ { sec = $0; print; if (sec == "[connection]") print "autoconnect=true"; if (sec == "[ipv4]") { print "method=disabled"; s4 = 1 } if (sec == "[ipv6]") { print "method=disabled"; s6 = 1 } next } (sec == "[ipv4]" || sec == "[ipv6]") && NF { next } sec == "[connection]" && /^autoconnect=/ { next } { print } END { if (!s4) printf "\n[ipv4]\nmethod=disabled\n"; if (!s6) printf "\n[ipv6]\nmethod=disabled\n" }' "$KEEP" > "$KEEP.pxe" && mv "$KEEP.pxe" "$KEEP"`,
    "else",
    `  KEEP="$NMD/${ROCKY_NATIVE_PROFILE}.nmconnection"`,
    `  U=$(cat ${shQuote(paths.uuidFile)} 2>/dev/null)`,
    "  {",
    String.raw`    printf '[connection]\nid=` + ROCKY_NATIVE_PROFILE + String.raw`\n'`,
    String.raw`    [ -n "$U" ] && printf 'uuid=%s\n' "$U"`,
    String.raw`    printf 'type=ethernet\nautoconnect=true\n'`,
    `    ${bind}`,
    String.raw`    printf '\n[ipv4]\nmethod=disabled\n\n[ipv6]\nmethod=disabled\n'`,
    String.raw`  } > "$KEEP"`,
    "fi",
    String.raw`chmod 600 "$KEEP"`,
  ]
}

/** Script %post (chroot target). Diekspor untuk test. */
export function rockyPostScript(ctx: InstallContext): string {
  const c = validateContext(ctx)
  const lines = [
    "#!/bin/sh",
    logCmd("kickstart", c.mac, ROCKY_LOG.post),
    callbackCmd("kickstart", c.mac, "configuring"),
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
    // M7 (DEC-024 §6): hanya bila vlan ≠ null; sebelum firstboot + restorecon (label SELinux keyfile).
    ...rockyNativeNoIpv4Lines(c),
    ...firstbootInstallCmds("", "kickstart", c.mac),
    "restorecon -R /etc /usr/local/sbin /home 2>/dev/null || true",
    logCmd("kickstart", c.mac, ROCKY_LOG.postDone),
  )
  return `${lines.join("\n")}\n`
}

export function rockyKickstart(ctx: InstallContext): string {
  const c = validateContext(ctx)
  const repo = `${c.mediaUrl}/${c.imageRepo}`
  const n = c.network
  const dev = n.mode === "static" && n.iface.by === "name" ? n.iface.name : c.mac
  const net =
    n.mode === "static"
      ? `network --device=${dev} --bootproto=static --ip=${n.ip} --netmask=${prefixToNetmask(n.prefix)} --gateway=${n.gateway} --nameserver=${n.dns.join(",")}${n.vlan === null ? "" : ` --vlanid=${n.vlan}`} --hostname=${c.hostname} --activate --onboot=yes`
      : `network --device=${dev} --bootproto=dhcp --hostname=${c.hostname} --activate --onboot=yes`
  const drives = c.storage.disk ? ` --drives=${c.storage.disk.replace(/^\/dev\//, "")}` : ""
  const out = [
    "# Kickstart dibuat PXE dashboard (jangan edit manual)",
    // BUG-M6-5: mode `cmdline` (non-interaktif) — pengaturan wajib yang gagal (mis. sumber paket)
    // membuat anaconda berhenti dengan error dan menjalankan %onerror (callback failed), bukan
    // menunggu input di UI teks tty1 sampai timeout.
    "cmdline",
    // Satu sumber: root media; anaconda membaca `.treeinfo` (`repository = Minimal` pada ISO minimal
    // 9.x). Tidak ada `repo --name=AppStream/BaseOS` — tidak ada di media minimal (404 → macet).
    `url --url=${repo}`,
    `lang ${c.locale}`,
    "keyboard --vckeymap=us --xlayouts=us",
    `timezone ${c.timezone} --utc`,
    net,
    "rootpw --lock",
    `user --name=${c.username} --password=${c.passwordHash} --iscrypted${c.sudo ? " --groups=wheel" : ""}`,
    ...c.authorizedKeys.map((k) => `sshkey --username=${c.username} "${k}"`),
    "firstboot --disable",
    "selinux --enforcing",
    "firewall --enabled --ssh",
    // Disk eksplisit: statis (divalidasi %pre). Otomatis: %pre memilih satu disk dan menulis include —
    // tanpa itu `clearpart --all` tanpa --drives menghapus SEMUA disk node.
    ...(c.storage.disk
      ? [`ignoredisk --only-use=${c.storage.disk.replace(/^\/dev\//, "")}`, `clearpart --all --initlabel${drives}`]
      : [`%include ${ROCKY_DISK_INCLUDE}`]),
    "zerombr",
    `autopart --type=${c.storage.partition === "lvm" ? "lvm" : "plain"}`,
    "bootloader --location=mbr",
    "reboot",
    "",
    "%pre --erroronfail",
    logCmd("kickstart", c.mac, ROCKY_LOG.start),
    ...rockyDiskPreLines(c),
    "%end",
    "",
    "%packages",
    "@^minimal-environment",
    "openssh-server",
    "curl",
    "sudo",
    "%end",
    "",
    "%post --log=/root/pxe-post.log",
    `echo ${b64(rockyPostScript(c))} | base64 -d > /tmp/pxe-post.sh && sh /tmp/pxe-post.sh; rm -f /tmp/pxe-post.sh`,
    "%end",
    "",
    "%onerror",
    logTailCmd("kickstart", c.mac, ROCKY_ERROR_LOGS),
    callbackCmd("kickstart", c.mac, "failed"),
    "%end",
  ].map((l) => singleLine(l, "kickstart"))
  return `${out.join("\n")}\n`
}
