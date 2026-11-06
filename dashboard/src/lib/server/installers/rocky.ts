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
