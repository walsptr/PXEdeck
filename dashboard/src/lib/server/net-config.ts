// Sumber tunggal parameter subnet management di server (DEC-006). Sejak M4
// nilainya bagian dari `getSettings()` (src/lib/server/settings.ts, env
// PXE_MGMT_*, PXE_DHCP_RANGE/PXE_DYNAMIC_RANGE, PXE_SERVER_IP). Modul ini
// dipertahankan sebagai pembungkus tipis untuk pemanggil lama.
import type { MgmtNetwork } from "@/lib/net"
import { getSettings } from "@/lib/server/settings"

/**
 * Parameter subnet management aktif. Env dibaca ulang tiap panggilan (di-cache
 * per kombinasi nilai). Env tidak konsisten → Error (fail fast).
 */
export function getMgmtNetwork(): MgmtNetwork {
  return getSettings().network
}
