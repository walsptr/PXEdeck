import { connection } from "next/server"

import { jsonNoStore } from "@/lib/server/http"
import { getSettings, toSettingsResponse } from "@/lib/server/settings"

/**
 * Settings server non-rahasia (`SettingsResponse`): subnet management, range
 * DHCP, PXE server, interface, base/media URL, TFTP root, TTL token. Tanpa
 * path DB, seed, maupun daftar host yang diizinkan. Selalu
 * `Cache-Control: no-store`. Env tidak valid → 500 `{error}` yang menyebut
 * nama variabel. `/api/network` tetap ada (subset, kontrak M3).
 */
export async function GET() {
  await connection()
  try {
    return jsonNoStore(toSettingsResponse(getSettings()))
  } catch (e) {
    return jsonNoStore({ error: (e as Error).message }, { status: 500 })
  }
}
