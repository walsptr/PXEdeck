import { connection } from "next/server"

import { toNetworkResponse } from "@/lib/net"
import { guardRead, jsonNoStore } from "@/lib/server/http"
import { getSettings } from "@/lib/server/settings"

/**
 * Subnet management aktif (`NetworkResponse` di lib/net.ts) dari env
 * `PXE_MGMT_*` — sumber yang sama dengan validasi server (DEC-006, CR-3-2) — plus
 * `vlanNetworks` (M7, DEC-024 §4) bila `PXE_VLAN_NETWORKS` berisi entri.
 * Selalu `Cache-Control: no-store`. Env tidak konsisten → 500 {error}.
 */
export async function GET(req: Request) {
  const denied = guardRead(req)
  if (denied) return denied
  await connection()
  try {
    const s = getSettings()
    return jsonNoStore(toNetworkResponse(s.network, s.vlanNetworks))
  } catch (e) {
    return jsonNoStore({ error: (e as Error).message }, { status: 500 })
  }
}
