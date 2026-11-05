// Mulai instalasi (single & bulk, M4-T5). Per host: validasi (OS +
// credentials eksplisit, tidak sedang berjalan, image dikenal + bootable +
// media tersedia). Host yang lolos: job `install` status `booting` dengan
// token baru (DB hanya menyimpan sha256; plaintext dibuang — token yang
// dipakai installer dibuat ulang saat script iPXE dilayani), host `booting`
// + `osAssigned`. Semua dalam satu transaksi. Token tidak pernah dikembalikan.
// M5 (DEC-014): event "Job install dibuat" + pemangkasan riwayat job final host
// (`PXE_JOB_HISTORY_PER_HOST`) di transaksi yang sama. Host `failed` boleh
// di-install ulang (job baru).
import type { InstallResult } from "@/lib/host-config"
import { IN_PROGRESS_STATUSES, type Host } from "@/lib/types"
import { getDb, tx } from "@/lib/server/db"
import { peekConfig } from "@/lib/server/db/repos/configs"
import { getHost, setHostStatus } from "@/lib/server/db/repos/hosts"
import { insertJob, pruneHostHistory, supersedeActiveJobs } from "@/lib/server/db/repos/jobs"
import {
  getImage,
  imageAvailability,
} from "@/lib/server/db/repos/os-images"
import { logJobEvent } from "@/lib/server/job-lifecycle"
import { getSettings } from "@/lib/server/settings"
import { newToken } from "@/lib/server/tokens"

function label(h: Host) {
  return h.hostname ?? h.mac
}

/**
 * Alasan host belum bisa di-install, atau null. Credentials harus tersimpan
 * eksplisit di config host (tidak ada default/seed — SR-2-1/CR-3-12).
 */
export function installBlocker(
  h: Host,
  mediaRoot: string = getSettings().mediaRoot,
  exists?: (p: string) => boolean,
): string | null {
  const cfg = peekConfig(h.id)
  const missing = [
    !cfg?.os && "OS image",
    (!cfg?.username || !cfg?.passwordHash) && "credentials",
  ].filter(Boolean)
  if (missing.length) return `${label(h)}: belum ada ${missing.join(" dan ")}`
  if (IN_PROGRESS_STATUSES.includes(h.status))
    return `${label(h)}: instalasi sedang berjalan`
  const img = getImage(cfg!.os!.osImageId)
  if (!img) return `${label(h)}: OS image ${cfg!.os!.osImageId} tidak dikenal`
  const { available, reason } = imageAvailability(img, mediaRoot, exists)
  if (!available) return `${label(h)}: ${reason}`
  if (cfg!.os!.partition === "custom")
    return `${label(h)}: skema partisi custom belum didukung`
  if (cfg!.sshUser && cfg!.sshUser !== cfg!.username)
    return `${label(h)}: user target SSH berbeda dari user Credentials belum didukung`
  return null
}

/** Mulai instalasi untuk host yang memenuhi syarat; sisanya gagal per host. */
export function installHosts(
  hostIds: string[],
  now: Date = new Date(),
): InstallResult {
  const s = getSettings()
  getDb()
  return tx(() => {
    const result: InstallResult = { started: [], failed: [] }
    const at = now.toISOString()
    for (const id of new Set(hostIds)) {
      const h = getHost(id)
      if (!h) {
        result.failed.push({ hostId: id, message: "Host tidak ditemukan" })
        continue
      }
      const err = installBlocker(h, s.mediaRoot)
      if (err) {
        result.failed.push({ hostId: id, message: err })
        continue
      }
      const osImageId = peekConfig(id)!.os!.osImageId
      // Job aktif lama (seharusnya tidak ada) dicabut lebih dulu → failed `superseded`.
      for (const old of supersedeActiveJobs(id, at)) {
        logJobEvent(old, { at, kind: "stage", level: "error", source: "install", message: "Failed: digantikan job install baru" })
      }
      const jobId = `job-${crypto.randomUUID()}`
      insertJob({
        id: jobId,
        hostId: id,
        kind: "install",
        osImageId,
        status: "booting",
        stages: [{ stage: "booting", at, source: "install" }],
        tokenHash: newToken().hash,
        tokenExpiresAt: new Date(now.getTime() + s.tokenTtlMin * 60_000).toISOString(),
        bootServedAt: null,
        createdAt: at,
        updatedAt: at,
        finishedAt: null,
      })
      setHostStatus(id, "booting", at, { osAssigned: osImageId })
      logJobEvent(jobId, {
        at,
        kind: "stage",
        level: "info",
        source: "install",
        message: `Job install dibuat (OS ${osImageId}); menunggu PXE boot`,
      })
      pruneHostHistory(id, s.jobHistoryPerHost)
      result.started.push(id)
    }
    return result
  })
}
