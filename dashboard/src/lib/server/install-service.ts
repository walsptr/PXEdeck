// Mulai instalasi (single & bulk). Validasi per host; host yang lolos diubah
// di dalam satu transaksi.
import type { InstallResult } from "@/lib/host-config"
import { IN_PROGRESS_STATUSES, type Host } from "@/lib/types"
import { getDb, tx } from "@/lib/server/db"
import { peekConfig } from "@/lib/server/db/repos/configs"
import { getHost, setHostStatus } from "@/lib/server/db/repos/hosts"
import {
  getImage,
  imageAvailability,
} from "@/lib/server/db/repos/os-images"
import { getSettings } from "@/lib/server/settings"

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
  return null
}

/** Mulai instalasi untuk host yang memenuhi syarat; sisanya gagal per host. */
export function installHosts(hostIds: string[]): InstallResult {
  getDb()
  return tx(() => {
    const result: InstallResult = { started: [], failed: [] }
    const now = new Date().toISOString()
    for (const id of new Set(hostIds)) {
      const h = getHost(id)
      if (!h) {
        result.failed.push({ hostId: id, message: "Host tidak ditemukan" })
        continue
      }
      const err = installBlocker(h)
      if (err) {
        result.failed.push({ hostId: id, message: err })
        continue
      }
      setHostStatus(id, "booting", now, {
        osAssigned: peekConfig(id)!.os!.osImageId,
      })
      result.started.push(id)
    }
    return result
  })
}
