// Sumber tunggal parameter subnet management di server (DEC-006). Sejak M4
// nilainya bagian dari `getSettings()` (src/lib/server/settings.ts, env
// PXE_MGMT_*, PXE_DHCP_RANGE/PXE_DYNAMIC_RANGE, PXE_SERVER_IP). Modul ini
// dipertahankan sebagai pembungkus tipis untuk pemanggil lama.
import {
  resolveStaticNetwork,
  type MgmtNetwork,
  type StaticNetwork,
  type VlanNetwork,
} from "@/lib/net"
import { getSettings } from "@/lib/server/settings"

/**
 * Parameter subnet management aktif. Env dibaca ulang tiap panggilan (di-cache
 * per kombinasi nilai). Env tidak konsisten → Error (fail fast).
 */
export function getMgmtNetwork(): MgmtNetwork {
  return getSettings().network
}

/** VLAN management terdaftar (`PXE_VLAN_NETWORKS`, M7 DEC-024 §4); `[]` bila tidak ada. */
export function getVlanNetworks(): VlanNetwork[] {
  return getSettings().vlanNetworks
}

/**
 * Jaringan untuk validasi IP statis ber-`vlan` (DEC-024 §4): VLAN terdaftar → jaringan VLAN itu;
 * null/tidak terdaftar → subnet management (DEC-006). Satu pembacaan settings (konsisten).
 */
export function getStaticNetwork(vlan: number | null | undefined): StaticNetwork {
  const s = getSettings()
  return resolveStaticNetwork(vlan, s.network, s.vlanNetworks)
}
