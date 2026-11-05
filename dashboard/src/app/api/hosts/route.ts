import { connection } from "next/server"

import { listHosts } from "@/lib/server/db/repos/hosts"
import { jsonNoStore } from "@/lib/server/http"
import type { HostsResponse } from "@/lib/types"

export async function GET() {
  await connection()
  const body: HostsResponse = {
    hosts: listHosts(),
    serverTime: new Date().toISOString(),
  }
  return jsonNoStore(body)
}
