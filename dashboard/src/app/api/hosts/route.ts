import { connection } from "next/server"

import { listHosts } from "@/lib/server/db/repos/hosts"
import { syncLeases } from "@/lib/server/discovery"
import { jsonNoStore } from "@/lib/server/http"
import type { HostsResponse } from "@/lib/types"

export async function GET() {
  await connection()
  // MAC baru di file lease dnsmasq muncul sebagai host `discovered` (AC-4.11).
  syncLeases()
  const body: HostsResponse = {
    hosts: listHosts(),
    serverTime: new Date().toISOString(),
  }
  return jsonNoStore(body)
}
