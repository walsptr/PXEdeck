// InstallContext: data tervalidasi untuk generator (M4-T4). Generator
// memanggil `validateContext` sendiri sehingga input berbahaya selalu
// ditolak, juga bila generator dipanggil langsung (AC-4.22).
import { validateUsername } from "@/lib/credentials"
import type { HostConfig, SshKey } from "@/lib/host-config"
import { validateHostname } from "@/lib/hostname"
import { dnsAddressError, isIpv4 } from "@/lib/net"
import type { OsImageRecord } from "@/lib/server/db/repos/os-images"
import { parseSshKey } from "@/lib/ssh-key"
import type { Host } from "@/lib/types"

export class InstallerInputError extends Error {}

export type InstallNetwork =
  | { mode: "dhcp" }
  | {
      mode: "static"
      ip: string
      prefix: number
      gateway: string
      dns: string[]
      vlan: number | null
      iface: { by: "mac" } | { by: "name"; name: string }
    }

export type InstallContext = {
  jobId: string
  /** MAC normal `aa:bb:cc:dd:ee:ff`. */
  mac: string
  hostname: string
  username: string
  /** SHA-512 crypt (`$6$…`), tidak pernah plaintext. */
  passwordHash: string
  sudo: boolean
  disableSshPassword: boolean
  network: InstallNetwork
  /** Public key OpenSSH ternormalisasi (komentar disanitasi). */
  authorizedKeys: string[]
  storage: { partition: "auto" | "lvm" | "custom"; disk: string }
  timezone: string
  locale: string
  /** URL media (PXE_MEDIA_URL), tanpa "/" di akhir. */
  mediaUrl: string
  /** Direktori image relatif media (mis. "rocky-9", "debian-12"). */
  imageRepo: string
  serverIp: string
  /**
   * URL callback status `…/boot/{mac}/{token}/status`. Hanya Windows
   * (unattend, belum dilayani M4) yang menyisipkannya; Ubuntu/Debian/Rocky
   * menurunkannya dari argumen kernel installer (`callbackUrlCmd`, B-5).
   */
  callbackUrl: string
  /**
   * DEC-021: metadata repo media bertanda tangan (mirror resmi)? Default false = media lokal server PXE
   * (DVD; `Release` tanpa InRelease/Release.gpg) → Debian memakai sumber apt `[trusted=yes by-hash=no]`
   * hanya selama instalasi. true → sumber biasa, tanpa `trusted=yes`.
   */
  mediaSigned?: boolean
}

const HASH_RE = /^\$6\$(rounds=\d{4,9}\$)?[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}$/
const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/
const URL_RE = /^https?:\/\/[A-Za-z0-9.:[\]-]+(\/[A-Za-z0-9._~%/-]*)?$/
const CALLBACK_RE = /^https?:\/\/[A-Za-z0-9.:[\]-]+(\/[A-Za-z0-9._~%:/-]*)?\/status$/
const DISK_RE = /^$|^\/dev\/[a-zA-Z0-9/_-]+$/
const REL_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/
const TZ_RE = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/
const LOCALE_RE = /^[a-z]{2,3}_[A-Z]{2}\.UTF-8$/
const KEY_B64_RE = /^[A-Za-z0-9+/]+={0,3}$/

function bad(msg: string): never {
  throw new InstallerInputError(msg)
}

/** Normalisasi + sanitasi satu public key; Error bila tidak valid. */
export function sanitizeKey(raw: string): string {
  if (/[\r\n\0]/.test(raw)) bad("SSH key memuat baris baru")
  const p = parseSshKey(raw)
  if ("error" in p) bad(`SSH key tidak valid: ${p.error}`)
  const [type, data] = p.normalized.split(" ")
  if (!KEY_B64_RE.test(data)) bad("SSH key: data bukan base64")
  const comment = p.comment.replace(/[^A-Za-z0-9@._+-]/g, "_").slice(0, 64)
  return comment ? `${type} ${data} ${comment}` : `${type} ${data}`
}

/** Validasi ulang semua field (dipanggil setiap generator). */
export function validateContext(c: InstallContext): InstallContext {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(c.jobId)) bad("jobId tidak valid")
  if (!MAC_RE.test(c.mac)) bad("MAC tidak valid")
  // validateHostname men-trim; generator memakai nilai mentah, jadi spasi/CR/LF di tepi
  // harus ditolak di sini (mis. ComputerName unattend menjadi "n1\n").
  const hErr = validateHostname(c.hostname)
  if (hErr || c.hostname !== c.hostname.trim()) bad(`Hostname: ${hErr ?? "spasi"}`)
  const uErr = validateUsername(c.username)
  if (uErr || c.username !== c.username.trim()) bad(`Username: ${uErr ?? "spasi"}`)
  if (!HASH_RE.test(c.passwordHash)) bad("Hash password harus SHA-512 crypt ($6$)")
  const n = c.network
  if (n.mode === "static") {
    if (!isIpv4(n.ip) || n.ip !== n.ip.trim()) bad("IP tidak valid")
    if (!Number.isInteger(n.prefix) || n.prefix < 8 || n.prefix > 30) bad("Prefix tidak valid")
    if (!isIpv4(n.gateway) || n.gateway !== n.gateway.trim()) bad("Gateway tidak valid")
    if (n.dns.length < 1 || n.dns.length > 4 || !n.dns.every((d) => dnsAddressError(d) === null && d === d.trim()))
      bad("DNS tidak valid")
    if (n.vlan !== null && (!Number.isInteger(n.vlan) || n.vlan < 1 || n.vlan > 4094))
      bad("VLAN tidak valid")
    if (n.iface.by === "name" && !/^[a-zA-Z0-9._-]{1,15}$/.test(n.iface.name))
      bad("Nama interface tidak valid")
  } else if (n.mode !== "dhcp") bad("Mode network tidak valid")
  if (c.authorizedKeys.length > 100) bad("Terlalu banyak SSH key")
  for (const k of c.authorizedKeys) if (sanitizeKey(k) !== k) bad("SSH key belum dinormalisasi")
  if (!["auto", "lvm", "custom"].includes(c.storage.partition)) bad("Skema partisi tidak valid")
  if (!DISK_RE.test(c.storage.disk)) bad("Path disk tidak valid")
  if (!TZ_RE.test(c.timezone)) bad("Timezone tidak valid")
  if (!LOCALE_RE.test(c.locale)) bad("Locale tidak valid")
  if (!URL_RE.test(c.mediaUrl)) bad("URL media tidak valid")
  if (!REL_RE.test(c.imageRepo) || c.imageRepo.split("/").includes("..")) bad("Repo image tidak valid")
  if (!isIpv4(c.serverIp)) bad("IP server tidak valid")
  if (!CALLBACK_RE.test(c.callbackUrl)) bad("URL callback tidak valid")
  return c
}

/** Hostname default untuk host tanpa hostname: `node-<12 hex MAC>`. */
export function fallbackHostname(mac: string): string {
  return `node-${mac.replaceAll(":", "")}`
}

export type BuildContextInput = {
  host: Host
  config: HostConfig
  jobId: string
  image: OsImageRecord
  /** Key library yang dipilih host (urut). */
  libraryKeys: SshKey[]
  mediaUrl: string
  serverIp: string
  callbackUrl: string
}

/** Bangun + validasi InstallContext dari data DB. */
export function buildContext(i: BuildContextInput): InstallContext {
  const { host, config: cfg } = i
  if (!cfg.os) bad("OS belum dipilih")
  if (!cfg.username || !cfg.passwordHash) bad("Credentials belum diisi")
  if (cfg.sshUser && cfg.sshUser !== cfg.username)
    bad("User target SSH berbeda dari user Credentials belum didukung")
  if (cfg.os.partition === "custom")
    bad("Skema partisi custom belum didukung")
  const keys = [...i.libraryKeys.map((k) => k.publicKey), ...cfg.extraKeys].map(sanitizeKey)
  return validateContext({
    jobId: i.jobId,
    mac: host.mac,
    hostname: host.hostname ?? fallbackHostname(host.mac),
    username: cfg.username,
    passwordHash: cfg.passwordHash,
    sudo: cfg.sudo,
    disableSshPassword: cfg.disableSshPassword,
    network:
      cfg.network.mode === "static"
        ? {
            mode: "static",
            ip: cfg.network.ip,
            prefix: cfg.network.prefix,
            gateway: cfg.network.gateway,
            dns: [...cfg.network.dns],
            vlan: cfg.network.vlan,
            iface: cfg.network.iface,
          }
        : { mode: "dhcp" },
    authorizedKeys: [...new Set(keys)],
    storage: { partition: cfg.os.partition, disk: cfg.os.disk },
    timezone: cfg.os.timezone,
    locale: cfg.os.locale,
    mediaUrl: i.mediaUrl,
    imageRepo: i.image.source.repo,
    serverIp: i.serverIp,
    callbackUrl: i.callbackUrl,
  })
}

/** Netmask bertitik dari prefix (kickstart/Debian). */
export function prefixToNetmask(prefix: number): string {
  const m = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return [24, 16, 8, 0].map((s) => (m >>> s) & 255).join(".")
}
