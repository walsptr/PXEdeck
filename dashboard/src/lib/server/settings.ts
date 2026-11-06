// Konfigurasi server dari env (M4-T1, DEC-006/DEC-009). Satu sumber untuk
// subnet management, URL dasar, path media/TFTP, file dnsmasq, TTL token, dsb.
// Hanya untuk kode server (membaca process.env). Browser memperoleh nilai
// non-rahasia lewat `GET /api/settings` (`toSettingsResponse`).
//
// Fail fast: env yang tidak valid → Error yang menyebut nama variabelnya.
// `getSettings()` membaca ulang env tiap panggilan (di-cache per kombinasi
// nilai) supaya test bisa mengganti env tanpa reload modul.
import { z } from "zod"

import { passwordHashProblem } from "@/lib/server/auth/password"
import {
  ipToInt,
  isIpv4,
  mgmtNetworkFromEnv,
  parseCidr,
  type MgmtNetwork,
  type NetworkResponse,
  toNetworkResponse,
  vlanNetworksFromEnv,
  type VlanNetwork,
} from "@/lib/net"

export type SeedName = "empty" | "demo"
export type UnknownHostAction = "local" | "wait"

export type Settings = {
  network: MgmtNetwork
  /**
   * VLAN management terdaftar (M7, DEC-024 §4, `PXE_VLAN_NETWORKS`); `[]` = tidak ada (aturan
   * DEC-006 untuk semua IP statis).
   */
  vlanNetworks: VlanNetwork[]
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
  /** Header Host yang diterima untuk semua request API (SR-3-5, DEC-015). */
  allowedHosts: string[]
  /** Timeout absolut per tahap job (menit, DEC-014 §2). */
  jobTimeouts: JobTimeouts
  /** Maks. penyajian script installer per job (CR-4-1, DEC-014 §1). */
  maxInstallerBoots: number
  /** Interval timer watchdog in-process (detik). */
  watchdogIntervalSec: number
  /** Batas event per job (DEC-014 §3). */
  jobLogMaxEvents: number
  /** Jumlah job final yang disimpan per host (DEC-014 §3). */
  jobHistoryPerHost: number
  /**
   * HANYA dev: izinkan trust proxy tanpa file lease dnsmasq dan terbitkan
   * installer tanpa verifikasi lease (DEC-013). Diperingatkan saat start.
   */
  insecureNoLeaseCheck: boolean
  /**
   * `NODE_ENV=production` + `PXE_INSECURE_NO_LEASE_CHECK=1` dikonfirmasi dengan frasa literal
   * `PXE_INSECURE_NO_LEASE_CHECK_CONFIRM` (SR-5-4, DEC-016 §2, DEC-017 §7).
   */
  insecureConfirmed: boolean
  /** Admin tunggal (DEC-017 §3); null = belum dikonfigurasi (hanya non-production). */
  admin: AdminCredential | null
  auth: AuthSettings
}

/** Kredensial admin dari env. `passwordHash` TIDAK PERNAH masuk log/respons API. */
export type AdminCredential = { username: string; passwordHash: string }

export type AuthSettings = {
  /** Idle maksimum sesi (menit, geser). */
  sessionIdleMin: number
  /** Umur absolut sesi (jam). */
  sessionMaxHours: number
  /** Login gagal per (IP, username) per jendela; per IP = 4× nilai ini. */
  loginMaxFailures: number
  loginWindowMin: number
  /** Request API per sesi per 60 dtk. */
  apiRatePerMin: number
}

export type JobTimeouts = {
  bootingMin: number
  installingMin: number
  configuringMin: number
}

export type SettingsEnv = Record<string, string | undefined>

/** Karakter URL yang diterima settings (⊂ `SAFE_RE` di boot-script.ts, CR-4-10). */
export const URL_SAFE_RE = /^[A-Za-z0-9.:/_-]+$/
const KERNEL_ARGS_RE = /^[A-Za-z0-9 ,._=:/@+-]*$/
const PATH_RE = /^\/[A-Za-z0-9._/-]*$/
const ADMIN_USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/
/** Frasa konfirmasi literal SR-5-4 (DEC-016 §2). */
export const INSECURE_CONFIRM_PHRASE = "I_UNDERSTAND_CONFIG_LEAKS"
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
  // CR-4-10: literal IPv6 (`[..]`) tidak aman untuk script iPXE (`ipxeSafe`).
  if (u.hostname.startsWith("[") || u.href.includes("[") || u.href.includes("]"))
    fail(`${key} tidak boleh memakai literal IPv6 ([…]); pakai IPv4 atau nama host`)
  // Subset ketat dari karakter yang lolos `ipxeSafe` (boot-script.ts).
  if (!URL_SAFE_RE.test(u.href))
    fail(`${key} memuat karakter yang tidak diizinkan`)
  return u.href.replace(/\/+$/, "")
}

function absPath(key: string, raw: string): string {
  if (!PATH_RE.test(raw) || raw.split("/").includes(".."))
    fail(`${key} "${raw}" harus path absolut tanpa ".."`)
  return raw.replace(/\/+$/, "") || "/"
}

const intSchema = z.coerce.number().int()

/** Bilangan bulat env dalam [min, max]; kosong → `def`. */
function intEnv(env: SettingsEnv, key: string, def: number, min: number, max: number): number {
  const raw = str(env, key)
  if (raw === undefined) return def
  const v = intSchema.safeParse(raw)
  if (!/^-?\d+$/.test(raw) || !v.success || v.data < min || v.data > max)
    fail(`${key} harus bilangan bulat ${min}–${max}`)
  return v.data
}

/** Flag 0/1/true/false; kosong → false. */
function flagEnv(env: SettingsEnv, key: string): boolean {
  const raw = (str(env, key) ?? "0").toLowerCase()
  if (!["0", "1", "true", "false"].includes(raw)) fail(`${key} harus 0 atau 1`)
  return raw === "1" || raw === "true"
}

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
  const { gateway, pxeServer, dynamicRange } = network
  let vlanNetworks: VlanNetwork[]
  try {
    vlanNetworks = vlanNetworksFromEnv(env.PXE_VLAN_NETWORKS, network.cidr)
  } catch (e) {
    return fail((e as Error).message)
  }
  // DNS tidak terikat subnet (DEC-011); format + alamat khusus sudah divalidasi
  // `mgmtNetworkFromEnv`. Gateway & PXE server tetap wajib di subnet (DEC-006).
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

  const trustProxy = flagEnv(env, "PXE_TRUST_PROXY")
  const insecureNoLeaseCheck = flagEnv(env, "PXE_INSECURE_NO_LEASE_CHECK")
  // SR-4-2 / DEC-013: binding IP fail-closed. Di belakang proxy tanpa file
  // lease, `current_ip` bisa diisi IP peminta mana pun → tolak start.
  if (trustProxy && !leases && !insecureNoLeaseCheck)
    fail(
      "PXE_TRUST_PROXY=1 membutuhkan PXE_DNSMASQ_LEASES (verifikasi IP lease, DEC-013); " +
        "khusus dev: set PXE_INSECURE_NO_LEASE_CHECK=1",
    )

  const ttl = intEnv(env, "PXE_TOKEN_TTL_MIN", 360, 5, 7 * 24 * 60)
  const jobTimeouts: JobTimeouts = {
    bootingMin: intEnv(env, "PXE_JOB_BOOTING_TIMEOUT_MIN", 60, 1, 1440),
    installingMin: intEnv(env, "PXE_JOB_INSTALLING_TIMEOUT_MIN", 120, 1, 1440),
    configuringMin: intEnv(env, "PXE_JOB_CONFIGURING_TIMEOUT_MIN", 60, 1, 1440),
  }
  const stageSum =
    jobTimeouts.bootingMin + jobTimeouts.installingMin + jobTimeouts.configuringMin
  // DEC-014 §2: token tidak boleh kedaluwarsa sebelum watchdog memutuskan.
  if (ttl < stageSum)
    fail(
      `PXE_TOKEN_TTL_MIN (${ttl}) harus ≥ jumlah timeout tahap job (${stageSum} menit: ` +
        "PXE_JOB_BOOTING/INSTALLING/CONFIGURING_TIMEOUT_MIN)",
    )

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

  // SR-5-4 / DEC-016 §2: production + flag insecure butuh konfirmasi kedua (nilai mentah, tanpa
  // trim — frasa berspasi/beda huruf ditolak).
  const insecureConfirmed =
    insecureNoLeaseCheck && env.PXE_INSECURE_NO_LEASE_CHECK_CONFIRM === INSECURE_CONFIRM_PHRASE
  if (production && insecureNoLeaseCheck && !insecureConfirmed)
    fail(
      "PXE_INSECURE_NO_LEASE_CHECK=1 di NODE_ENV=production membutuhkan " +
        `PXE_INSECURE_NO_LEASE_CHECK_CONFIRM=${INSECURE_CONFIRM_PHRASE} (file konfigurasi installer ` +
        "bisa diambil siapa pun di LAN; DEC-016 §2)",
    )

  const admin = adminFromEnv(env, production)
  const auth: AuthSettings = {
    sessionIdleMin: intEnv(env, "PXE_SESSION_IDLE_MIN", 120, 1, 1440),
    sessionMaxHours: intEnv(env, "PXE_SESSION_MAX_HOURS", 12, 1, 168),
    loginMaxFailures: intEnv(env, "PXE_LOGIN_MAX_FAILURES", 5, 3, 100),
    loginWindowMin: intEnv(env, "PXE_LOGIN_WINDOW_MIN", 15, 1, 1440),
    apiRatePerMin: intEnv(env, "PXE_API_RATE_PER_MIN", 600, 60, 10_000),
  }

  return {
    network,
    vlanNetworks,
    dhcpInterface: iface,
    baseUrl,
    mediaUrl,
    mediaRoot,
    tftpRoot,
    dnsmasqLeases: leases ? absPath("PXE_DNSMASQ_LEASES", leases) : null,
    dnsmasqPidfile: pidfile ? absPath("PXE_DNSMASQ_PIDFILE", pidfile) : null,
    trustProxy,
    tokenTtlMin: ttl,
    unknownHostAction: action,
    kernelExtraArgs: extra,
    dbPath,
    seed,
    allowedHosts: [...new Set(allowedHosts)],
    jobTimeouts,
    maxInstallerBoots: intEnv(env, "PXE_JOB_MAX_INSTALLER_BOOTS", 3, 1, 10),
    watchdogIntervalSec: intEnv(env, "PXE_WATCHDOG_INTERVAL_SEC", 30, 5, 600),
    jobLogMaxEvents: intEnv(env, "PXE_JOB_LOG_MAX_EVENTS", 5000, 100, 100_000),
    jobHistoryPerHost: intEnv(env, "PXE_JOB_HISTORY_PER_HOST", 20, 1, 1000),
    insecureNoLeaseCheck,
    insecureConfirmed,
    admin,
    auth,
  }
}

/**
 * Admin dari `PXE_ADMIN_USERNAME` + `PXE_ADMIN_PASSWORD_HASH` (DEC-017 §3). Nilai yang diisi tetapi
 * tidak valid → error (semua mode). Keduanya/salah satunya kosong → production: error (tolak
 * start); non-production: null (login selalu gagal, semua API 401 — tanpa kredensial default).
 * Pesan error tidak pernah memuat nilai hash.
 */
function adminFromEnv(env: SettingsEnv, production: boolean): AdminCredential | null {
  const username = str(env, "PXE_ADMIN_USERNAME")
  const passwordHash = str(env, "PXE_ADMIN_PASSWORD_HASH")
  if (username !== undefined && !ADMIN_USERNAME_RE.test(username))
    fail("PXE_ADMIN_USERNAME harus cocok ^[a-z_][a-z0-9_-]{0,31}$")
  if (passwordHash !== undefined) {
    const problem = passwordHashProblem(passwordHash)
    if (problem) fail(`PXE_ADMIN_PASSWORD_HASH ${problem}`)
  }
  if (username === undefined || passwordHash === undefined) {
    if (production)
      fail(
        "NODE_ENV=production membutuhkan PXE_ADMIN_USERNAME dan PXE_ADMIN_PASSWORD_HASH " +
          "(buat hash dengan `npm run admin:hash`; tidak ada kredensial default)",
      )
    return null
  }
  return { username, passwordHash }
}

/**
 * Peringatan konfigurasi yang tidak menghentikan start (dicatat sekali saat
 * start, `instrumentation.ts`). Satu baris per peringatan.
 */
export function settingsWarnings(s: Settings): string[] {
  const out: string[] = []
  if (s.insecureNoLeaseCheck)
    out.push(
      "PERINGATAN: PXE_INSECURE_NO_LEASE_CHECK=1 — verifikasi IP lease dnsmasq dimatikan; " +
        "script installer & file konfigurasi dilayani tanpa binding lease (HANYA untuk dev, DEC-013)",
    )
  return out
}

/**
 * Peringatan autentikasi saat start (M6, DEC-017 §3): non-production tanpa admin → satu baris
 * (production tanpa admin sudah ditolak `settingsFromEnv`). Tanpa nilai hash.
 */
export function authWarnings(s: Settings): string[] {
  return s.admin
    ? []
    : [
        "PERINGATAN: admin belum dikonfigurasi (PXE_ADMIN_USERNAME + PXE_ADMIN_PASSWORD_HASH, " +
          "buat hash dengan `npm run admin:hash`) — semua login ditolak dan semua API membalas 401",
      ]
}

/**
 * SR-6-3 / CR-6-6 (DEC-022 §3): production tanpa `PXE_TRUST_PROXY=1` → IP klien tidak diketahui
 * (`X-Real-IP` diabaikan), sehingga batas login per IP (`PXE_LOGIN_MAX_FAILURES`, 20/IP) berlaku
 * GLOBAL untuk semua klien: satu pihak bisa mengunci login admin selama `PXE_LOGIN_WINDOW_MIN`.
 * Peringatan saja (start tidak ditolak); deploy rujukan memakai nginx + `PXE_TRUST_PROXY=1`.
 */
export function trustProxyWarnings(s: Settings, nodeEnv: string | undefined = process.env.NODE_ENV): string[] {
  if (nodeEnv !== "production" || s.trustProxy) return []
  return [
    "peringatan: NODE_ENV=production tanpa PXE_TRUST_PROXY=1 — IP klien tidak diketahui, batas login " +
      "per IP berlaku global untuk semua klien (satu pihak dapat mengunci login admin selama " +
      `${s.auth.loginWindowMin} menit); jalankan di belakang nginx (infra/server/nginx-pxe.conf) dengan ` +
      "PXE_TRUST_PROXY=1",
  ]
}

/** Nama env yang memengaruhi `getSettings()` (kunci cache). */
export const SETTINGS_ENV_KEYS = [
  "PXE_MGMT_CIDR",
  "PXE_MGMT_GATEWAY",
  "PXE_MGMT_DNS",
  "PXE_DHCP_RANGE",
  "PXE_DYNAMIC_RANGE",
  "PXE_SERVER_IP",
  "PXE_VLAN_NETWORKS",
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
  "PXE_JOB_BOOTING_TIMEOUT_MIN",
  "PXE_JOB_INSTALLING_TIMEOUT_MIN",
  "PXE_JOB_CONFIGURING_TIMEOUT_MIN",
  "PXE_JOB_MAX_INSTALLER_BOOTS",
  "PXE_WATCHDOG_INTERVAL_SEC",
  "PXE_JOB_LOG_MAX_EVENTS",
  "PXE_JOB_HISTORY_PER_HOST",
  "PXE_INSECURE_NO_LEASE_CHECK",
  "PXE_INSECURE_NO_LEASE_CHECK_CONFIRM",
  "PXE_ADMIN_USERNAME",
  "PXE_ADMIN_PASSWORD_HASH",
  "PXE_SESSION_IDLE_MIN",
  "PXE_SESSION_MAX_HOURS",
  "PXE_LOGIN_MAX_FAILURES",
  "PXE_LOGIN_WINDOW_MIN",
  "PXE_API_RATE_PER_MIN",
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

/**
 * Bentuk `GET /api/settings`: nilai non-rahasia (tanpa path DB/seed). `vlanNetworks` (M7) ikut dari
 * `NetworkResponse` dan hanya ada bila `PXE_VLAN_NETWORKS` berisi entri.
 */
export type SettingsResponse = NetworkResponse & {
  interface: string
  baseUrl: string
  mediaUrl: string
  tftpRoot: string
  tokenTtlMin: number
  unknownHostAction: UnknownHostAction
  jobTimeouts: JobTimeouts
  maxInstallerBoots: number
  insecureNoLeaseCheck: boolean
  /** SR-5-4: flag insecure aktif DAN dikonfirmasi frasa (production). */
  insecureConfirmed: boolean
  /** Blok "Akses" Settings (M6). Tanpa hash password dalam bentuk apa pun. */
  auth: AuthResponse
}

export type AuthResponse = {
  adminUsername: string | null
  adminConfigured: boolean
  sessionIdleMin: number
  sessionMaxHours: number
  loginMaxFailures: number
  loginWindowMin: number
  apiRatePerMin: number
}

export function toSettingsResponse(s: Settings): SettingsResponse {
  return {
    ...toNetworkResponse(s.network, s.vlanNetworks),
    interface: s.dhcpInterface,
    baseUrl: s.baseUrl,
    mediaUrl: s.mediaUrl,
    tftpRoot: s.tftpRoot,
    tokenTtlMin: s.tokenTtlMin,
    unknownHostAction: s.unknownHostAction,
    jobTimeouts: { ...s.jobTimeouts },
    maxInstallerBoots: s.maxInstallerBoots,
    insecureNoLeaseCheck: s.insecureNoLeaseCheck,
    insecureConfirmed: s.insecureConfirmed,
    auth: {
      adminUsername: s.admin?.username ?? null,
      adminConfigured: s.admin !== null,
      sessionIdleMin: s.auth.sessionIdleMin,
      sessionMaxHours: s.auth.sessionMaxHours,
      loginMaxFailures: s.auth.loginMaxFailures,
      loginWindowMin: s.auth.loginWindowMin,
      apiRatePerMin: s.auth.apiRatePerMin,
    },
  }
}

/** Prefix subnet management aktif. */
export function mgmtPrefix(s: Settings = getSettings()): number {
  return parseCidr(s.network.cidr).prefix
}

/** true bila `ip` IPv4 valid (re-export kecil untuk modul server). */
export { isIpv4 }
