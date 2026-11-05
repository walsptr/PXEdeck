// Hook start server (dipanggil `src/instrumentation.ts`, runtime nodejs saja).
//  - Validasi settings fail-fast: env tidak valid (mis. PXE_TRUST_PROXY=1 tanpa
//    PXE_DNSMASQ_LEASES, DEC-013) → `register()` melempar → server tidak start.
//  - Peringatan konfigurasi (flag dev insecure) dicatat satu baris per item.
//  - Timer watchdog job (DEC-014 §2) dimulai sekali per proses.
import { getSettings, settingsWarnings, type Settings } from "@/lib/server/settings"
import { startWatchdog } from "@/lib/server/watchdog"

export type StartupLogger = Pick<Console, "warn" | "error">

/** Jalankan pemeriksaan start. Mengembalikan settings aktif. */
export function onServerStart(logger: StartupLogger = console, watchdog = true): Settings {
  const s = getSettings()
  for (const w of settingsWarnings(s)) logger.warn(`[pxe] ${w}`)
  if (watchdog) startWatchdog(logger)
  return s
}

/**
 * Dipanggil `instrumentation.ts`: konfigurasi tidak valid → pesan satu baris lalu proses keluar
 * (exit 1) sehingga server benar-benar menolak start (DEC-013), bukan tetap listen dan membalas 500.
 */
export function startOrExit(
  logger: StartupLogger = console,
  exit: (code: number) => never = (c) => process.exit(c),
): Settings {
  try {
    return onServerStart(logger)
  } catch (e) {
    logger.error(`[pxe] start ditolak: ${(e as Error).message}`)
    return exit(1)
  }
}
