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
import { b64, b64write, callbackCmd } from "./shell"

/** Script %post (chroot target). Diekspor untuk test. */
export function rockyPostScript(ctx: InstallContext): string {
  const c = validateContext(ctx)
  const lines = [
    "#!/bin/sh",
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
  lines.push(...firstbootInstallCmds("", "kickstart", c.mac), "restorecon -R /etc /usr/local/sbin /home 2>/dev/null || true")
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
    "text",
    `url --url=${repo}`,
    `repo --name=AppStream --baseurl=${repo}/AppStream`,
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
    ...(c.storage.disk ? [`ignoredisk --only-use=${c.storage.disk.replace(/^\/dev\//, "")}`] : []),
    `clearpart --all --initlabel${drives}`,
    "zerombr",
    `autopart --type=${c.storage.partition === "lvm" ? "lvm" : "plain"}`,
    "bootloader --location=mbr",
    "reboot",
    "",
    "%packages",
    "@^minimal-environment",
    "curl",
    "%end",
    "",
    "%post --log=/root/pxe-post.log",
    `echo ${b64(rockyPostScript(c))} | base64 -d > /tmp/pxe-post.sh && sh /tmp/pxe-post.sh; rm -f /tmp/pxe-post.sh`,
    "%end",
    "",
    "%onerror",
    callbackCmd("kickstart", c.mac, "failed"),
    "%end",
  ].map((l) => singleLine(l, "kickstart"))
  return `${out.join("\n")}\n`
}
