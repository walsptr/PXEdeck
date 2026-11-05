// Konfigurasi server dari env (M4-T1, DEC-006/DEC-009). Satu sumber untuk
// subnet management, URL dasar, path media/TFTP, file dnsmasq, TTL token, dsb.
// Hanya untuk kode server (membaca process.env). Browser memperoleh nilai
// non-rahasia lewat `GET /api/settings` (`toSettingsResponse`).
//
// Fail fast: env yang tidak valid → Error yang menyebut nama variabelnya.
// `getSettings()` membaca ulang env tiap panggilan (di-cache per kombinasi
// nilai) supaya test bisa mengganti env tanpa reload modul.
import { z } from "zod"

import {
  inSubnet,
  ipToInt,
  isIpv4,
  mgmtNetworkFromEnv,
  parseCidr,
  type MgmtNetwork,
  type NetworkResponse,
  toNetworkResponse,
} from "@/lib/net"

export type SeedName = "empty" | "demo"
export type UnknownHostAction = "local" | "wait"

export type Settings = {
  network: MgmtNetwork
  /** Nama NIC tempat dnsmasq melayani DHCP (hanya tampilan). */
  dhcpInterface: string
  /** URL dasar dashboard/boot untuk client PXE, tanpa "/" di akhir. */
  baseUrl: string
  /** URL dasar media instalasi (nginx statis), tanpa "/" di akhir. */
  mediaUrl: string
  /** Path media di server (juga root NFS Ubuntu). */
  mediaRoot: string
  tftpRoot: string
  /** File lease dnsmasq; null = tidak dikonfigurasi (mode dev). */
  dnsmasqLeases: string | null
  /** Pidfile dnsmasq; null = status DHCP/TFTP "unknown". */
  dnsmasqPidfile: string | null
  /** true = percaya `X-Real-IP` (hanya di belakang nginx lokal). */
  trustProxy: boolean
  tokenTtlMin: number
  unknownHostAction: UnknownHostAction
  /** Argumen kernel tambahan untuk installer (mis. console serial). */
  kernelExtraArgs: string
  dbPath: string
  seed: SeedName
  /** Header Host yang diterima untuk request mutasi (SR-3-5). */
  allowedHosts: string[]
}

export type SettingsEnv = Record<string, string | undefined>

const KERNEL_ARGS_RE = /^[A-Za-z0-9 ,._=:/@+-]*$/
const PATH_RE = /^\/[A-Za-z0-9._/-]*$/
const HOSTNAME_RE = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?$/

function fail(msg: string): never {
  throw new Error(`Konfigurasi server tidak valid: ${msg}`)
}

function str(env: SettingsEnv, key: string): string | undefined {
  return env[key]?.trim() || undefined
}

function httpUrl(key: string, raw: string): string {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return fail(`${key} "${raw}" bukan URL`)
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    fail(`${key} harus http:// atau https://`)
  if (u.search || u.hash || u.username || u.password)
    fail(`${key} tidak boleh memuat query, fragment, atau kredensial`)
  if (!/^[A-Za-z0-9.:/_[\]-]+$/.test(u.href))
    fail(`${key} memuat karakter yang tidak diizinkan`)
  return u.href.replace(/\/+$/, "")
}

function absPath(key: string, raw: string): string {
  if (!PATH_RE.test(raw) || raw.split("/").includes(".."))
    fail(`${key} "${raw}" harus path absolut tanpa ".."`)
  return raw.replace(/\/+$/, "") || "/"
}

const intSchema = z.coerce.number().int()

/**
 * Bangun `Settings` dari env (fungsi murni). Default = lab asli
 * (`10.10.10.0/24`, docs/design/M4-plan.md §2.1).
 */
export function settingsFromEnv(env: SettingsEnv): Settings {
  // PXE_DHCP_RANGE (nama M4) diutamakan; PXE_DYNAMIC_RANGE (M3) tetap diterima.
  const rangeKey = str(env, "PXE_DHCP_RANGE")
    ? "PXE_DHCP_RANGE"
    : "PXE_DYNAMIC_RANGE"
  let network: MgmtNetwork
  try {
    network = mgmtNetworkFromEnv({
      PXE_MGMT_CIDR: env.PXE_MGMT_CIDR,
      PXE_MGMT_GATEWAY: env.PXE_MGMT_GATEWAY,
      PXE_MGMT_DNS: env.PXE_MGMT_DNS,
      PXE_DYNAMIC_RANGE: env[rangeKey],
      PXE_SERVER_IP: env.PXE_SERVER_IP,
    })
  } catch (e) {
    throw new Error(
      (e as Error).message.replaceAll("PXE_DYNAMIC_RANGE", rangeKey),
    )
  }
  const { cidr, gateway, pxeServer, dynamicRange } = network
  for (const d of network.dns) {
    if (!inSubnet(d, cidr))
      fail(`DNS ${d} (PXE_MGMT_DNS) di luar subnet ${cidr}`)
  }
  const [lo, hi] = dynamicRange.map(ipToInt)
  for (const [ip, what] of [
    [gateway, "gateway"],
    [pxeServer, "PXE server"],
  ] as const) {
    const n = ipToInt(ip)
    if (n >= lo && n <= hi)
      fail(`${rangeKey} ${dynamicRange[0]}–${dynamicRange[1]} memuat ${what} ${ip}`)
  }

  const baseUrl = httpUrl(
    "PXE_BASE_URL",
    str(env, "PXE_BASE_URL") ?? `http://${pxeServer}`,
  )
  const mediaUrl = httpUrl(
    "PXE_MEDIA_URL",
    str(env, "PXE_MEDIA_URL") ?? `${baseUrl}/media`,
  )
  const mediaRoot = absPath(
    "PXE_MEDIA_ROOT",
    str(env, "PXE_MEDIA_ROOT") ?? "/srv/pxe/media",
  )
  const tftpRoot = absPath(
    "PXE_TFTP_ROOT",
    str(env, "PXE_TFTP_ROOT") ?? "/srv/pxe/tftp",
  )
  const leases = str(env, "PXE_DNSMASQ_LEASES")
  const pidfile = str(env, "PXE_DNSMASQ_PIDFILE")

  const iface = str(env, "PXE_DHCP_INTERFACE") ?? "enp7s0"
  if (!/^[A-Za-z0-9._-]{1,15}$/.test(iface))
    fail(`PXE_DHCP_INTERFACE "${iface}" bukan nama interface`)

  const trustRaw = (str(env, "PXE_TRUST_PROXY") ?? "0").toLowerCase()
  if (!["0", "1", "true", "false"].includes(trustRaw))
    fail(`PXE_TRUST_PROXY harus 0 atau 1`)

  const ttl = intSchema.safeParse(str(env, "PXE_TOKEN_TTL_MIN") ?? "360")
  if (!ttl.success || ttl.data < 5 || ttl.data > 7 * 24 * 60)
    fail(`PXE_TOKEN_TTL_MIN harus bilangan bulat 5–10080 (menit)`)

  const action = (str(env, "PXE_UNKNOWN_HOST_ACTION") ?? "local").toLowerCase()
  if (action !== "local" && action !== "wait")
    fail(`PXE_UNKNOWN_HOST_ACTION harus "local" atau "wait"`)

  const extra = env.PXE_KERNEL_EXTRA_ARGS?.trim() ?? ""
  if (!KERNEL_ARGS_RE.test(extra) || extra.length > 512)
    fail(`PXE_KERNEL_EXTRA_ARGS memuat karakter yang tidak diizinkan`)

  const production = env.NODE_ENV === "production"
  const seed = (str(env, "PXE_SEED") ?? "empty").toLowerCase()
  if (seed !== "empty" && seed !== "demo")
    fail(`PXE_SEED harus "empty" atau "demo"`)
  if (seed === "demo" && production)
    fail(`PXE_SEED=demo tidak diizinkan saat NODE_ENV=production`)

  const dbPath =
    str(env, "PXE_DB_PATH") ?? (env.VITEST ? ":memory:" : "./data/pxe.db")

  const allowedRaw = str(env, "PXE_ALLOWED_HOSTS")
  const allowedHosts = allowedRaw
    ? allowedRaw
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
    : [
        "localhost",
        "127.0.0.1",
        "[::1]",
        pxeServer,
        new URL(baseUrl).host.toLowerCase(),
      ]
  for (const h of allowedHosts) {
    if (!HOSTNAME_RE.test(h))
      fail(`PXE_ALLOWED_HOSTS memuat entri tidak valid "${h}"`)
  }

  return {
    network,
    dhcpInterface: iface,
    baseUrl,
    mediaUrl,
    mediaRoot,
    tftpRoot,
    dnsmasqLeases: leases ? absPath("PXE_DNSMASQ_LEASES", leases) : null,
    dnsmasqPidfile: pidfile ? absPath("PXE_DNSMASQ_PIDFILE", pidfile) : null,
    trustProxy: trustRaw === "1" || trustRaw === "true",
    tokenTtlMin: ttl.data,
    unknownHostAction: action,
    kernelExtraArgs: extra,
    dbPath,
    seed,
    allowedHosts: [...new Set(allowedHosts)],
  }
}

/** Nama env yang memengaruhi `getSettings()` (kunci cache). */
export const SETTINGS_ENV_KEYS = [
  "PXE_MGMT_CIDR",
  "PXE_MGMT_GATEWAY",
  "PXE_MGMT_DNS",
  "PXE_DHCP_RANGE",
  "PXE_DYNAMIC_RANGE",
  "PXE_SERVER_IP",
  "PXE_DHCP_INTERFACE",
  "PXE_BASE_URL",
  "PXE_MEDIA_URL",
  "PXE_MEDIA_ROOT",
  "PXE_TFTP_ROOT",
  "PXE_DNSMASQ_LEASES",
  "PXE_DNSMASQ_PIDFILE",
  "PXE_TRUST_PROXY",
  "PXE_TOKEN_TTL_MIN",
  "PXE_UNKNOWN_HOST_ACTION",
  "PXE_KERNEL_EXTRA_ARGS",
  "PXE_DB_PATH",
  "PXE_SEED",
  "PXE_ALLOWED_HOSTS",
  "NODE_ENV",
  "VITEST",
] as const

let cache: { key: string; settings: Settings } | null = null

/** Settings aktif dari `process.env` (lihat `settingsFromEnv`). */
export function getSettings(): Settings {
  const env: SettingsEnv = {}
  for (const k of SETTINGS_ENV_KEYS) env[k] = process.env[k]
  const key = JSON.stringify(env)
  if (cache?.key !== key) cache = { key, settings: settingsFromEnv(env) }
  return cache.settings
}

/** Bentuk `GET /api/settings`: nilai non-rahasia (tanpa path DB/seed). */
export type SettingsResponse = NetworkResponse & {
  interface: string
  baseUrl: string
  mediaUrl: string
  tftpRoot: string
  tokenTtlMin: number
  unknownHostAction: UnknownHostAction
}

export function toSettingsResponse(s: Settings): SettingsResponse {
  return {
    ...toNetworkResponse(s.network),
    interface: s.dhcpInterface,
    baseUrl: s.baseUrl,
    mediaUrl: s.mediaUrl,
    tftpRoot: s.tftpRoot,
    tokenTtlMin: s.tokenTtlMin,
    unknownHostAction: s.unknownHostAction,
  }
}

/** Prefix subnet management aktif. */
export function mgmtPrefix(s: Settings = getSettings()): number {
  return parseCidr(s.network.cidr).prefix
}

/** true bila `ip` IPv4 valid (re-export kecil untuk modul server). */
export { isIpv4 }
