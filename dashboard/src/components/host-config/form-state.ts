// State form sheet konfigurasi + turunan (rencana IP/hostname) + validasi
// client. Server memvalidasi ulang semuanya (config-service.ts).
import { validatePassword, validateUsername } from "@/lib/credentials"
import type {
  ConfigPayload,
  LOCALES,
  PARTITION_SCHEMES,
  PublicHostConfig,
  SectionKey,
  TIMEZONES,
} from "@/lib/host-config"
import {
  renderHostnames,
  validateHostname,
  type HostnameRow,
} from "@/lib/hostname"
import {
  intToIp,
  ipToInt,
  MGMT_NETWORK,
  parseCidr,
  planIps,
  subnetBounds,
  validateIpAssignments,
  validateStaticNetwork,
  type IpPlanRow,
  type IpUsage,
  type MgmtNetwork,
} from "@/lib/net"
import { parseSshKey } from "@/lib/ssh-key"
import type { Host } from "@/lib/types"

export const SECTION_LABEL: Record<SectionKey, string> = {
  os: "OS",
  credentials: "Credentials",
  network: "Network",
  hostname: "Hostname",
  ssh: "SSH Keys",
}

export const SECTION_ORDER: SectionKey[] = [
  "os",
  "credentials",
  "network",
  "hostname",
  "ssh",
]

export type OsForm = {
  osImageId: string
  disk: string
  partition: (typeof PARTITION_SCHEMES)[number]
  customStorage: string
  timezone: (typeof TIMEZONES)[number]
  locale: (typeof LOCALES)[number]
}

export type CredMode = "same" | "random" | "csv"

export type CredForm = {
  mode: CredMode
  username: string
  password: string
  length: number
  csv: string
  sudo: boolean
  disableSshPassword: boolean
}

export type NetForm = {
  mode: "dhcp" | "static"
  /** Host tunggal. */
  ip: string
  /** Bulk. */
  planKind: "range" | "increment"
  start: string
  end: string
  step: number
  skipUsed: boolean
  prefix: number
  gateway: string
  dns: string[]
  vlan: string
  ifaceBy: "mac" | "name"
  ifaceName: string
}

export type HostnameForm = {
  name: string
  template: string
  prefix: string
  startIndex: number
}

export type NewKeyForm = {
  name: string
  publicKey: string
  saveToLibrary: boolean
}

export type SshForm = {
  keyIds: string[]
  newKeys: NewKeyForm[]
  user: string
}

export type FormState = {
  os: OsForm
  credentials: CredForm
  network: NetForm
  hostname: HostnameForm
  ssh: SshForm
}

/**
 * Default range alokasi bulk dari subnet aktif: mulai `.11` (setelah gateway/PXE server, sama
 * dengan pxe-nodes) sampai tepat sebelum range DHCP dinamis (atau sebelum broadcast).
 */
export function defaultIpRange(mgmt: MgmtNetwork): { start: string; end: string } {
  const { network, broadcast } = subnetBounds(mgmt.cidr)
  const start = Math.min(network + 11, broadcast - 1)
  const lo = ipToInt(mgmt.dynamicRange[0])
  const end = lo - 1 > start && lo <= broadcast ? lo - 1 : broadcast - 1
  return { start: intToIp(start), end: intToIp(end) }
}

export function initialForm(
  hosts: Host[],
  config?: PublicHostConfig,
  /** Subnet management aktif dari server (`GET /api/network`, CR-3-2). */
  mgmt: MgmtNetwork = MGMT_NETWORK,
): FormState {
  const single = hosts.length === 1 ? hosts[0] : null
  const net = config?.network
  const range = defaultIpRange(mgmt)
  return {
    os: {
      osImageId:
        config?.os?.osImageId ??
        single?.osAssigned ??
        single?.osInstalled ??
        "",
      disk: config?.os?.disk ?? "",
      partition: config?.os?.partition ?? "lvm",
      customStorage: config?.os?.customStorage ?? "",
      timezone: config?.os?.timezone ?? "Asia/Jakarta",
      locale: config?.os?.locale ?? "en_US.UTF-8",
    },
    credentials: {
      mode: "same",
      username: config?.username ?? "ubuntu",
      password: "",
      length: 16,
      csv: "",
      sudo: config?.sudo ?? true,
      disableSshPassword: config?.disableSshPassword ?? false,
    },
    network: {
      mode: net?.mode ?? "static",
      ip: net?.mode === "static" ? net.ip : (single?.mgmtIp ?? ""),
      planKind: "range",
      start: range.start,
      end: range.end,
      step: 1,
      skipUsed: true,
      prefix:
        net?.mode === "static"
          ? net.prefix
          : parseCidr(mgmt.cidr).prefix,
      gateway: net?.mode === "static" ? net.gateway : mgmt.gateway,
      dns: net?.mode === "static" ? net.dns : [...mgmt.dns],
      vlan: net?.mode === "static" && net.vlan ? String(net.vlan) : "",
      ifaceBy: net?.mode === "static" ? net.iface.by : "mac",
      ifaceName:
        net?.mode === "static" && net.iface.by === "name" ? net.iface.name : "",
    },
    hostname: {
      name: single?.hostname ?? "",
      template: "node-{index:02}",
      prefix: "",
      startIndex: 1,
    },
    ssh: {
      keyIds: config?.sshKeyIds ?? [],
      newKeys: [],
      user: config?.sshUser ?? "",
    },
  }
}

export type Context = {
  hosts: Host[]
  /** Semua host (untuk deteksi bentrok IP/hostname di luar batch). */
  allHosts: Host[]
  config?: PublicHostConfig
  /** Subnet management aktif dari server; default lab hanya untuk test/fallback. */
  net?: MgmtNetwork
}

/** Subnet yang dipakai validasi klien. */
export function mgmtOf(ctx: Context): MgmtNetwork {
  return ctx.net ?? MGMT_NETWORK
}

export function ipUsageFor(ctx: Context): IpUsage {
  const batch = new Set(ctx.hosts.map((h) => h.id))
  const used = new Map<string, string>()
  for (const h of ctx.allHosts) {
    if (batch.has(h.id)) continue
    if (h.currentIp && h.status !== "offline")
      used.set(h.currentIp, `lease ${h.hostname ?? h.mac}`)
    if (h.mgmtIp) used.set(h.mgmtIp, h.hostname ?? h.mac)
  }
  return { used }
}

export function takenHostnames(ctx: Context): Map<string, string> {
  const batch = new Set(ctx.hosts.map((h) => h.id))
  const taken = new Map<string, string>()
  for (const h of ctx.allHosts) {
    if (!batch.has(h.id) && h.hostname) taken.set(h.hostname, h.mac)
  }
  return taken
}

/** Rencana IP per host (bulk dari range/increment, single dari input). */
export function ipPlan(f: NetForm, ctx: Context): IpPlanRow[] {
  const usage = ipUsageFor(ctx)
  // IP host tidak boleh sama dengan gateway payload (CR-3-14), sama dengan API
  // (`config-service.ts`): bentrok host lain tetap diutamakan.
  const gw = f.gateway.trim()
  if (gw && !usage.used.has(gw)) usage.used.set(gw, `gateway ${gw}`)
  if (ctx.hosts.length === 1) {
    const h = ctx.hosts[0]
    const err =
      validateIpAssignments([{ hostId: h.id, ip: f.ip }], usage, mgmtOf(ctx)).get(
        h.id,
      ) ??
      null
    return [{ hostId: h.id, ip: f.ip.trim() || null, error: err }]
  }
  const ids = ctx.hosts.map((h) => h.id)
  return planIps(
    ids,
    f.planKind === "range"
      ? { kind: "range", start: f.start.trim(), end: f.end.trim() }
      : { kind: "increment", start: f.start.trim(), step: f.step },
    usage,
    f.skipUsed,
    mgmtOf(ctx),
  )
}

/** Hostname per host (bulk dari template, single dari input). */
export function hostnamePlan(
  form: FormState,
  dirty: Set<SectionKey>,
  ctx: Context,
): HostnameRow[] {
  const taken = takenHostnames(ctx)
  if (ctx.hosts.length === 1) {
    const h = ctx.hosts[0]
    const name = form.hostname.name.trim().toLowerCase()
    const error =
      validateHostname(name) ??
      (taken.has(name) ? `Sudah dipakai ${taken.get(name)}` : null)
    return [{ hostId: h.id, hostname: name, error }]
  }
  // {ip_last_octet} memakai rencana IP statis bila bagian Network ikut disimpan.
  const planned = new Map<string, string | null>()
  if (dirty.has("network") && form.network.mode === "static") {
    for (const r of ipPlan(form.network, ctx)) planned.set(r.hostId, r.ip)
  }
  return renderHostnames(
    ctx.hosts.map((h) => ({
      id: h.id,
      mac: h.mac,
      ip: planned.get(h.id) ?? h.mgmtIp ?? h.currentIp,
    })),
    form.hostname.template,
    { prefix: form.hostname.prefix, startIndex: form.hostname.startIndex },
    taken,
  )
}

/** Error per bagian (hanya bagian yang akan disimpan yang menghalangi simpan). */
export function sectionErrors(
  form: FormState,
  dirty: Set<SectionKey>,
  ctx: Context,
  csvInvalid: number | null,
): Partial<Record<SectionKey, string[]>> {
  const out: Partial<Record<SectionKey, string[]>> = {}
  const push = (k: SectionKey, msg: string | null) => {
    if (msg) (out[k] ??= []).push(msg)
  }

  const os = form.os
  if (!os.osImageId) push("os", "Pilih OS image")
  if (os.disk && !/^\/dev\/[a-zA-Z0-9/_-]+$/.test(os.disk.trim()))
    push("os", "Path disk harus seperti /dev/sda")
  if (os.partition === "custom" && !os.customStorage.trim())
    push("os", "Isi konfigurasi storage custom")

  const c = form.credentials
  if (c.mode !== "csv") push("credentials", validateUsername(c.username))
  if (c.mode === "same") {
    if (c.password) push("credentials", validatePassword(c.password))
    else if (!(ctx.hosts.length === 1 && ctx.config?.hasPassword))
      push("credentials", "Password wajib diisi")
  }
  if (c.mode === "csv") {
    if (!c.csv.trim()) push("credentials", "Tempel atau unggah CSV")
    else if (csvInvalid === null) push("credentials", "Validasi CSV dulu")
    else if (csvInvalid > 0)
      push("credentials", `${csvInvalid} baris CSV tidak valid`)
  }

  const n = form.network
  if (n.mode === "static") {
    const bad = ipPlan(n, ctx).filter((r) => r.error)
    if (bad.length)
      push(
        "network",
        ctx.hosts.length === 1
          ? bad[0].error
          : `${bad.length} host belum dapat IP valid`,
      )
    // Aturan sama dengan server (DEC-006): prefix = subnet management, gateway di subnet.
    for (const m of validateStaticNetwork(n, mgmtOf(ctx))) push("network", m)
    if (n.dns.length === 0) push("network", "Minimal satu DNS")
    if (n.vlan && !(Number(n.vlan) >= 1 && Number(n.vlan) <= 4094))
      push("network", "VLAN ID 1–4094")
    if (n.ifaceBy === "name" && !/^[a-zA-Z0-9._-]{1,15}$/.test(n.ifaceName))
      push("network", "Nama interface tidak valid")
  }

  const hn = hostnamePlan(form, dirty, ctx).filter((r) => r.error)
  if (hn.length)
    push(
      "hostname",
      ctx.hosts.length === 1
        ? hn[0].error
        : `${hn.length} hostname tidak valid`,
    )

  const s = form.ssh
  if (s.keyIds.length + s.newKeys.length === 0)
    push("ssh", "Pilih atau tambahkan minimal satu key")
  if (s.user.trim()) push("ssh", validateUsername(s.user))
  s.newKeys.forEach((k, i) => {
    if (!k.publicKey.trim()) push("ssh", `Key baru #${i + 1} kosong`)
    else {
      // Key yang gagal di-parse (mis. private key) memblokir simpan agar tidak terkirim (CR-3-5).
      const parsed = parseSshKey(k.publicKey)
      if ("error" in parsed) push("ssh", `Key baru #${i + 1}: ${parsed.error}`)
    }
    if (k.saveToLibrary && !k.name.trim())
      push("ssh", `Key baru #${i + 1}: isi nama`)
  })

  return out
}

export function buildPayload(
  form: FormState,
  dirty: Set<SectionKey>,
  ctx: Context,
): ConfigPayload {
  const p: ConfigPayload = {}
  if (dirty.has("os")) {
    const o = form.os
    p.os = {
      osImageId: o.osImageId,
      disk: o.disk.trim(),
      partition: o.partition,
      customStorage: o.partition === "custom" ? o.customStorage : undefined,
      timezone: o.timezone,
      locale: o.locale,
    }
  }
  if (dirty.has("credentials")) {
    const c = form.credentials
    const flags = { sudo: c.sudo, disableSshPassword: c.disableSshPassword }
    p.credentials =
      c.mode === "same"
        ? {
            mode: "same",
            username: c.username.trim(),
            password: c.password,
            ...flags,
          }
        : c.mode === "random"
          ? {
              mode: "random",
              username: c.username.trim(),
              length: c.length,
              ...flags,
            }
          : { mode: "csv", csv: c.csv, ...flags }
  }
  if (dirty.has("network")) {
    const n = form.network
    p.network =
      n.mode === "dhcp"
        ? { mode: "dhcp" }
        : {
            mode: "static",
            assignments: Object.fromEntries(
              ipPlan(n, ctx).map((r) => [r.hostId, r.ip ?? ""]),
            ),
            prefix: n.prefix,
            gateway: n.gateway.trim(),
            dns: n.dns,
            vlan: n.vlan ? Number(n.vlan) : null,
            iface:
              n.ifaceBy === "mac"
                ? { by: "mac" }
                : { by: "name", name: n.ifaceName.trim() },
          }
  }
  if (dirty.has("hostname")) {
    p.hostname = {
      assignments: Object.fromEntries(
        hostnamePlan(form, dirty, ctx).map((r) => [r.hostId, r.hostname]),
      ),
    }
  }
  if (dirty.has("ssh")) {
    p.ssh = {
      keyIds: form.ssh.keyIds,
      // Pertahanan berlapis: private key tidak pernah ikut payload walau validasi terlewati.
      newKeys: form.ssh.newKeys
        .filter((k) => !k.publicKey.includes("PRIVATE KEY"))
        .map((k) => ({ ...k, name: k.name.trim() })),
      user: form.ssh.user.trim(),
    }
  }
  return p
}
