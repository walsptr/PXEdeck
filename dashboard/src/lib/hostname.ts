// Hostname RFC 1123 (satu label, huruf kecil — sama dengan pxe-nodes) dan
// template bulk: {index}, {index:02}, {mac_suffix}, {ip_last_octet}, {prefix}.

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

export function validateHostname(name: string): string | null {
  const v = name.trim()
  if (!v) return "Hostname wajib diisi"
  if (v.length > 63) return "Maksimal 63 karakter"
  if (v !== v.toLowerCase()) return "Gunakan huruf kecil"
  if (!LABEL_RE.test(v)) {
    return "Hanya a–z, 0–9 dan '-', tidak diawali/diakhiri '-'"
  }
  return null
}

export const HOSTNAME_TOKENS = [
  { token: "{index}", help: "Urutan host (mulai dari nilai awal)" },
  { token: "{index:02}", help: "Urutan dengan padding nol, mis. 01, 02" },
  { token: "{mac_suffix}", help: "4 digit hex terakhir MAC, mis. 2c03" },
  { token: "{ip_last_octet}", help: "Oktet terakhir IP management" },
  { token: "{prefix}", help: "Nilai kolom prefix" },
] as const

export type TemplateHost = {
  id: string
  mac: string
  /** IP yang akan dipakai (rencana IP statis, atau IP management/lease saat ini). */
  ip: string | null
}

export type HostnameRow = {
  hostId: string
  hostname: string
  error: string | null
}

const TOKEN_RE = /\{([a-z_]+)(?::(\d+))?\}/g

export function renderHostnames(
  hosts: TemplateHost[],
  template: string,
  opts: { prefix: string; startIndex: number },
  taken: Map<string, string>,
): HostnameRow[] {
  const seen = new Set<string>()
  return hosts.map((h, i) => {
    let tokenError: string | null = null
    const name = template
      .replace(TOKEN_RE, (_m, key: string, pad?: string) => {
        switch (key) {
          case "index": {
            const n = String(opts.startIndex + i)
            return pad ? n.padStart(Number(pad), "0") : n
          }
          case "mac_suffix":
            return h.mac.replaceAll(":", "").slice(-4)
          case "ip_last_octet":
            if (!h.ip) {
              tokenError = "Host belum punya IP untuk {ip_last_octet}"
              return ""
            }
            return h.ip.split(".")[3]
          case "prefix":
            return opts.prefix.trim()
          default:
            tokenError = `Token tidak dikenal: {${key}}`
            return ""
        }
      })
      .toLowerCase()
    let error = tokenError ?? validateHostname(name)
    if (!error && seen.has(name)) error = "Duplikat dalam batch"
    if (!error && taken.has(name)) error = `Sudah dipakai ${taken.get(name)}`
    seen.add(name)
    return { hostId: h.id, hostname: name, error }
  })
}
