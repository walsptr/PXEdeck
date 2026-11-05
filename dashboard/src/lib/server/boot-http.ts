// Helper respons endpoint /boot/** (firmware/installer, bukan /api).
// Semua respons `Cache-Control: no-store`. Penolakan akses file konfigurasi
// memakai 404 seragam (`notFoundUniform`) — alasan hanya dicatat tanpa token.

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

/**
 * Catat alasan penolakan TANPA token (DEC-008). `mac` sudah dinormalisasi
 * atau "-" bila invalid. Dimatikan saat test (PXE_LOG_BOOT=0).
 */
export function logBootDenied(path: "file" | "status", mac: string, reason: string) {
  if (process.env.PXE_LOG_BOOT === "0" || process.env.VITEST) return
  console.warn(`[boot] tolak ${path} mac=${mac} alasan=${reason}`)
}
