import { connection } from "next/server"

import { jsonNoStore } from "@/lib/server/http"
import { getServerStatus } from "@/lib/server/server-status"

/**
 * Status DHCP/TFTP/HTTP nyata (`ServerStatusResponse`): tiap layanan
 * `state` online|offline|unknown (+ `online` boolean untuk komponen lama).
 * Env tidak valid → 500 `{error}`. Selalu no-store.
 */
export async function GET() {
  await connection()
  try {
    return jsonNoStore(getServerStatus())
  } catch (e) {
    return jsonNoStore({ error: (e as Error).message }, { status: 500 })
  }
}
