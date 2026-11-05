// Timer watchdog in-process (M5-T3, DEC-014 §2, O6). Sumber kebenaran tetap sapuan lazy di setiap
// baca status; timer ini hanya memastikan job yang tidak lagi dibaca siapa pun tetap ditandai gagal.
// Satu timer per proses (simbol global, aman terhadap HMR dev / pemanggilan ganda), `unref` agar
// tidak menahan proses keluar. Dimulai dari `instrumentation.ts` (runtime nodejs saja).
import { getSettings } from "@/lib/server/settings"
import { pruneSessions } from "@/lib/server/auth/session"
import { sweepJobs } from "@/lib/server/job-lifecycle"

type WatchdogState = { timer: ReturnType<typeof setInterval>; intervalSec: number }

const KEY = Symbol.for("pxe.watchdog")
const g = globalThis as typeof globalThis & { [KEY]?: WatchdogState }

export type WatchdogLogger = Pick<Console, "error">

/**
 * Satu putaran sapuan job + pembersihan sesi kedaluwarsa (M6, `pruneSessions`); error dicatat
 * (tanpa data sensitif) dan tidak menghentikan timer. Mengembalikan jumlah job yang ditandai gagal.
 */
export function watchdogTick(logger: WatchdogLogger = console): number {
  let n: number
  try {
    n = sweepJobs(new Date()).length
  } catch (e) {
    // Satu baris per putaran; settings/DB rusak juga membuat pembersihan sesi gagal → lewati.
    logger.error(`[watchdog] sapuan gagal: ${(e as Error).message}`)
    return 0
  }
  try {
    pruneSessions(new Date())
  } catch (e) {
    logger.error(`[watchdog] pembersihan sesi gagal: ${(e as Error).message}`)
  }
  return n
}

/** Mulai timer (idempoten). Mengembalikan interval (detik) yang aktif. */
export function startWatchdog(logger: WatchdogLogger = console): number {
  const existing = g[KEY]
  if (existing) return existing.intervalSec
  const intervalSec = getSettings().watchdogIntervalSec
  const timer = setInterval(() => watchdogTick(logger), intervalSec * 1000)
  timer.unref?.()
  g[KEY] = { timer, intervalSec }
  return intervalSec
}

/** Hentikan timer (test / shutdown). */
export function stopWatchdog(): void {
  const st = g[KEY]
  if (st) clearInterval(st.timer)
  delete g[KEY]
}

export function watchdogRunning(): boolean {
  return g[KEY] !== undefined
}
