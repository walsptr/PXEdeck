// Hook start server (dipanggil `src/instrumentation.ts`, runtime nodejs saja).
//  - Validasi settings fail-fast: env tidak valid (mis. PXE_TRUST_PROXY=1 tanpa
//    PXE_DNSMASQ_LEASES, DEC-013) → `register()` melempar → server tidak start.
//  - Peringatan konfigurasi (flag dev insecure) dicatat satu baris per item.
import { getSettings, settingsWarnings, type Settings } from "@/lib/server/settings"

export type StartupLogger = Pick<Console, "warn">

/** Jalankan pemeriksaan start. Mengembalikan settings aktif. */
export function onServerStart(logger: StartupLogger = console): Settings {
  const s = getSettings()
  for (const w of settingsWarnings(s)) logger.warn(`[pxe] ${w}`)
  return s
}
