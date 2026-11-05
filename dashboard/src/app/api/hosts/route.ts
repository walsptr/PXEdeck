import { connection } from "next/server"

import { jsonNoStore } from "@/lib/server/http"
import { listHosts } from "@/lib/server/mock-hosts"
import type { HostsResponse } from "@/lib/types"

export async function GET() {
  await connection()
  const body: HostsResponse = {
    hosts: listHosts(),
    serverTime: new Date().toISOString(),
  }
  return jsonNoStore(body)
}
