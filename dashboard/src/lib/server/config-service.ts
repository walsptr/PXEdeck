// Validasi semantik + penerapan konfigurasi host. Semua aturan dari form
// diulang di sini: form hanya membantu, server yang memutuskan.
//
// Atomisitas (G3-2): satu-satunya kerja async (fingerprint SHA-256 key SSH
// baru via Web Crypto) dikerjakan SEBELUM store dibaca (`prepareNewKeys`).
// Validasi + penerapan (`applyConfigPrepared`) sepenuhnya sinkron, sehingga
// dua request paralel tidak bisa sama-sama lolos cek IP/hostname bentrok.
//
// Aturan yang perlu diketahui klien:
//  - Network statis (DEC-006): prefix wajib = prefix subnet management,
//    IP & gateway wajib host di subnet management, DNS wajib IPv4.
//  - Key SSH baru (G3-3): fingerprint yang sudah ada di library → 422
//    "sudah ada di library sebagai …" (pilih key itu dari library via
//    `keyIds`); dua key baru dengan fingerprint sama dalam satu request → 422.
//    Berlaku baik untuk `saveToLibrary` true maupun false. `keyIds` duplikat
//    disatukan.
import { encrypt } from "unixcrypt"

import {
  generatePassword,
  normalizeMac,
  parseCsv,
  validatePassword,
  validateUsername,
} from "@/lib/credentials"
import type {
  ApiFieldError,
  ConfigPayload,
  CsvRowResult,
  HostConfig,
  InstallResult,
  PublicHostConfig,
  SaveResult,
  SshKey,
  SshSection,
} from "@/lib/host-config"
import { validateHostname } from "@/lib/hostname"
import {
  validateIpAssignments,
  validateStaticNetwork,
  type IpUsage,
} from "@/lib/net"
import { OS_IMAGES } from "@/lib/os-images"
import { parseSshKey, sshFingerprint, type ParsedSshKey } from "@/lib/ssh-key"
import type { Host } from "@/lib/types"
import { getMgmtNetwork } from "@/lib/server/net-config"
import {
  getConfig,
  mockDb,
  startInstall,
  type Store,
} from "@/lib/server/mock-hosts"

export function toPublicConfig(c: HostConfig): PublicHostConfig {
  const { passwordHash, ...rest } = c
  return { ...rest, hasPassword: Boolean(passwordHash) }
}

function label(h: Host) {
  return h.hostname ?? h.mac
}

/** IP yang dipakai host DI LUAR batch (IP management + lease aktif). */
function ipUsage(s: Store, batch: Set<string>): IpUsage {
  const used = new Map<string, string>()
  for (const h of s.hosts.values()) {
    if (batch.has(h.id)) continue
    if (h.currentIp && h.status !== "offline")
      used.set(h.currentIp, `lease ${label(h)}`)
    if (h.mgmtIp) used.set(h.mgmtIp, label(h))
  }
  return { used }
}

type CsvCred = { hostId: string; username: string; password: string }

/** Validasi CSV mac,username,password terhadap host terpilih. */
export function checkCredentialsCsv(
  s: Store,
  csv: string,
  hostIds: string[],
): { rows: CsvRowResult[]; creds: CsvCred[] } {
  const byMac = new Map<string, Host>()
  for (const id of hostIds) {
    const h = s.hosts.get(id)
    if (h) byMac.set(h.mac, h)
  }
  let table = parseCsv(csv)
  let offset = 1
  if (table[0] && table[0][0]?.trim().toLowerCase() === "mac") {
    table = table.slice(1)
    offset = 2
  }
  const seen = new Set<string>()
  const rows: CsvRowResult[] = []
  const creds: CsvCred[] = []
  table.forEach((cols, i) => {
    const [rawMac = "", rawUser = "", password = ""] = cols
    const errors: string[] = []
    if (cols.length !== 3) errors.push(`Harus 3 kolom, ada ${cols.length}`)
    const mac = normalizeMac(rawMac)
    const host = mac ? byMac.get(mac) : undefined
    if (!mac) errors.push("MAC tidak valid")
    else if (!host) errors.push("MAC bukan host terpilih")
    else if (seen.has(mac)) errors.push("MAC muncul lebih dari sekali")
    if (mac) seen.add(mac)
    const username = rawUser.trim()
    const uErr = validateUsername(username)
    if (uErr) errors.push(uErr)
    const pErr = validatePassword(password)
    if (pErr) errors.push(`Password: ${pErr}`)
    rows.push({
      line: i + offset,
      mac: mac ?? rawMac.trim(),
      username,
      hostId: host?.id ?? null,
      errors,
    })
    if (errors.length === 0 && host)
      creds.push({ hostId: host.id, username, password })
  })
  if (table.length === 0) {
    rows.push({
      line: 1,
      mac: "",
      username: "",
      hostId: null,
      errors: ["CSV kosong"],
    })
  }
  return { rows, creds }
}

type Prepared = {
  apply: () => void
  generated?: SaveResult["generatedPasswords"]
}

export type ApplyResult =
  { ok: true; result: SaveResult } | { ok: false; errors: ApiFieldError[] }

/** Key SSH baru yang sudah di-parse + di-fingerprint (atau error parse). */
export type PreparedNewKey =
  | { ok: true; parsed: ParsedSshKey; fingerprint: string }
  | { ok: false; error: string }

/** Parse + fingerprint key baru (satu-satunya bagian async, tanpa akses store). */
export async function prepareNewKeys(
  newKeys: SshSection["newKeys"],
): Promise<PreparedNewKey[]> {
  return Promise.all(
    newKeys.map(async (k): Promise<PreparedNewKey> => {
      const parsed = parseSshKey(k.publicKey)
      if ("error" in parsed) return { ok: false, error: parsed.error }
      return {
        ok: true,
        parsed,
        fingerprint: await sshFingerprint(parsed.blob),
      }
    }),
  )
}

/** Validasi + terapkan konfigurasi secara atomik (semua host atau tidak sama sekali). */
export async function applyConfig(
  hostIds: string[],
  p: ConfigPayload,
): Promise<ApplyResult> {
  const prepared = await prepareNewKeys(p.ssh?.newKeys ?? [])
  // Tidak ada await setelah titik ini: validasi + apply satu bagian sinkron.
  return applyConfigPrepared(hostIds, p, prepared)
}

/**
 * Bagian sinkron `applyConfig`. `preparedKeys[i]` wajib hasil
 * `prepareNewKeys(p.ssh.newKeys)` (urutan sama).
 */
export function applyConfigPrepared(
  hostIds: string[],
  p: ConfigPayload,
  preparedKeys: PreparedNewKey[],
): ApplyResult {
  if (preparedKeys.length !== (p.ssh?.newKeys.length ?? 0)) {
    throw new Error("preparedKeys tidak sesuai dengan ssh.newKeys")
  }
  const s = mockDb()
  const errors: ApiFieldError[] = []
  const ids = [...new Set(hostIds)]
  const hosts: Host[] = []
  for (const id of ids) {
    const h = s.hosts.get(id)
    if (h) hosts.push(h)
    else
      errors.push({
        section: "hostIds",
        hostId: id,
        message: "Host tidak ditemukan",
      })
  }
  if (errors.length) return { ok: false, errors }
  const batch = new Set(ids)
  const steps: Prepared[] = []

  // ---- OS ----
  if (p.os) {
    const os = p.os
    if (!OS_IMAGES.some((i) => i.id === os.osImageId)) {
      errors.push({ section: "os", message: "OS image tidak dikenal" })
    }
    if (os.partition === "custom" && !os.customStorage?.trim()) {
      errors.push({
        section: "os",
        message: "Skema custom butuh konfigurasi storage",
      })
    }
    steps.push({
      apply: () => {
        for (const h of hosts) {
          getConfig(s, h).os = { ...os, disk: os.disk.trim() }
          if (
            h.status !== "booting" &&
            h.status !== "installing" &&
            h.status !== "configuring"
          ) {
            h.osAssigned = os.osImageId
          }
        }
      },
    })
  }

  // ---- Credentials ----
  if (p.credentials) {
    const c = p.credentials
    const flags = { sudo: c.sudo, disableSshPassword: c.disableSshPassword }
    if (c.mode === "same") {
      const uErr = validateUsername(c.username)
      if (uErr) errors.push({ section: "credentials", message: uErr })
      if (c.password === "") {
        const missing = hosts.filter((h) => !getConfig(s, h).passwordHash)
        if (missing.length) {
          errors.push({
            section: "credentials",
            message: `Password wajib: ${missing.length} host belum punya password`,
          })
        }
      } else {
        const pErr = validatePassword(c.password)
        if (pErr) errors.push({ section: "credentials", message: pErr })
      }
      steps.push({
        apply: () => {
          for (const h of hosts) {
            const cfg = getConfig(s, h)
            cfg.username = c.username.trim()
            // Salt acak per host: hash berbeda walau password sama.
            if (c.password) cfg.passwordHash = encrypt(c.password)
            Object.assign(cfg, flags)
          }
        },
      })
    } else if (c.mode === "random") {
      const uErr = validateUsername(c.username)
      if (uErr) errors.push({ section: "credentials", message: uErr })
      const generated = hosts.map((h) => ({
        mac: h.mac,
        hostname: h.hostname,
        username: c.username.trim(),
        password: generatePassword(c.length),
      }))
      steps.push({
        generated,
        apply: () => {
          hosts.forEach((h, i) => {
            const cfg = getConfig(s, h)
            cfg.username = generated[i].username
            cfg.passwordHash = encrypt(generated[i].password)
            Object.assign(cfg, flags)
          })
        },
      })
    } else {
      const { rows, creds } = checkCredentialsCsv(s, c.csv, ids)
      const bad = rows.filter((r) => r.errors.length)
      if (bad.length) {
        errors.push({
          section: "credentials",
          message: `${bad.length} baris CSV tidak valid (baris ${bad.map((r) => r.line).join(", ")})`,
        })
      }
      steps.push({
        apply: () => {
          for (const cr of creds) {
            const cfg = getConfig(s, s.hosts.get(cr.hostId)!)
            cfg.username = cr.username
            cfg.passwordHash = encrypt(cr.password)
            Object.assign(cfg, flags)
          }
        },
      })
    }
  }

  // ---- Network ----
  if (p.network) {
    const n = p.network
    if (n.mode === "dhcp") {
      steps.push({
        apply: () => {
          for (const h of hosts) {
            getConfig(s, h).network = { mode: "dhcp" }
            h.mgmtIp = null
          }
        },
      })
    } else {
      const net = getMgmtNetwork()
      for (const message of validateStaticNetwork(n, net)) {
        errors.push({ section: "network", message })
      }
      const assignments = hosts.map((h) => ({
        hostId: h.id,
        ip: (n.assignments[h.id] ?? "").trim(),
      }))
      const ipErrors = validateIpAssignments(
        assignments,
        ipUsage(s, batch),
        net,
      )
      for (const [hostId, message] of ipErrors) {
        errors.push({
          section: "network",
          hostId,
          message: `${label(s.hosts.get(hostId)!)}: ${message}`,
        })
      }
      steps.push({
        apply: () => {
          for (const { hostId, ip } of assignments) {
            const h = s.hosts.get(hostId)!
            getConfig(s, h).network = {
              mode: "static",
              ip,
              prefix: n.prefix,
              gateway: n.gateway.trim(),
              dns: n.dns.map((d) => d.trim()),
              vlan: n.vlan,
              iface: n.iface,
            }
            h.mgmtIp = ip
          }
        },
      })
    }
  }

  // ---- Hostname ----
  if (p.hostname) {
    const taken = new Map<string, string>()
    for (const h of s.hosts.values()) {
      if (!batch.has(h.id) && h.hostname) taken.set(h.hostname, h.mac)
    }
    const seen = new Set<string>()
    const names = hosts.map((h) => ({
      h,
      name: (p.hostname!.assignments[h.id] ?? "").trim(),
    }))
    for (const { h, name } of names) {
      const err =
        validateHostname(name) ??
        (seen.has(name) ? "Duplikat dalam batch" : null) ??
        (taken.has(name) ? `Sudah dipakai ${taken.get(name)}` : null)
      if (err)
        errors.push({
          section: "hostname",
          hostId: h.id,
          message: `${h.mac}: ${err}`,
        })
      seen.add(name)
    }
    steps.push({
      apply: () => {
        for (const { h, name } of names) h.hostname = name
      },
    })
  }

  // ---- SSH keys ----
  if (p.ssh) {
    const ssh = p.ssh
    const keyIds = [...new Set(ssh.keyIds)]
    for (const id of keyIds) {
      if (!s.sshKeys.has(id))
        errors.push({
          section: "ssh",
          message: `Key ${id} tidak ada di library`,
        })
    }
    if (ssh.user.trim()) {
      const uErr = validateUsername(ssh.user)
      if (uErr) errors.push({ section: "ssh", message: `User target: ${uErr}` })
    }
    const newLibrary: SshKey[] = []
    const extra: string[] = []
    const libraryByFp = new Map(
      [...s.sshKeys.values()].map((k) => [k.fingerprint, k]),
    )
    const newByFp = new Map<string, number>()
    for (const [i, k] of ssh.newKeys.entries()) {
      const prep = preparedKeys[i]
      if (!prep.ok) {
        errors.push({
          section: "ssh",
          message: `Key baru #${i + 1}: ${prep.error}`,
        })
        continue
      }
      const { parsed, fingerprint } = prep
      const existing = libraryByFp.get(fingerprint)
      if (existing) {
        errors.push({
          section: "ssh",
          message: `Key baru #${i + 1}: sudah ada di library sebagai "${existing.name}" — pilih dari library`,
        })
        continue
      }
      const dupOf = newByFp.get(fingerprint)
      if (dupOf !== undefined) {
        errors.push({
          section: "ssh",
          message: `Key baru #${i + 1}: sama dengan key baru #${dupOf + 1}`,
        })
        continue
      }
      newByFp.set(fingerprint, i)
      if (k.saveToLibrary) {
        if (!k.name) {
          errors.push({
            section: "ssh",
            message: `Key baru #${i + 1}: nama wajib untuk disimpan ke library`,
          })
          continue
        }
        newLibrary.push({
          id: `key-${crypto.randomUUID().slice(0, 8)}`,
          name: k.name,
          type: parsed.type,
          publicKey: parsed.normalized,
          fingerprint,
          comment: parsed.comment,
          createdAt: new Date().toISOString(),
        })
      } else {
        extra.push(parsed.normalized)
      }
    }
    if (keyIds.length + ssh.newKeys.length === 0) {
      errors.push({
        section: "ssh",
        message: "Pilih atau tambahkan minimal satu key",
      })
    }
    steps.push({
      apply: () => {
        for (const k of newLibrary) s.sshKeys.set(k.id, k)
        for (const h of hosts) {
          const cfg = getConfig(s, h)
          cfg.sshKeyIds = [...keyIds, ...newLibrary.map((k) => k.id)]
          cfg.extraKeys = extra
          cfg.sshUser = ssh.user.trim() || null
        }
      },
    })
  }

  if (steps.length === 0) {
    errors.push({
      section: "hostIds",
      message: "Tidak ada bagian konfigurasi yang diubah",
    })
  }
  if (errors.length) return { ok: false, errors }

  // Semua valid: terapkan sekaligus.
  const now = new Date().toISOString()
  for (const st of steps) st.apply()
  for (const h of hosts) getConfig(s, h).updatedAt = now
  // Hostname diambil setelah semua bagian diterapkan (bisa ikut berubah di request ini).
  const generated = steps
    .find((st) => st.generated)
    ?.generated?.map((g) => ({
      ...g,
      hostname: hosts.find((h) => h.mac === g.mac)?.hostname ?? null,
    }))
  return {
    ok: true,
    result: { updated: hosts.length, generatedPasswords: generated },
  }
}

/** Mulai instalasi: host wajib punya OS + credentials. */
export function installHosts(hostIds: string[]): InstallResult {
  const s = mockDb()
  const result: InstallResult = { started: [], failed: [] }
  for (const id of new Set(hostIds)) {
    const h = s.hosts.get(id)
    if (!h) {
      result.failed.push({ hostId: id, message: "Host tidak ditemukan" })
      continue
    }
    const cfg = getConfig(s, h)
    const missing = [
      !cfg.os && "OS image",
      (!cfg.username || !cfg.passwordHash) && "credentials",
    ].filter(Boolean)
    if (missing.length) {
      result.failed.push({
        hostId: id,
        message: `${label(h)}: belum ada ${missing.join(" dan ")}`,
      })
      continue
    }
    if (["booting", "installing", "configuring"].includes(h.status)) {
      result.failed.push({
        hostId: id,
        message: `${label(h)}: instalasi sedang berjalan`,
      })
      continue
    }
    startInstall(s, h, cfg.os!.osImageId)
    result.started.push(id)
  }
  return result
}
