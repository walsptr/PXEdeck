// Utilitas IPv4 + parameter jaringan management. Dipakai form (preview) dan
// server (validasi). Nilai default mengikuti scripts/pxe-nodes; tahap 4
// memindahkannya ke Settings.

export const MGMT_NETWORK = {
  cidr: "10.10.10.0/24",
  gateway: "10.10.10.1",
  dns: ["10.10.10.1"],
  pxeServer: "10.10.10.1",
  /** Range DHCP dinamis dnsmasq: IP statis tidak boleh di sini. */
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
  cidr = MGMT_NETWORK.cidr,
): string | null {
  const v = ip.trim()
  if (!v) return "IP wajib diisi"
  if (!isIpv4(v)) return "Format IPv4 tidak valid"
  if (!inSubnet(v, cidr)) return `Di luar subnet ${cidr}`
  const { network, broadcast } = subnetBounds(cidr)
  const n = ipToInt(v)
  if (n === network || n === broadcast) return "Alamat network/broadcast"
  if (v === MGMT_NETWORK.gateway || v === MGMT_NETWORK.pxeServer) {
    return "Dipakai gateway/PXE server"
  }
  const [lo, hi] = MGMT_NETWORK.dynamicRange
  if (n >= ipToInt(lo) && n <= ipToInt(hi)) {
    return `Di dalam range DHCP dinamis ${lo}–${hi}`
  }
  const owner = usage?.used.get(v)
  if (owner) return `Bentrok dengan ${owner}`
  return null
}

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
  const step =
    spec.kind === "increment" ? Math.max(1, Math.floor(spec.step)) : 1
  const { broadcast } = subnetBounds(MGMT_NETWORK.cidr)
  end = Math.min(end, broadcast)

  const rows: IpPlanRow[] = []
  const taken = new Set<string>()
  let cur = ipToInt(spec.start)
  for (const hostId of hostIds) {
    let assigned: IpPlanRow | null = null
    while (!assigned) {
      if (cur > end) {
        assigned = { hostId, ip: null, error: "Range IP tidak cukup" }
        break
      }
      const ip = intToIp(cur)
      cur += step
      const err = taken.has(ip)
        ? "Duplikat dalam batch"
        : validateStaticIp(ip, usage)
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
): Map<string, string> {
  const errors = new Map<string, string>()
  const seen = new Map<string, string>()
  for (const { hostId, ip } of assignments) {
    const err = validateStaticIp(ip, usage)
    if (err) errors.set(hostId, err)
    else if (seen.has(ip)) errors.set(hostId, "Duplikat dalam batch")
    seen.set(ip, hostId)
  }
  return errors
}
