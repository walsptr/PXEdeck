// Discovery host + pemilihan script boot (M4-T3, docs/design/M4-plan.md §2.3).
//  1. MAC dinormalisasi (invalid → null → 400 di route).
//  2. Verifikasi IP: bila lease dnsmasq dikonfigurasi dan IP sumber bukan IP
//     lease MAC itu → "tidak terverifikasi": host tidak dibuat/diubah, balas
//     boot lokal (tanpa token).
//  3. Upsert host (discovered bila baru; vendor OUI, firmware, current_ip,
//     last_seen).
//  4. Job aktif `booting|installing` + image bootable & tersedia → script
//     installer dengan token BARU (hash disimpan, token lama tak berlaku;
//     plaintext hanya ada di script ini). Selain itu → boot lokal (atau loop
//     tunggu bila PXE_UNKNOWN_HOST_ACTION=wait dan host belum punya OS).
import { normalizeMac } from "@/lib/credentials"
import { lookupVendor } from "@/lib/oui"
import type { Firmware, Host } from "@/lib/types"
import {
  installerScript,
  localBootScript,
  waitScript,
} from "@/lib/server/boot-script"
import { getDb, tx } from "@/lib/server/db"
import {
  getHost,
  hostIdFromMac,
  insertHost,
  listHosts,
  updateHost,
} from "@/lib/server/db/repos/hosts"
import { getActiveJob, updateJob } from "@/lib/server/db/repos/jobs"
import { getImage, imageAvailability } from "@/lib/server/db/repos/os-images"
import { currentLeases, ipMatchesLease } from "@/lib/server/leases"
import { getSettings } from "@/lib/server/settings"
import { newToken } from "@/lib/server/tokens"

const STRICT_MAC_RE = /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/i

/** MAC dari segmen URL (`aa:bb:..`, `AA-BB-..`, `aabb..`) → bentuk normal, atau null. */
export function parseBootMac(raw: string): string | null {
  const v = raw.trim()
  return STRICT_MAC_RE.test(v) ? normalizeMac(v) : null
}

export function firmwareFromPlatform(p: string | null): Firmware | null {
  if (p === "efi") return "uefi"
  if (p === "pcbios") return "bios"
  return null
}

export type BootRequest = {
  mac: string
  platform: string | null
  ip: string | null
  /** Iterasi loop tunggu (`wait=`), 0 bila tidak ada. */
  wait: number
  now?: Date
}

export type BootDecision =
  | { kind: "unverified"; script: string }
  | { kind: "local"; script: string; host: Host }
  | { kind: "wait"; script: string; host: Host }
  | { kind: "installer"; script: string; host: Host; jobId: string }

/** Upsert host dari request boot terverifikasi. Panggil di dalam `tx`. */
export function upsertSeenHost(
  mac: string,
  firmware: Firmware | null,
  ip: string | null,
  at: string,
): Host {
  const id = hostIdFromMac(mac)
  const existing = getHost(id)
  if (!existing) {
    insertHost({
      id,
      mac,
      hostname: null,
      currentIp: ip,
      mgmtIp: null,
      vendor: lookupVendor(mac),
      firmware,
      osInstalled: null,
      osAssigned: null,
      status: "discovered",
      statusSince: at,
      lastSeen: at,
    })
  } else {
    updateHost(id, {
      lastSeen: at,
      ...(ip ? { currentIp: ip } : {}),
      ...(firmware ? { firmware } : {}),
      ...(existing.vendor ? {} : { vendor: lookupVendor(mac) }),
    })
  }
  return getHost(id)!
}

/** Tangani `GET /boot/{mac}.ipxe` (MAC sudah dinormalisasi). */
export function decideBoot(req: BootRequest): BootDecision {
  const s = getSettings()
  const now = (req.now ?? new Date()).toISOString()
  if (ipMatchesLease(req.mac, req.ip) === false) {
    return { kind: "unverified", script: localBootScript() }
  }
  getDb()
  return tx(() => {
    const host = upsertSeenHost(
      req.mac,
      firmwareFromPlatform(req.platform),
      req.ip,
      now,
    )
    const job = getActiveJob(host.id)
    if (job && (job.status === "booting" || job.status === "installing")) {
      const img = getImage(job.osImageId)
      if (img && imageAvailability(img, s.mediaRoot).available) {
        const { token, hash } = newToken()
        const expires = new Date(
          Date.parse(now) + s.tokenTtlMin * 60_000,
        ).toISOString()
        const script = installerScript({
          method: img.method,
          mediaUrl: s.mediaUrl,
          mediaRoot: s.mediaRoot,
          serverIp: s.network.pxeServer,
          configUrl: `${s.baseUrl}/boot/${req.mac}/${token}/`,
          source: img.source,
          extraArgs: s.kernelExtraArgs,
        })
        updateJob(
          job.id,
          {
            tokenHash: hash,
            tokenExpiresAt: expires,
            bootServedAt: now,
            stages: [
              ...job.stages,
              { stage: "booting", at: now, source: "boot-script" },
            ],
          },
          now,
        )
        return { kind: "installer", script, host, jobId: job.id }
      }
    }
    if (
      s.unknownHostAction === "wait" &&
      !host.osInstalled &&
      !job
    ) {
      return {
        kind: "wait",
        script: waitScript(s.baseUrl, req.mac, req.wait),
        host,
      }
    }
    return { kind: "local", script: localBootScript(), host }
  })
}

/**
 * Sinkron lease → host (AC-4.11): MAC di file lease yang belum dikenal
 * dibuat sebagai `discovered` dengan `current_ip`. Host yang sudah ada tidak
 * diubah. Tanpa file lease → no-op.
 */
export function syncLeases(now: Date = new Date()): number {
  const leases = currentLeases()
  if (!leases || leases.length === 0) return 0
  getDb()
  return tx(() => {
    const known = new Set(listHosts().map((h) => h.mac))
    let added = 0
    const at = now.toISOString()
    for (const l of leases) {
      if (known.has(l.mac)) continue
      known.add(l.mac)
      insertHost({
        id: hostIdFromMac(l.mac),
        mac: l.mac,
        hostname: null,
        currentIp: l.ip,
        mgmtIp: null,
        vendor: lookupVendor(l.mac),
        firmware: null,
        osInstalled: null,
        osAssigned: null,
        status: "discovered",
        statusSince: at,
        lastSeen: at,
      })
      added++
    }
    return added
  })
}
