// Generator Ubuntu autoinstall (subiquity, cloud-init NoCloud). Basis:
// configs/autoinstall/user-data lab (late-commands BootOrder UEFI + guard
// pxe-force-reboot untuk netboot NFS). Serialisasi lewat library `yaml`
// (escaping otomatis); nilai dinamis di late-commands hanya lewat base64 /
// shQuote.
import { stringify } from "yaml"

import { validateContext, type InstallContext } from "./context"
import {
  firstbootInstallCmds,
  SSHD_NO_PASSWORD_TEXT,
  sudoersText,
} from "./firstboot"
import { b64write, callbackCmd } from "./shell"

/** UEFI: entry "ubuntu" ke urutan boot pertama (lab, README §7). */
export const BOOTORDER_SNIPPET = `if [ -d /sys/firmware/efi ]; then
  n=$(efibootmgr | awk '/[Uu]buntu/ {print substr($1,5,4); exit}')
  o=$(efibootmgr | awk -F': ' '/^BootOrder/ {print $2}')
  if [ -n "$n" ]; then
    efibootmgr -o "$(echo "$n,$o" | tr ',' '\\n' | awk '!s[$0]++' | paste -sd,)" || true
  fi
fi
`

/** Netboot NFS: shutdown live installer bisa macet di unmount /cdrom (lab). */
export const FORCE_REBOOT_GUARD =
  "systemd-run --unit=pxe-force-reboot -p DefaultDependencies=no /bin/sh -c 'until [ \"$(systemctl is-system-running)\" = stopping ]; do sleep 2; done; sleep 45; echo s > /proc/sysrq-trigger; sleep 3; echo b > /proc/sysrq-trigger'"

function netplan(c: InstallContext) {
  const n = c.network
  const match =
    n.mode === "static" && n.iface.by === "name"
      ? { name: n.iface.name }
      : { macaddress: c.mac }
  if (n.mode === "dhcp") {
    return { version: 2, ethernets: { mgmt: { match, dhcp4: true } } }
  }
  const l3 = {
    dhcp4: false,
    dhcp6: false,
    addresses: [`${n.ip}/${n.prefix}`],
    routes: [{ to: "default", via: n.gateway }],
    nameservers: { addresses: [...n.dns] },
  }
  if (n.vlan === null) {
    return { version: 2, ethernets: { mgmt: { match, ...l3 } } }
  }
  return {
    version: 2,
    ethernets: { mgmt: { match, dhcp4: false, dhcp6: false } },
    vlans: { [`mgmt.${n.vlan}`]: { id: n.vlan, link: "mgmt", ...l3 } },
  }
}

function storage(c: InstallContext) {
  const layout: Record<string, unknown> = {
    name: c.storage.partition === "lvm" ? "lvm" : "direct",
  }
  if (c.storage.partition === "lvm") layout["sizing-policy"] = "all"
  if (c.storage.disk) layout.match = { path: c.storage.disk }
  return { layout }
}

/** Objek autoinstall (dipakai `ubuntuUserData`; diekspor untuk test). */
export function ubuntuAutoinstall(ctx: InstallContext) {
  const c = validateContext(ctx)
  const late: string[] = [callbackCmd("autoinstall", c.mac, "configuring")]
  if (c.sudo) {
    late.push(b64write(`/target/etc/sudoers.d/90-${c.username}`, "440", sudoersText(c.username)))
  }
  if (c.disableSshPassword) {
    late.push(
      "mkdir -p /target/etc/ssh/sshd_config.d",
      b64write("/target/etc/ssh/sshd_config.d/60-pxe-no-password.conf", "644", SSHD_NO_PASSWORD_TEXT),
    )
  }
  late.push(...firstbootInstallCmds("/target", "autoinstall", c.mac))
  late.push(BOOTORDER_SNIPPET, FORCE_REBOOT_GUARD)
  return {
    version: 1,
    locale: c.locale,
    keyboard: { layout: "us" },
    timezone: c.timezone,
    "refresh-installer": { update: false },
    apt: { geoip: false, fallback: "offline-install" },
    network: netplan(c),
    identity: {
      hostname: c.hostname,
      username: c.username,
      password: c.passwordHash,
    },
    ssh: {
      "install-server": true,
      "allow-pw": !c.disableSshPassword,
      "authorized-keys": [...c.authorizedKeys],
    },
    storage: storage(c),
    "late-commands": late,
    "error-commands": [callbackCmd("autoinstall", c.mac, "failed")],
    shutdown: "reboot",
  }
}

export function ubuntuUserData(ctx: InstallContext): string {
  return `#cloud-config\n${stringify({ autoinstall: ubuntuAutoinstall(ctx) }, { lineWidth: 0 })}`
}

export function ubuntuMetaData(ctx: InstallContext): string {
  const c = validateContext(ctx)
  return stringify({ "instance-id": c.jobId, "local-hostname": c.hostname }, { lineWidth: 0 })
}

export function ubuntuVendorData(): string {
  return "#cloud-config\n{}\n"
}
