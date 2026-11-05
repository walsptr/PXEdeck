import { connection } from "next/server"

import { mockDb } from "@/lib/server/mock-hosts"

export async function GET() {
  await connection()
  const keys = [...mockDb().sshKeys.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  return Response.json(keys)
}
