// Utilitas IPv4 + parameter jaringan management. Dipakai form (preview) dan
// server (validasi). Modul ini murni (tanpa process.env) sehingga aman
// di-import di browser. Nilai default mengikuti scripts/pxe-nodes; server
// membaca override env lewat src/lib/server/net-config.ts (DEC-006), tahap 4
// memindahkannya ke Settings.

/** Parameter subnet management (satu sumber untuk validasi IP statis). */
export type MgmtNetwork = {
  /** CIDR ternormalisasi, mis. "10.10.10.0/24". */
  cidr: string
  gateway: string
  dns: readonly string[]
  pxeServer: string
  /** Range DHCP dinamis dnsmasq: IP statis tidak boleh di sini. */
  dynamicRange: readonly [string, string]
}

/**
 * Jaringan VLAN management terdaftar (M7, DEC-024 §4, env `PXE_VLAN_NETWORKS`). IP statis dengan
 * `vlan` = `vlan` di sini divalidasi terhadap `cidr` ini, bukan subnet PXE (perluasan DEC-006).
 */
export type VlanNetwork = {
  /** VLAN ID 1–4094 (unik di daftar). */
  vlan: number
  /** CIDR ternormalisasi ke alamat network, mis. "10.99.20.0/24". */
  cidr: string
  prefix: number
  /** Gateway VLAN (host di `cidr`). */
  gateway: string
}

/** Target validasi IP statis: subnet management (DEC-006) atau VLAN terdaftar (DEC-024). */
export type StaticNetwork = MgmtNetwork | VlanNetwork

export function isVlanNetwork(n: StaticNetwork): n is VlanNetwork {
  return typeof (n as VlanNetwork).vlan === "number"
}

/** Label subnet untuk pesan: "10.99.20.0/24 (VLAN 20)" atau CIDR management apa adanya. */
function subnetLabel(n: StaticNetwork): string {
  return isVlanNetwork(n) ? `${n.cidr} (VLAN ${n.vlan})` : n.cidr
}

/**
 * Jaringan yang berlaku untuk IP statis ber-`vlan` (DEC-024 §4): VLAN terdaftar → jaringan VLAN
 * itu; `vlan` null/undefined atau tidak terdaftar → subnet management (aturan DEC-006 apa adanya).
 */
export function resolveStaticNetwork(
  vlan: number | null | undefined,
  mgmt: MgmtNetwork,
  vlanNetworks: readonly VlanNetwork[] = [],
): StaticNetwork {
  if (vlan === null || vlan === undefined) return mgmt
  return vlanNetworks.find((v) => v.vlan === vlan) ?? mgmt
}

/** Default lab (scripts/pxe-nodes). Dipakai form di browser. */
export const MGMT_NETWORK: MgmtNetwork = {
  cidr: "10.10.10.0/24",
  gateway: "10.10.10.1",
  dns: ["10.10.10.1"],
  pxeServer: "10.10.10.1",
  dynamicRange: ["10.10.10.100", "10.10.10.200"] as const,
}

const IPV4_RE =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function isIpv4(s: string): boolean {
  return IPV4_RE.test(s.trim())
}

export function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => acc * 256 + Number(o), 0)
}

export function intToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".")
}

export function parseCidr(cidr: string): { network: number; prefix: number } {
  const [ip, p] = cidr.split("/")
  const prefix = Number(p)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return { network: (ipToInt(ip) & mask) >>> 0, prefix }
}

export function subnetBounds(cidr: string) {
  const { network, prefix } = parseCidr(cidr)
  const size = 2 ** (32 - prefix)
  return { network, broadcast: network + size - 1, prefix }
}

export function inSubnet(ip: string, cidr: string): boolean {
  const { network, broadcast } = subnetBounds(cidr)
  const n = ipToInt(ip)
  return n >= network && n <= broadcast
}

/**
 * Validasi alamat server DNS (DEC-011): cukup IPv4 valid yang bukan alamat
 * khusus — 0.0.0.0/8 ("this network"), loopback 127/8, multicast 224/4, dan
 * 240/4 (reserved, termasuk broadcast 255.255.255.255). Tidak terikat subnet
 * management (DNS publik lewat gateway NAT sah). Mengembalikan pesan error
 * atau null.
 */
export function dnsAddressError(ip: string): string | null {
  const v = ip.trim()
  if (!isIpv4(v)) return `DNS tidak valid: ${ip}`
  const first = Number(v.split(".")[0])
  if (first === 0) return `DNS ${v} adalah alamat "this network" (0.0.0.0/8)`
  if (first === 127) return `DNS ${v} adalah alamat loopback`
  if (first >= 224 && first <= 239) return `DNS ${v} adalah alamat multicast`
  if (v === "255.255.255.255") return `DNS ${v} adalah alamat broadcast`
  if (first >= 240) return `DNS ${v} adalah alamat reserved (240.0.0.0/4)`
  return null
}

/** `a.b.c.d/p` dengan IPv4 valid dan prefix 0–32. */
export function isCidr(s: string): boolean {
  const m = /^([^/]+)\/(\d{1,2})$/.exec(s.trim())
  return Boolean(m && isIpv4(m[1]) && Number(m[2]) <= 32)
}

/** Host usable (bukan network/broadcast) di dalam subnet. */
export function isHostInSubnet(ip: string, cidr: string): boolean {
  if (!isIpv4(ip) || !inSubnet(ip, cidr)) return false
  const { network, broadcast } = subnetBounds(cidr)
  const n = ipToInt(ip)
  return n !== network && n !== broadcast
}

function inRange(ip: string, [lo, hi]: readonly [string, string]): boolean {
  const n = ipToInt(ip)
  return n >= ipToInt(lo) && n <= ipToInt(hi)
}

function resolveNet(
  net: string | StaticNetwork | undefined,
): StaticNetwork {
  if (net === undefined) return MGMT_NETWORK
  return typeof net === "string" ? { ...MGMT_NETWORK, cidr: net } : net
}

/**
 * Validasi parameter jaringan statis bersama (DEC-006): prefix wajib sama
 * dengan subnet management, gateway wajib IPv4 host di subnet management
 * dan di luar range DHCP dinamis, DNS wajib IPv4 bukan alamat khusus
 * (`dnsAddressError`, boleh di luar subnet — DEC-011). Mengembalikan daftar
 * pesan error.
 */
export function validateStaticNetwork(
  v: { prefix: number; gateway: string; dns: readonly string[] },
  net: StaticNetwork = MGMT_NETWORK,
): string[] {
  if (isVlanNetwork(net)) return validateVlanStaticNetwork(v, net)
  const errors: string[] = []
  const { prefix } = parseCidr(net.cidr)
  if (v.prefix !== prefix) {
    errors.push(
      `Prefix /${v.prefix} tidak sesuai subnet management ${net.cidr} (harus /${prefix})`,
    )
  }
  const gw = v.gateway.trim()
  if (!isIpv4(gw)) errors.push("Gateway tidak valid")
  else if (!isHostInSubnet(gw, net.cidr))
    errors.push(`Gateway ${gw} di luar subnet management ${net.cidr}`)
  else if (inRange(gw, net.dynamicRange))
    errors.push(
      `Gateway ${gw} di dalam range DHCP dinamis ${net.dynamicRange[0]}–${net.dynamicRange[1]}`,
    )
  for (const d of v.dns) {
    const err = dnsAddressError(d)
    if (err) errors.push(err)
  }
  return errors
}

/**
 * `validateStaticNetwork` untuk VLAN terdaftar (DEC-024 §4): prefix = prefix CIDR VLAN, gateway
 * payload host di CIDR VLAN (tanpa aturan range DHCP — VLAN management tanpa DHCP dashboard), DNS
 * sama dengan DEC-011.
 */
function validateVlanStaticNetwork(
  v: { prefix: number; gateway: string; dns: readonly string[] },
  net: VlanNetwork,
): string[] {
  const errors: string[] = []
  if (v.prefix !== net.prefix) {
    errors.push(
      `Prefix /${v.prefix} tidak sesuai subnet VLAN ${net.vlan} ${net.cidr} (harus /${net.prefix})`,
    )
  }
  const gw = v.gateway.trim()
  if (!isIpv4(gw)) errors.push("Gateway tidak valid")
  else if (!isHostInSubnet(gw, net.cidr))
    errors.push(`Gateway ${gw} di luar subnet VLAN ${net.vlan} ${net.cidr}`)
  for (const d of v.dns) {
    const err = dnsAddressError(d)
    if (err) errors.push(err)
  }
  return errors
}

export type IpUsage = {
  /** IP → label pemakai (hostname/MAC) untuk host di luar batch. */
  used: Map<string, string>
}

/**
 * Validasi satu IP management statis. Mengembalikan pesan error atau null.
 * Aturannya sama dengan pxe-nodes: di dalam subnet, bukan network/broadcast,
 * bukan gateway/PXE server, di luar range DHCP dinamis, tidak bentrok.
 */
export function validateStaticIp(
  ip: string,
  usage?: IpUsage,
  /**
   * CIDR (memakai gateway/range default), parameter subnet lengkap, atau jaringan VLAN terdaftar
   * (DEC-024: tanpa aturan range DHCP/PXE server; IP ≠ gateway VLAN).
   */
  subnet?: string | StaticNetwork,
): string | null {
  const net = resolveNet(subnet)
  const cidr = net.cidr
  const v = ip.trim()
  if (!v) return "IP wajib diisi"
  if (!isIpv4(v)) return "Format IPv4 tidak valid"
  if (!inSubnet(v, cidr)) return `Di luar subnet ${subnetLabel(net)}`
  const { network, broadcast } = subnetBounds(cidr)
  const n = ipToInt(v)
  if (n === network || n === broadcast) return "Alamat network/broadcast"
  if (isVlanNetwork(net)) {
    if (v === net.gateway) return `Dipakai gateway VLAN ${net.vlan}`
  } else if (v === net.gateway || v === net.pxeServer) {
    return "Dipakai gateway/PXE server"
  } else if (inRange(v, net.dynamicRange)) {
    const [lo, hi] = net.dynamicRange
    return `Di dalam range DHCP dinamis ${lo}–${hi}`
  }
  const owner = usage?.used.get(v)
  if (owner) return `Bentrok dengan ${owner}`
  return null
}

/** Batas kandidat IP yang diperiksa `planIps` per panggilan (CR-3-15). */
export const MAX_PLAN_CANDIDATES = 65_536

export type IpPlanSpec =
  | { kind: "range"; start: string; end: string }
  | { kind: "increment"; start: string; step: number }

export type IpPlanRow = {
  hostId: string
  ip: string | null
  error: string | null
}

/**
 * Rencanakan IP untuk banyak host berurutan. IP yang tidak valid/bentrok
 * dilewati bila `skipUsed` aktif, selain itu ditandai error per host.
 */
export function planIps(
  hostIds: string[],
  spec: IpPlanSpec,
  usage: IpUsage,
  skipUsed: boolean,
  net: StaticNetwork = MGMT_NETWORK,
): IpPlanRow[] {
  if (!isIpv4(spec.start)) {
    return hostIds.map((hostId) => ({
      hostId,
      ip: null,
      error: "IP awal tidak valid",
    }))
  }
  let end = Number.POSITIVE_INFINITY
  if (spec.kind === "range") {
    if (!isIpv4(spec.end)) {
      return hostIds.map((hostId) => ({
        hostId,
        ip: null,
        error: "IP akhir tidak valid",
      }))
    }
    end = ipToInt(spec.end)
  }
  // IP awal di luar subnet: tolak tanpa iterasi (CR-3-1). Tanpa ini loop
  // berjalan satu per satu dari IP awal sampai masuk subnet (bisa ratusan
  // juta langkah dan membekukan tab browser).
  if (!inSubnet(spec.start.trim(), net.cidr)) {
    return hostIds.map((hostId) => ({
      hostId,
      ip: null,
      error: `IP awal di luar subnet ${subnetLabel(net)}`,
    }))
  }
  const step =
    spec.kind === "increment" ? Math.max(1, Math.floor(spec.step)) : 1
  const { broadcast, network } = subnetBounds(net.cidr)
  end = Math.min(end, broadcast)

  const rows: IpPlanRow[] = []
  const taken = new Set<string>()
  let cur = ipToInt(spec.start)
  // Batas keras: total kandidat yang diperiksa tidak melebihi ukuran subnet
  // maupun MAX_PLAN_CANDIDATES (CR-3-15: subnet env besar, mis. /8, tidak
  // boleh membuat loop jutaan langkah di browser/server).
  let budget = Math.min(broadcast - network + 1, MAX_PLAN_CANDIDATES)
  for (const hostId of hostIds) {
    let assigned: IpPlanRow | null = null
    while (!assigned) {
      if (cur > end || budget-- <= 0) {
        assigned = { hostId, ip: null, error: "Range IP tidak cukup" }
        break
      }
      const ip = intToIp(cur)
      cur += step
      const err = taken.has(ip)
        ? "Duplikat dalam batch"
        : validateStaticIp(ip, usage, net)
      if (!err) {
        assigned = { hostId, ip, error: null }
      } else if (!skipUsed) {
        assigned = { hostId, ip, error: err }
      }
    }
    if (assigned.ip) taken.add(assigned.ip)
    rows.push(assigned)
  }
  return rows
}

/** Validasi daftar IP final (dipakai server dan preview single host). */
export function validateIpAssignments(
  assignments: { hostId: string; ip: string }[],
  usage: IpUsage,
  net: StaticNetwork = MGMT_NETWORK,
): Map<string, string> {
  const errors = new Map<string, string>()
  const seen = new Map<string, string>()
  for (const { hostId, ip } of assignments) {
    const err = validateStaticIp(ip, usage, net)
    if (err) errors.set(hostId, err)
    else if (seen.has(ip)) errors.set(hostId, "Duplikat dalam batch")
    seen.set(ip, hostId)
  }
  return errors
}

export type MgmtNetworkEnv = {
  PXE_MGMT_CIDR?: string
  PXE_MGMT_GATEWAY?: string
  PXE_MGMT_DNS?: string
  PXE_DYNAMIC_RANGE?: string
  PXE_SERVER_IP?: string
}

/**
 * Bangun parameter subnet management dari nilai env (fungsi murni; pembacaan
 * `process.env` ada di src/lib/server/net-config.ts). Variabel yang kosong
 * memakai `base`. Bila `PXE_MGMT_CIDR` diubah tanpa gateway/DNS/range/PXE
 * server, nilai turunan wajib diisi juga — kombinasi tidak konsisten
 * melempar Error dengan pesan yang menyebut variabelnya.
 *
 * - `PXE_DYNAMIC_RANGE`: "a.b.c.d-a.b.c.e" (atau dipisah koma)
 * - `PXE_MGMT_DNS`: daftar IPv4 dipisah koma (default: gateway bila
 *   `PXE_MGMT_GATEWAY` diisi, selain itu default `base`). Tidak wajib di
 *   subnet; alamat khusus (loopback/multicast/0.0.0.0/broadcast) ditolak
 *   (DEC-011).
 */
export function mgmtNetworkFromEnv(
  env: MgmtNetworkEnv,
  base: MgmtNetwork = MGMT_NETWORK,
): MgmtNetwork {
  const val = (k: keyof MgmtNetworkEnv) => env[k]?.trim() || undefined
  const fail = (msg: string): never => {
    throw new Error(`Konfigurasi jaringan management tidak valid: ${msg}`)
  }

  let cidr = base.cidr
  const rawCidr = val("PXE_MGMT_CIDR")
  if (rawCidr) {
    if (!isCidr(rawCidr)) fail(`PXE_MGMT_CIDR "${rawCidr}" bukan CIDR IPv4`)
    const { network, prefix } = parseCidr(rawCidr)
    if (prefix < 8 || prefix > 30)
      fail(`PXE_MGMT_CIDR prefix /${prefix} harus 8–30`)
    cidr = `${intToIp(network)}/${prefix}`
  }

  const gateway = val("PXE_MGMT_GATEWAY") ?? base.gateway
  const pxeServer = val("PXE_SERVER_IP") ?? base.pxeServer
  const rawDns = val("PXE_MGMT_DNS")
  const dns = rawDns
    ? rawDns
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : val("PXE_MGMT_GATEWAY")
      ? [gateway]
      : [...base.dns]
  let dynamicRange = base.dynamicRange
  const rawRange = val("PXE_DYNAMIC_RANGE")
  if (rawRange) {
    const parts = rawRange.split(/[-,]/).map((x) => x.trim())
    if (parts.length !== 2 || !parts.every(isIpv4))
      fail(`PXE_DYNAMIC_RANGE "${rawRange}" harus berbentuk awal-akhir`)
    dynamicRange = [parts[0], parts[1]]
  }

  if (!isHostInSubnet(gateway, cidr))
    fail(`gateway ${gateway} (PXE_MGMT_GATEWAY) di luar subnet ${cidr}`)
  if (!isHostInSubnet(pxeServer, cidr))
    fail(`PXE server ${pxeServer} (PXE_SERVER_IP) di luar subnet ${cidr}`)
  if (dns.length === 0 || dns.length > 4 || !dns.every(isIpv4))
    fail(`PXE_MGMT_DNS harus 1–4 IPv4`)
  for (const d of dns) {
    const err = dnsAddressError(d)
    if (err) fail(`${err} (PXE_MGMT_DNS)`)
  }
  const [lo, hi] = dynamicRange
  if (!isHostInSubnet(lo, cidr) || !isHostInSubnet(hi, cidr))
    fail(`range dinamis ${lo}–${hi} (PXE_DYNAMIC_RANGE) di luar subnet ${cidr}`)
  if (ipToInt(lo) > ipToInt(hi))
    fail(`range dinamis ${lo}–${hi} (PXE_DYNAMIC_RANGE) terbalik`)

  return { cidr, gateway, dns, pxeServer, dynamicRange }
}

/** Batas jumlah entri `PXE_VLAN_NETWORKS` (DEC-024 §4). */
export const MAX_VLAN_NETWORKS = 16

/** true bila dua CIDR (ternormalisasi atau tidak) berbagi minimal satu alamat. */
export function cidrsOverlap(a: string, b: string): boolean {
  const x = subnetBounds(a)
  const y = subnetBounds(b)
  return x.network <= y.broadcast && y.network <= x.broadcast
}

/**
 * Parse `PXE_VLAN_NETWORKS` = `"<vlan>:<cidr>:<gateway>[;…]"` (fungsi murni, M7 DEC-024 §4).
 * Kosong/undefined → `[]`. Aturan: maks `MAX_VLAN_NETWORKS` entri; VLAN 1–4094 unik; CIDR IPv4
 * prefix 8–30 (dinormalisasi ke alamat network); gateway host di CIDR (bukan network/broadcast);
 * CIDR tidak tumpang tindih dengan `mgmtCidr` (`PXE_MGMT_CIDR`) maupun entri lain. Pelanggaran →
 * Error yang pesannya diawali `PXE_VLAN_NETWORKS` (dibungkus settings → "Konfigurasi server tidak
 * valid: …"). Hasil diurutkan menurut urutan env.
 */
export function vlanNetworksFromEnv(
  raw: string | undefined,
  mgmtCidr: string,
): VlanNetwork[] {
  const v = raw?.trim() ?? ""
  if (!v) return []
  const fail = (msg: string): never => {
    throw new Error(`PXE_VLAN_NETWORKS ${msg}`)
  }
  const entries = v.split(";").map((e) => e.trim())
  if (entries.length > MAX_VLAN_NETWORKS)
    fail(`maksimal ${MAX_VLAN_NETWORKS} entri (ada ${entries.length})`)
  const out: VlanNetwork[] = []
  entries.forEach((e, i) => {
    const at = `entri #${i + 1}`
    if (!e) fail(`${at} kosong (format "<vlan>:<cidr>:<gateway>", antarentri dipisah ";")`)
    const parts = e.split(":").map((x) => x.trim())
    if (parts.length !== 3)
      fail(`${at} "${e}" harus berbentuk <vlan>:<cidr>:<gateway> (antarentri dipisah ";")`)
    const [rawVlan, rawCidr, gateway] = parts
    if (!/^\d{1,4}$/.test(rawVlan) || Number(rawVlan) < 1 || Number(rawVlan) > 4094)
      fail(`${at}: VLAN "${rawVlan}" harus bilangan bulat 1–4094`)
    const vlan = Number(rawVlan)
    if (out.some((o) => o.vlan === vlan)) fail(`${at}: VLAN ${vlan} ganda`)
    if (!isCidr(rawCidr)) fail(`${at}: "${rawCidr}" bukan CIDR IPv4`)
    const { network, prefix } = parseCidr(rawCidr)
    if (prefix < 8 || prefix > 30)
      fail(`${at}: prefix /${prefix} harus 8–30`)
    const cidr = `${intToIp(network)}/${prefix}`
    if (!isIpv4(gateway)) fail(`${at}: gateway "${gateway}" bukan IPv4`)
    if (!isHostInSubnet(gateway, cidr))
      fail(`${at}: gateway ${gateway} bukan alamat host di ${cidr}`)
    if (cidrsOverlap(cidr, mgmtCidr))
      fail(`${at}: ${cidr} (VLAN ${vlan}) tumpang tindih dengan PXE_MGMT_CIDR ${mgmtCidr}`)
    const clash = out.find((o) => cidrsOverlap(o.cidr, cidr))
    if (clash)
      fail(`${at}: ${cidr} (VLAN ${vlan}) tumpang tindih dengan ${clash.cidr} (VLAN ${clash.vlan})`)
    out.push({ vlan, cidr, prefix, gateway })
  })
  return out
}

/**
 * Bentuk respons `GET /api/network` (kontrak klien, CR-3-2): parameter subnet
 * management aktif dari server.
 */
export type NetworkResponse = {
  cidr: string
  prefix: number
  gateway: string
  dns: string[]
  dynamicRange: [string, string]
  pxeServer: string
  /**
   * M7 (DEC-024 §4): VLAN management terdaftar (`PXE_VLAN_NETWORKS`). Hanya ada bila env berisi
   * minimal satu entri; tidak ada = tidak ada VLAN terdaftar (klien: `r.vlanNetworks ?? []`).
   */
  vlanNetworks?: VlanNetwork[]
}

export function toNetworkResponse(
  net: MgmtNetwork,
  vlanNetworks: readonly VlanNetwork[] = [],
): NetworkResponse {
  return {
    cidr: net.cidr,
    prefix: parseCidr(net.cidr).prefix,
    gateway: net.gateway,
    dns: [...net.dns],
    dynamicRange: [net.dynamicRange[0], net.dynamicRange[1]],
    pxeServer: net.pxeServer,
    ...(vlanNetworks.length
      ? { vlanNetworks: vlanNetworks.map((v) => ({ ...v })) }
      : {}),
  }
}

/** Kebalikan `toNetworkResponse` (untuk klien yang memanggil planIps dsb.). */
export function fromNetworkResponse(r: NetworkResponse): MgmtNetwork {
  return {
    cidr: r.cidr,
    gateway: r.gateway,
    dns: r.dns,
    pxeServer: r.pxeServer,
    dynamicRange: r.dynamicRange,
  }
}
