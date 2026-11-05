// Repo tabel `hosts`. Semua fungsi sinkron (dipakai di dalam `tx`).
import { getDb } from "../index"

import type { Firmware, Host, ProvisionStatus } from "@/lib/types"

type HostRow = {
  id: string
  mac: string
  hostname: string | null
  current_ip: string | null
  mgmt_ip: string | null
  vendor: string | null
  firmware: Firmware | null
  os_installed: string | null
  os_assigned: string | null
  status: ProvisionStatus
  status_since: string
  first_seen: string
  last_seen: string
}

function toHost(r: HostRow): Host {
  return {
    id: r.id,
    mac: r.mac,
    hostname: r.hostname,
    currentIp: r.current_ip,
    mgmtIp: r.mgmt_ip,
    vendor: r.vendor,
    firmware: r.firmware,
    osInstalled: r.os_installed,
    osAssigned: r.os_assigned,
    status: r.status,
    statusSince: r.status_since,
    lastSeen: r.last_seen,
  }
}

/** Id host = MAC tanpa pemisah (12 hex huruf kecil). */
export function hostIdFromMac(mac: string): string {
  return mac.replaceAll(":", "").toLowerCase()
}

export function listHosts(): Host[] {
  return (
    getDb().prepare("SELECT * FROM hosts ORDER BY mac").all() as HostRow[]
  ).map(toHost)
}

export function getHost(id: string): Host | null {
  const r = getDb().prepare("SELECT * FROM hosts WHERE id = ?").get(id) as
    | HostRow
    | undefined
  return r ? toHost(r) : null
}

export function getHostByMac(mac: string): Host | null {
  return getHost(hostIdFromMac(mac))
}

export function insertHost(h: Host, firstSeen: string = h.lastSeen): void {
  getDb()
    .prepare(
      `INSERT INTO hosts (id, mac, hostname, current_ip, mgmt_ip, vendor, firmware,
        os_installed, os_assigned, status, status_since, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      h.id,
      h.mac,
      h.hostname,
      h.currentIp,
      h.mgmtIp,
      h.vendor,
      h.firmware,
      h.osInstalled,
      h.osAssigned,
      h.status,
      h.statusSince,
      firstSeen,
      h.lastSeen,
    )
}

const COLUMNS: Record<keyof Omit<Host, "id" | "mac">, string> = {
  hostname: "hostname",
  currentIp: "current_ip",
  mgmtIp: "mgmt_ip",
  vendor: "vendor",
  firmware: "firmware",
  osInstalled: "os_installed",
  osAssigned: "os_assigned",
  status: "status",
  statusSince: "status_since",
  lastSeen: "last_seen",
}

export type HostPatch = Partial<Omit<Host, "id" | "mac">>

/** Ubah kolom host. Mengembalikan false bila host tidak ada. */
export function updateHost(id: string, patch: HostPatch): boolean {
  const keys = (Object.keys(patch) as (keyof HostPatch)[]).filter(
    (k) => k in COLUMNS && patch[k] !== undefined,
  )
  if (keys.length === 0) return getHost(id) !== null
  const sets = keys.map((k) => `${COLUMNS[k]} = ?`).join(", ")
  const res = getDb()
    .prepare(`UPDATE hosts SET ${sets} WHERE id = ?`)
    .run(...keys.map((k) => patch[k] as string | null), id)
  return Number(res.changes) > 0
}

/** Ubah status + `status_since` sekaligus. */
export function setHostStatus(
  id: string,
  status: ProvisionStatus,
  at: string,
  extra: HostPatch = {},
): boolean {
  return updateHost(id, { ...extra, status, statusSince: at })
}

/** Hapus host (cascade: config, join key, jobs). */
export function deleteHost(id: string): boolean {
  const res = getDb().prepare("DELETE FROM hosts WHERE id = ?").run(id)
  return Number(res.changes) > 0
}
