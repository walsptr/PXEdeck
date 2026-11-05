import { connection } from "next/server"

import { toNetworkResponse } from "@/lib/net"
import { jsonNoStore } from "@/lib/server/http"
import { getMgmtNetwork } from "@/lib/server/net-config"

/**
 * Subnet management aktif (`NetworkResponse` di lib/net.ts) dari env
 * `PXE_MGMT_*` — sumber yang sama dengan validasi server (DEC-006, CR-3-2).
 * Selalu `Cache-Control: no-store`. Env tidak konsisten → 500 {error}.
 */
export async function GET() {
  await connection()
  try {
    return jsonNoStore(toNetworkResponse(getMgmtNetwork()))
  } catch (e) {
    return jsonNoStore({ error: (e as Error).message }, { status: 500 })
  }
}
