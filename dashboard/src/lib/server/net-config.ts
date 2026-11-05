// Sumber tunggal parameter subnet management di server (DEC-006). Nilai dari
// env (PXE_MGMT_CIDR, PXE_MGMT_GATEWAY, PXE_MGMT_DNS, PXE_DYNAMIC_RANGE,
// PXE_SERVER_IP) dengan default lab dari `MGMT_NETWORK`. Hanya untuk kode
// server: modul ini membaca process.env (tidak di-bundle ke client karena
// hanya di-import oleh route handler / lib/server). Tahap 4 menambah Settings.
import { mgmtNetworkFromEnv, type MgmtNetwork } from "@/lib/net"

let cache: { key: string; net: MgmtNetwork } | null = null

/**
 * Parameter subnet management aktif. Env dibaca ulang tiap panggilan (murah,
 * di-cache per kombinasi nilai) agar test bisa mengganti env tanpa reload
 * modul. Env tidak konsisten → Error (fail fast, bukan diam-diam default).
 */
export function getMgmtNetwork(): MgmtNetwork {
  const env = {
    PXE_MGMT_CIDR: process.env.PXE_MGMT_CIDR,
    PXE_MGMT_GATEWAY: process.env.PXE_MGMT_GATEWAY,
    PXE_MGMT_DNS: process.env.PXE_MGMT_DNS,
    PXE_DYNAMIC_RANGE: process.env.PXE_DYNAMIC_RANGE,
    PXE_SERVER_IP: process.env.PXE_SERVER_IP,
  }
  const key = JSON.stringify(env)
  if (cache?.key !== key) cache = { key, net: mgmtNetworkFromEnv(env) }
  return cache.net
}
