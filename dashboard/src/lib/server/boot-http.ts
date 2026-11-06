// Helper respons endpoint /boot/** (firmware/installer, bukan /api).
// Semua respons `Cache-Control: no-store`. Penolakan akses file konfigurasi
// memakai 404 seragam (`notFoundUniform`) — alasan hanya dicatat tanpa token.

import { parseBootMac } from "@/lib/server/discovery"

const NO_STORE = "no-store"

export function textResponse(body: string, status = 200, type = "text/plain; charset=utf-8") {
  return new Response(body, {
    status,
    headers: { "Content-Type": type, "Cache-Control": NO_STORE },
  })
}

/** 404 identik untuk semua penolakan (DEC-008). */
export function notFoundUniform() {
  return textResponse("not found\n", 404)
}

/** Escape karakter non-cetak (termasuk CR/LF) agar satu penolakan = satu baris log (CR-4-8). */
export function escapeLogValue(v: string, max = 200): string {
  const out = v
    .slice(0, max)
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
  return v.length > max ? `${out}…` : out
}

export type BootDeniedPath = "ipxe" | "file" | "status" | "log"

/**
 * Format baris log penolakan (fungsi murni, CR-4-8/SR-4-4). `mac` = MAC ternormalisasi dari
 * segmen URL atau "-" bila invalid (segmen mentah tidak pernah dicetak); `reason` di-escape.
 * Token tidak pernah dicetak (DEC-008).
 */
export function bootDeniedLine(path: BootDeniedPath, rawMac: string, reason: string): string {
  const mac = parseBootMac(rawMac) ?? "-"
  return `[boot] tolak ${path} mac=${mac} alasan=${escapeLogValue(reason)}`
}

// ---- SR-5-3 (M6, DEC-017 §6): throttle log penolakan ----
// Endpoint /boot/** terbuka untuk semua klien PXE; tanpa batas, request yang ditolak bisa membanjiri
// journal. Per jalur (`ipxe|file|status|log`) maks `BOOT_LOG_MAX_PER_WINDOW` baris detail per
// jendela tetap `BOOT_LOG_WINDOW_MS`; sisanya hanya dihitung lalu satu baris ringkasan berisi
// JUMLAH saja (tanpa MAC/IP/alasan dari input) dicatat saat jendela berganti (timer `unref`, atau
// panggilan pertama sesudah jendela habis — mana yang lebih dulu).

export const BOOT_LOG_MAX_PER_WINDOW = 20
export const BOOT_LOG_WINDOW_MS = 60_000

type ThrottleWindow = { start: number; shown: number; suppressed: number; timer?: ReturnType<typeof setTimeout> }

export type BootLogThrottle = {
  /** Catat `line` untuk `path` bila kuota jendela masih ada. */
  log(path: BootDeniedPath, line: string): void
  /** Tulis ringkasan semua jendela yang menekan baris lalu reset (test/shutdown). */
  flush(): void
  /** Buang semua jendela + timer TANPA menulis ringkasan. */
  dispose(): void
}

/** Baris ringkasan, mis. `[boot] 80 penolakan log ditekan dalam 60 dtk`. */
export function bootSuppressedLine(path: BootDeniedPath, n: number): string {
  return `[boot] ${n} penolakan ${path} ditekan dalam ${BOOT_LOG_WINDOW_MS / 1000} dtk`
}

/** Throttle per jalur dengan jam dan logger injeksi (fungsi murni terhadap `now`/`warn`). */
export function createBootLogThrottle(
  warn: (line: string) => void,
  now: () => number = Date.now,
): BootLogThrottle {
  const windows = new Map<BootDeniedPath, ThrottleWindow>()
  const close = (path: BootDeniedPath) => {
    const w = windows.get(path)
    if (!w) return
    clearTimeout(w.timer)
    windows.delete(path)
    if (w.suppressed > 0) warn(bootSuppressedLine(path, w.suppressed))
  }
  return {
    log(path, line) {
      const t = now()
      let w = windows.get(path)
      if (w && t - w.start >= BOOT_LOG_WINDOW_MS) {
        close(path)
        w = undefined
      }
      if (!w) {
        w = { start: t, shown: 0, suppressed: 0 }
        windows.set(path, w)
      }
      if (w.shown < BOOT_LOG_MAX_PER_WINDOW) {
        w.shown++
        warn(line)
        return
      }
      w.suppressed++
      if (!w.timer) {
        const cur = w
        cur.timer = setTimeout(() => {
          if (windows.get(path) === cur) close(path)
        }, Math.max(0, cur.start + BOOT_LOG_WINDOW_MS - t))
        cur.timer.unref?.()
      }
    },
    flush() {
      for (const p of [...windows.keys()]) close(p)
    },
    dispose() {
      for (const w of windows.values()) clearTimeout(w.timer)
      windows.clear()
    },
  }
}

const THROTTLE_KEY = Symbol.for("pxe.bootLogThrottle")
const gt = globalThis as typeof globalThis & { [THROTTLE_KEY]?: BootLogThrottle }

function bootThrottle(): BootLogThrottle {
  return (gt[THROTTLE_KEY] ??= createBootLogThrottle((l) => console.warn(l)))
}

/** Reset throttle global tanpa menulis ringkasan (test). */
export function resetBootLogThrottle(): void {
  gt[THROTTLE_KEY]?.dispose()
  delete gt[THROTTLE_KEY]
}

/**
 * Catat alasan penolakan TANPA token (DEC-008) lewat throttle SR-5-3. Dimatikan saat test
 * (PXE_LOG_BOOT=0 / Vitest).
 */
export function logBootDenied(path: BootDeniedPath, rawMac: string, reason: string) {
  if (process.env.PXE_LOG_BOOT === "0" || process.env.VITEST) return
  bootThrottle().log(path, bootDeniedLine(path, rawMac, reason))
}
