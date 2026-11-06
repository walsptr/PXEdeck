// Validasi semantik + penerapan konfigurasi host. Semua aturan dari form
// diulang di sini: form hanya membantu, server yang memutuskan.
//
// Atomisitas (G3-2): satu-satunya kerja async (fingerprint SHA-256 key SSH
// baru via Web Crypto) dikerjakan SEBELUM store dibaca (`prepareNewKeys`).
// Validasi + penerapan (`applyConfigPrepared`) sepenuhnya sinkron, sehingga
// dua request paralel tidak bisa sama-sama lolos cek IP/hostname bentrok.
//
// Sejak M4 (DEC-007) data ada di SQLite: validasi + penerapan berjalan di
// dalam satu transaksi `BEGIN IMMEDIATE` (`tx`), constraint UNIQUE (MAC, IP
// statis, hostname case-insensitive, fingerprint key) menjadi pertahanan
// kedua → pelanggarannya dipetakan ke 422 yang sama.
//
// Aturan yang perlu diketahui klien:
//  - Network statis (DEC-006): prefix wajib = prefix subnet management,
//    IP & gateway wajib host di subnet management (jadi selalu satu subnet),
//    gateway di luar range DHCP dinamis, IP host ≠ gateway payload, DNS IPv4
//    bukan alamat khusus, tidak terikat subnet (DEC-011).
//  - `updated`/`updatedAt` hanya untuk host yang benar-benar berubah (mode
//    credentials CSV: hanya host yang ada di CSV).
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
import {
  AUTHORIZED_KEYS_MAX_BYTES,
  authorizedKeysBytes,
  type ApiFieldError,
  type ConfigPayload,
  type CsvRowResult,
  type HostConfig,
  type PublicHostConfig,
  type SaveResult,
  type SshKey,
  type SshSection,
} from "@/lib/host-config"
import { validateHostname } from "@/lib/hostname"
import {
  validateIpAssignments,
  validateStaticNetwork,
  type IpUsage,
} from "@/lib/net"
import { canonicalOsImageId } from "@/lib/os-images"
import { parseSshKey, sshFingerprint, type ParsedSshKey } from "@/lib/ssh-key"
import type { Host } from "@/lib/types"
import { getDb, isUniqueViolation, tx, uniqueViolationTarget } from "@/lib/server/db"
import { configOrDefault, saveConfig } from "@/lib/server/db/repos/configs"
import { getHost, listHosts } from "@/lib/server/db/repos/hosts"
import { getImage } from "@/lib/server/db/repos/os-images"
import {
  getKey,
  insertKey,
  listKeys,
} from "@/lib/server/db/repos/ssh-keys"
import { getMgmtNetwork } from "@/lib/server/net-config"

export function toPublicConfig(c: HostConfig): PublicHostConfig {
  const { passwordHash, ...rest } = c
  return { ...rest, hasPassword: Boolean(passwordHash) }
}

function label(h: Host) {
  return h.hostname ?? h.mac
}

/** IP yang dipakai host DI LUAR batch (IP management + lease aktif). */
function ipUsage(all: Host[], batch: Set<string>): IpUsage {
  const used = new Map<string, string>()
  for (const h of all) {
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
  csv: string,
  hostIds: string[],
): { rows: CsvRowResult[]; creds: CsvCred[] } {
  const byMac = new Map<string, Host>()
  for (const id of hostIds) {
    const h = getHost(id)
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
    // Kolom mentah yang invalid tidak di-echo (SR-3-4 / AC-3.9): bila urutan
    // kolom salah, kolom itu bisa berisi password.
    rows.push({
      line: i + offset,
      mac: mac ?? "",
      username: uErr ? "" : username,
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
  /** Host yang benar-benar diubah langkah ini; undefined = semua host batch. */
  touches?: string[]
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


/** Pesan 422 untuk pelanggaran constraint unik (pertahanan kedua). */
function uniqueError(e: unknown): ApiFieldError {
  const t = uniqueViolationTarget(e) ?? ""
  if (/hostname/.test(t))
    return { section: "hostname", message: "Hostname sudah dipakai host lain" }
  if (/ip/.test(t))
    return { section: "network", message: "IP sudah dipakai host lain" }
  if (/fingerprint/.test(t))
    return { section: "ssh", message: "Key sudah ada di library" }
  return { section: "hostIds", message: "Data bentrok dengan host lain" }
}

/**
 * Bagian sinkron `applyConfig`. `preparedKeys[i]` wajib hasil
 * `prepareNewKeys(p.ssh.newKeys)` (urutan sama). Validasi + apply dalam satu
 * transaksi; gagal validasi → tidak ada perubahan.
 */
export function applyConfigPrepared(
  hostIds: string[],
  p: ConfigPayload,
  preparedKeys: PreparedNewKey[],
): ApplyResult {
  if (preparedKeys.length !== (p.ssh?.newKeys.length ?? 0)) {
    throw new Error("preparedKeys tidak sesuai dengan ssh.newKeys")
  }
  getDb()
  try {
    return tx(() => applyInTx(hostIds, p, preparedKeys))
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, errors: [uniqueError(e)] }
    throw e
  }
}

function applyInTx(
  hostIds: string[],
  p: ConfigPayload,
  preparedKeys: PreparedNewKey[],
): ApplyResult {
  const errors: ApiFieldError[] = []
  const ids = [...new Set(hostIds)]
  const all = listHosts()
  const byId = new Map(all.map((h) => [h.id, h]))
  const hosts: Host[] = []
  for (const id of ids) {
    const h = byId.get(id)
    if (h) hosts.push({ ...h })
    else
      errors.push({
        section: "hostIds",
        hostId: id,
        message: "Host tidak ditemukan",
      })
  }
  if (errors.length) return { ok: false, errors }
  const batch = new Set(ids)
  const hostById = new Map(hosts.map((h) => [h.id, h]))
  // Config kerja per host (tersimpan atau default); ditulis sekaligus di akhir.
  const cfgs = new Map(hosts.map((h) => [h.id, configOrDefault(h)]))
  const cfg = (h: Host) => cfgs.get(h.id)!
  const steps: Prepared[] = []

  // ---- OS ----
  if (p.os) {
    const os = { ...p.os, osImageId: canonicalOsImageId(p.os.osImageId) }
    if (!getImage(os.osImageId)) {
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
          cfg(h).os = { ...os, disk: os.disk.trim() }
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
        const missing = hosts.filter((h) => !cfg(h).passwordHash)
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
            const hc = cfg(h)
            hc.username = c.username.trim()
            // Salt acak per host: hash berbeda walau password sama.
            if (c.password) hc.passwordHash = encrypt(c.password)
            Object.assign(hc, flags)
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
            const hc = cfg(h)
            hc.username = generated[i].username
            hc.passwordHash = encrypt(generated[i].password)
            Object.assign(hc, flags)
          })
        },
      })
    } else {
      const { rows, creds } = checkCredentialsCsv(c.csv, ids)
      const bad = rows.filter((r) => r.errors.length)
      if (bad.length) {
        errors.push({
          section: "credentials",
          message: `${bad.length} baris CSV tidak valid (baris ${bad.map((r) => r.line).join(", ")})`,
        })
      }
      steps.push({
        // Host terpilih yang tidak ada di CSV tidak diubah (CR-3-3).
        touches: creds.map((cr) => cr.hostId),
        apply: () => {
          for (const cr of creds) {
            const hc = cfgs.get(cr.hostId)!
            hc.username = cr.username
            hc.passwordHash = encrypt(cr.password)
            Object.assign(hc, flags)
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
            cfg(h).network = { mode: "dhcp" }
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
      // IP host tidak boleh sama dengan gateway dari payload (CR-3-9); gateway
      // server sudah ditolak oleh validateStaticIp.
      const usage = ipUsage(all, batch)
      const gw = n.gateway.trim()
      if (!usage.used.has(gw)) usage.used.set(gw, `gateway ${gw}`)
      const ipErrors = validateIpAssignments(assignments, usage, net)
      for (const [hostId, message] of ipErrors) {
        errors.push({
          section: "network",
          hostId,
          message: `${label(hostById.get(hostId)!)}: ${message}`,
        })
      }
      steps.push({
        apply: () => {
          for (const { hostId, ip } of assignments) {
            const h = hostById.get(hostId)!
            cfg(h).network = {
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
    // Unik case-insensitive (sama dengan indeks hosts_hostname_uq).
    const taken = new Map<string, string>()
    for (const h of all) {
      if (!batch.has(h.id) && h.hostname)
        taken.set(h.hostname.toLowerCase(), h.mac)
    }
    const seen = new Set<string>()
    const names = hosts.map((h) => ({
      h,
      name: (p.hostname!.assignments[h.id] ?? "").trim(),
    }))
    for (const { h, name } of names) {
      const lower = name.toLowerCase()
      const err =
        validateHostname(name) ??
        (seen.has(lower) ? "Duplikat dalam batch" : null) ??
        (taken.has(lower) ? `Sudah dipakai ${taken.get(lower)}` : null)
      if (err)
        errors.push({
          section: "hostname",
          hostId: h.id,
          message: `${h.mac}: ${err}`,
        })
      seen.add(lower)
    }
    steps.push({
      apply: () => {
        for (const { h, name } of names) h.hostname = name
      },
    })
  }

  // ---- SSH keys ----
  const newLibrary: SshKey[] = []
  if (p.ssh) {
    const ssh = p.ssh
    const keyIds = [...new Set(ssh.keyIds)]
    for (const id of keyIds) {
      if (!getKey(id))
        errors.push({
          section: "ssh",
          message: `Key ${id} tidak ada di library`,
        })
    }
    if (ssh.user.trim()) {
      const uErr = validateUsername(ssh.user)
      if (uErr) errors.push({ section: "ssh", message: `User target: ${uErr}` })
    }
    const extra: string[] = []
    const libraryByFp = new Map(listKeys().map((k) => [k.fingerprint, k]))
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
    // CR-6-1: total authorized_keys host (key library terpilih + key baru) dibatasi agar
    // late_command installer tidak melampaui MAX_ARG_STRLEN.
    const keyBytes = authorizedKeysBytes([
      ...keyIds.map((id) => getKey(id)?.publicKey ?? ""),
      ...newLibrary.map((k) => k.publicKey),
      ...extra,
    ])
    if (keyBytes > AUTHORIZED_KEYS_MAX_BYTES) {
      errors.push({
        section: "ssh",
        message: `Total SSH key ${keyBytes} byte melebihi batas ${AUTHORIZED_KEYS_MAX_BYTES} byte (32 KiB) per host — kurangi jumlah key atau pakai key yang lebih kecil (mis. ed25519)`,
      })
    }
    steps.push({
      apply: () => {
        for (const h of hosts) {
          const hc = cfg(h)
          hc.sshKeyIds = [...keyIds, ...newLibrary.map((k) => k.id)]
          hc.extraKeys = extra
          hc.sshUser = ssh.user.trim() || null
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

  // Semua valid: terapkan ke objek kerja, lalu tulis ke DB.
  const now = new Date().toISOString()
  for (const st of steps) st.apply()
  // Hanya host yang benar-benar diubah yang dihitung & diberi updatedAt (CR-3-3).
  const touched = steps.every((st) => st.touches)
    ? new Set(steps.flatMap((st) => st.touches!))
    : batch
  const changed = hosts.filter((h) => touched.has(h.id))
  for (const h of hosts) if (touched.has(h.id)) cfg(h).updatedAt = now

  persist(hosts, cfgs, newLibrary)

  // Hostname diambil setelah semua bagian diterapkan (bisa ikut berubah di request ini).
  const generated = steps
    .find((st) => st.generated)
    ?.generated?.map((g) => ({
      ...g,
      hostname: hosts.find((h) => h.mac === g.mac)?.hostname ?? null,
    }))
  return {
    ok: true,
    result: { updated: changed.length, generatedPasswords: generated },
  }
}

/**
 * Tulis host + config batch. Dua fase (kosongkan hostname & config batch
 * dulu) supaya pertukaran hostname/IP di dalam batch tidak melanggar indeks
 * unik di tengah jalan.
 */
function persist(
  hosts: Host[],
  cfgs: Map<string, ReturnType<typeof configOrDefault>>,
  newLibrary: SshKey[],
) {
  const db = getDb()
  for (const k of newLibrary) insertKey(k)
  const clearName = db.prepare("UPDATE hosts SET hostname = NULL WHERE id = ?")
  const clearCfg = db.prepare("DELETE FROM host_configs WHERE host_id = ?")
  for (const h of hosts) {
    clearName.run(h.id)
    clearCfg.run(h.id)
  }
  const upd = db.prepare(
    "UPDATE hosts SET hostname = ?, mgmt_ip = ?, os_assigned = ? WHERE id = ?",
  )
  for (const h of hosts) {
    upd.run(h.hostname, h.mgmtIp, h.osAssigned, h.id)
    saveConfig(h.id, cfgs.get(h.id)!)
  }
}
