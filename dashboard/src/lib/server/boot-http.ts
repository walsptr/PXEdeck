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

export type BootDeniedPath = "file" | "status" | "log"

/**
 * Format baris log penolakan (fungsi murni, CR-4-8/SR-4-4). `mac` = MAC ternormalisasi dari
 * segmen URL atau "-" bila invalid (segmen mentah tidak pernah dicetak); `reason` di-escape.
 * Token tidak pernah dicetak (DEC-008).
 */
export function bootDeniedLine(path: BootDeniedPath, rawMac: string, reason: string): string {
  const mac = parseBootMac(rawMac) ?? "-"
  return `[boot] tolak ${path} mac=${mac} alasan=${escapeLogValue(reason)}`
}

/** Catat alasan penolakan TANPA token (DEC-008). Dimatikan saat test (PXE_LOG_BOOT=0). */
export function logBootDenied(path: BootDeniedPath, rawMac: string, reason: string) {
  if (process.env.PXE_LOG_BOOT === "0" || process.env.VITEST) return
  console.warn(bootDeniedLine(path, rawMac, reason))
}
