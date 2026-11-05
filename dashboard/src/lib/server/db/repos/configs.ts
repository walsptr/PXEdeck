// Repo `host_configs`. CR-3-4: `peekConfig` hanya membaca (tidak membuat
// baris); `configOrDefault` menghitung default tanpa menulis; penulisan
// hanya lewat `saveConfig` (di dalam transaksi pemanggil).
import { getDb } from "../index"
import { hostKeyIds, setHostKeyIds } from "./ssh-keys"

import type { HostConfig, OsSection, StaticNetwork } from "@/lib/host-config"
import { parseCidr, type MgmtNetwork } from "@/lib/net"
import { canonicalOsImageId } from "@/lib/os-images"
import { getMgmtNetwork } from "@/lib/server/net-config"
import type { Host } from "@/lib/types"

type Row = {
  host_id: string
  os_profile: string | null
  username: string | null
  password_hash: string | null
  sudo: number
  disable_ssh_password: number
  network_mode: "dhcp" | "static"
  ip: string | null
  prefix: number | null
  gateway: string | null
  dns: string | null
  vlan: number | null
  iface: string | null
  extra_keys: string
  ssh_user: string | null
  updated_at: string | null
}

function toConfig(r: Row): HostConfig {
  const network: HostConfig["network"] =
    r.network_mode === "static"
      ? {
          mode: "static",
          ip: r.ip!,
          prefix: Number(r.prefix),
          gateway: r.gateway ?? "",
          dns: r.dns ? (JSON.parse(r.dns) as string[]) : [],
          vlan: r.vlan === null ? null : Number(r.vlan),
          iface: r.iface
            ? (JSON.parse(r.iface) as StaticNetwork["iface"])
            : { by: "mac" },
        }
      : { mode: "dhcp" }
  return {
    os: r.os_profile ? (JSON.parse(r.os_profile) as OsSection) : null,
    username: r.username,
    passwordHash: r.password_hash,
    sudo: r.sudo === 1,
    disableSshPassword: r.disable_ssh_password === 1,
    network,
    sshKeyIds: hostKeyIds(r.host_id),
    extraKeys: JSON.parse(r.extra_keys) as string[],
    sshUser: r.ssh_user,
    updatedAt: r.updated_at,
  }
}

/** Konfigurasi tersimpan, atau null bila host belum punya baris config. */
export function peekConfig(hostId: string): HostConfig | null {
  const r = getDb()
    .prepare("SELECT * FROM host_configs WHERE host_id = ?")
    .get(hostId) as Row | undefined
  return r ? toConfig(r) : null
}

/**
 * Default untuk host tanpa config (fungsi murni): OS dari OS terpasang/
 * ditugaskan, network statis dari IP management. TANPA username, hash
 * password, atau SSH key (SR-2-1/CR-3-12).
 */
export function defaultConfig(
  h: Host,
  net: MgmtNetwork = getMgmtNetwork(),
): HostConfig {
  const osId = h.osAssigned ?? h.osInstalled
  return {
    os: osId
      ? {
          osImageId: canonicalOsImageId(osId),
          disk: "",
          partition: "lvm",
          timezone: "Asia/Jakarta",
          locale: "en_US.UTF-8",
        }
      : null,
    username: null,
    passwordHash: null,
    sudo: true,
    disableSshPassword: false,
    network: h.mgmtIp
      ? {
          mode: "static",
          ip: h.mgmtIp,
          prefix: parseCidr(net.cidr).prefix,
          gateway: net.gateway,
          dns: [...net.dns],
          vlan: null,
          iface: { by: "mac" },
        }
      : { mode: "dhcp" },
    sshKeyIds: [],
    extraKeys: [],
    sshUser: null,
    updatedAt: null,
  }
}

/** Config tersimpan atau default (tanpa menulis). */
export function configOrDefault(h: Host): HostConfig {
  return peekConfig(h.id) ?? defaultConfig(h)
}

/** Upsert config + join key library. Panggil di dalam `tx`. */
export function saveConfig(hostId: string, c: HostConfig): void {
  const n = c.network
  getDb()
    .prepare(
      `INSERT INTO host_configs (host_id, os_profile, username, password_hash, sudo,
        disable_ssh_password, network_mode, ip, prefix, gateway, dns, vlan, iface,
        extra_keys, ssh_user, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET
        os_profile = excluded.os_profile, username = excluded.username,
        password_hash = excluded.password_hash, sudo = excluded.sudo,
        disable_ssh_password = excluded.disable_ssh_password,
        network_mode = excluded.network_mode, ip = excluded.ip,
        prefix = excluded.prefix, gateway = excluded.gateway, dns = excluded.dns,
        vlan = excluded.vlan, iface = excluded.iface,
        extra_keys = excluded.extra_keys, ssh_user = excluded.ssh_user,
        updated_at = excluded.updated_at`,
    )
    .run(
      hostId,
      c.os ? JSON.stringify(c.os) : null,
      c.username,
      c.passwordHash,
      c.sudo ? 1 : 0,
      c.disableSshPassword ? 1 : 0,
      n.mode,
      n.mode === "static" ? n.ip : null,
      n.mode === "static" ? n.prefix : null,
      n.mode === "static" ? n.gateway : null,
      n.mode === "static" ? JSON.stringify(n.dns) : null,
      n.mode === "static" ? n.vlan : null,
      n.mode === "static" ? JSON.stringify(n.iface) : null,
      JSON.stringify(c.extraKeys),
      c.sshUser,
      c.updatedAt,
    )
  setHostKeyIds(hostId, c.sshKeyIds)
}
