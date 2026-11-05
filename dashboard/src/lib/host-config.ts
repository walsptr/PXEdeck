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

export const osSection = z.object({
  osImageId: z.string().min(1, "Pilih OS image"),
  /** "" = disk terbesar (otomatis). */
  disk: z
    .string()
    .trim()
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
    username: z.string(),
    password: z.string(),
    ...credentialFlags,
  }),
  /** Password acak unik per host, dikembalikan sekali setelah disimpan. */
  z.object({
    mode: z.literal("random"),
    username: z.string(),
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
    assignments: z.record(z.string(), z.string()),
    prefix: z.number().int().min(8).max(30),
    gateway: z.string(),
    dns: z.array(z.string()).min(1, "Minimal satu DNS").max(4),
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
  assignments: z.record(z.string(), z.string()),
})

export const sshSection = z.object({
  keyIds: z.array(z.string()),
  newKeys: z.array(
    z.object({
      name: z.string().trim().max(64),
      publicKey: z.string().max(16_384),
      saveToLibrary: z.boolean(),
    }),
  ),
  /** User target authorized_keys; kosong = user dari Credentials. */
  user: z.string(),
})

export const configPayload = z.object({
  os: osSection.optional(),
  credentials: credentialsSection.optional(),
  network: networkSection.optional(),
  hostname: hostnameSection.optional(),
  ssh: sshSection.optional(),
})

export const bulkPayload = configPayload.extend({
  hostIds: z.array(z.string()).min(1, "Pilih minimal satu host").max(500),
})

export const installPayload = z.object({
  hostIds: z.array(z.string()).min(1).max(500),
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
