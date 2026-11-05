import { connection } from "next/server"

import { jsonNoStore } from "@/lib/server/http"
import { mockDb } from "@/lib/server/mock-hosts"

export async function GET() {
  await connection()
  const keys = [...mockDb().sshKeys.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  return jsonNoStore(keys)
}
