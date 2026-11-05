// Skema payload konfigurasi host (dipakai form untuk tipe, server untuk
// validasi struktural). Validasi semantik (IP bentrok, hostname duplikat,
// MAC di CSV) ada di server: src/lib/server/config-service.ts.
import { z } from "zod"

export const TIMEZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
  "Asia/Singapore",
  "UTC",
] as const

export const LOCALES = ["en_US.UTF-8", "id_ID.UTF-8", "en_GB.UTF-8"] as const

export const PARTITION_SCHEMES = ["auto", "lvm", "custom"] as const

// ---- Batas ukuran input (SPEC §6, gap G3-4) ----
// Melanggar batas = 400 (validasi struktural). Batas sengaja sedikit di atas
// aturan semantik bila aturan semantik punya pesan yang lebih jelas (mis.
// username ≤ 32, password ≤ 128 → 422 dari config-service).
export const LIMITS = {
  /** Jumlah host per request bulk / key per `assignments`. */
  hosts: 500,
  hostId: 64,
  /** Panjang maksimum IPv4 bertitik: "255.255.255.255". */
  ip: 15,
  hostname: 63,
  username: 64,
  password: 1024,
  sshKeyIds: 100,
  sshNewKeys: 20,
  osImageId: 64,
  disk: 128,
} as const

/** Id host = MAC 12 hex huruf kecil tanpa pemisah (lihat mock-hosts). */
export const HOST_ID_RE = /^[0-9a-f]{12}$/

/** Normalisasi id host dari URL: huruf besar diterima; selain 12 hex → null. */
export function parseHostId(raw: string): string | null {
  const id = raw.trim().toLowerCase()
  return HOST_ID_RE.test(id) ? id : null
}

const tooLong = (n: number) => ({ message: `Maksimal ${n} karakter` })

/** Elemen id host di payload (bentuk tidak dicek: id asing → 422 per host). */
export const hostIdField = z
  .string()
  .min(1, "Id host kosong")
  .max(LIMITS.hostId, tooLong(LIMITS.hostId))

/** Peta hostId → nilai dengan batas jumlah key. */
function assignmentsField(maxValue: number) {
  return z
    .record(hostIdField, z.string().max(maxValue, tooLong(maxValue)))
    .refine((o) => Object.keys(o).length <= LIMITS.hosts, {
      message: `Maksimal ${LIMITS.hosts} host`,
    })
}

const ipField = z.string().max(LIMITS.ip, tooLong(LIMITS.ip))

export const osSection = z.object({
  osImageId: z
    .string()
    .min(1, "Pilih OS image")
    .max(LIMITS.osImageId, tooLong(LIMITS.osImageId)),
  /** "" = disk terbesar (otomatis). */
  disk: z
    .string()
    .trim()
    .max(LIMITS.disk, tooLong(LIMITS.disk))
    .regex(/^$|^\/dev\/[a-zA-Z0-9/_-]+$/, "Path disk harus seperti /dev/sda"),
  partition: z.enum(PARTITION_SCHEMES),
  customStorage: z.string().max(20_000).optional(),
  timezone: z.enum(TIMEZONES),
  locale: z.enum(LOCALES),
})

const credentialFlags = {
  sudo: z.boolean(),
  disableSshPassword: z.boolean(),
}

export const credentialsSection = z.discriminatedUnion("mode", [
  /** Satu username/password untuk semua host (juga mode per host). Password kosong = pertahankan. */
  z.object({
    mode: z.literal("same"),
    username: z.string().max(LIMITS.username, tooLong(LIMITS.username)),
    password: z.string().max(LIMITS.password, tooLong(LIMITS.password)),
    ...credentialFlags,
  }),
  /** Password acak unik per host, dikembalikan sekali setelah disimpan. */
  z.object({
    mode: z.literal("random"),
    username: z.string().max(LIMITS.username, tooLong(LIMITS.username)),
    length: z.number().int().min(12).max(64),
    ...credentialFlags,
  }),
  /** Import CSV mac,username,password. */
  z.object({
    mode: z.literal("csv"),
    csv: z.string().max(200_000),
    ...credentialFlags,
  }),
])

export const networkSection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("dhcp") }),
  z.object({
    mode: z.literal("static"),
    /** hostId → IP; dihitung form dari input tunggal/range, divalidasi ulang server. */
    assignments: assignmentsField(LIMITS.ip),
    /** Wajib sama dengan prefix subnet management (DEC-006, cek di server). */
    prefix: z.number().int().min(8).max(30),
    gateway: ipField,
    dns: z.array(ipField).min(1, "Minimal satu DNS").max(4),
    vlan: z.number().int().min(1).max(4094).nullable(),
    iface: z.discriminatedUnion("by", [
      z.object({ by: z.literal("mac") }),
      z.object({
        by: z.literal("name"),
        name: z
          .string()
          .regex(/^[a-zA-Z0-9._-]{1,15}$/, "Nama interface tidak valid"),
      }),
    ]),
  }),
])

export const hostnameSection = z.object({
  /** hostId → hostname; dirender form dari input/template, divalidasi ulang server. */
  assignments: assignmentsField(LIMITS.hostname),
})

export const sshSection = z.object({
  keyIds: z.array(z.string().max(64, tooLong(64))).max(LIMITS.sshKeyIds),
  newKeys: z
    .array(
      z.object({
        name: z.string().trim().max(64),
        publicKey: z.string().max(16_384),
        saveToLibrary: z.boolean(),
      }),
    )
    .max(LIMITS.sshNewKeys),
  /** User target authorized_keys; kosong = user dari Credentials. */
  user: z.string().max(LIMITS.username, tooLong(LIMITS.username)),
})

export const configPayload = z.object({
  os: osSection.optional(),
  credentials: credentialsSection.optional(),
  network: networkSection.optional(),
  hostname: hostnameSection.optional(),
  ssh: sshSection.optional(),
})

export const bulkPayload = configPayload.extend({
  hostIds: z
    .array(hostIdField)
    .min(1, "Pilih minimal satu host")
    .max(LIMITS.hosts),
})

export const installPayload = z.object({
  hostIds: z.array(hostIdField).min(1).max(LIMITS.hosts),
})

export type OsSection = z.infer<typeof osSection>
export type CredentialsSection = z.infer<typeof credentialsSection>
export type NetworkSection = z.infer<typeof networkSection>
export type HostnameSection = z.infer<typeof hostnameSection>
export type SshSection = z.infer<typeof sshSection>
export type ConfigPayload = z.infer<typeof configPayload>
export type BulkPayload = z.infer<typeof bulkPayload>

export type SectionKey = keyof ConfigPayload

export type StaticNetwork = {
  mode: "static"
  ip: string
  prefix: number
  gateway: string
  dns: string[]
  vlan: number | null
  iface: { by: "mac" } | { by: "name"; name: string }
}

/** Konfigurasi tersimpan per host (server). */
export type HostConfig = {
  os: OsSection | null
  username: string | null
  passwordHash: string | null
  sudo: boolean
  disableSshPassword: boolean
  network: { mode: "dhcp" } | StaticNetwork
  sshKeyIds: string[]
  /** Public key yang ditempel langsung tanpa disimpan ke library. */
  extraKeys: string[]
  sshUser: string | null
  updatedAt: string | null
}

/** Konfigurasi yang dikirim ke browser: hash password tidak pernah ikut. */
export type PublicHostConfig = Omit<HostConfig, "passwordHash"> & {
  hasPassword: boolean
}

export type ApiFieldError = {
  section: SectionKey | "hostIds"
  hostId?: string
  message: string
}

export type SaveResult = {
  updated: number
  /** Hanya untuk mode password acak: ditampilkan/diunduh sekali. */
  generatedPasswords?: {
    mac: string
    hostname: string | null
    username: string
    password: string
  }[]
}

export type InstallResult = {
  started: string[]
  failed: { hostId: string; message: string }[]
}

export type CsvRowResult = {
  line: number
  mac: string
  username: string
  hostId: string | null
  errors: string[]
}

export type SshKey = {
  id: string
  name: string
  type: string
  publicKey: string
  fingerprint: string
  comment: string
  createdAt: string
}
