// AC-2.5, AC-2.6: integration route handler /api/hosts, /api/hosts/:id, /reboot.
// `connection()` dari next/server di-stub (di luar request scope Next melempar error).
// M4: store mock diganti DB SQLite (`resetDb("demo")`, DEC-005/DEC-007). Reboot ke PXE kini 501
// (DEC-012) — test reboot lama diganti perilaku baru; hapus host tetap seperti AC-2.12.
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

import { resetDb } from "@/lib/server/db/reset"
import { getHost } from "@/lib/server/db/repos/hosts"
import { PROVISION_STATUSES } from "@/lib/types"
import { ctx, jsonReq } from "@/test/route"
import { dbSnapshot, withDb } from "@/test/db"

import { GET as listGET } from "./route"
import { DELETE, GET as oneGET } from "./[id]/route"
import { POST as reboot } from "./[id]/reboot/route"

withDb("demo")

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s)
const ipOrNull = z.string().regex(/^\d+\.\d+\.\d+\.\d+$/).nullable()
const HostSchema = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{12}$/),
  mac: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/),
  hostname: z.string().nullable(),
  currentIp: ipOrNull,
  mgmtIp: ipOrNull,
  vendor: z.string().nullable(),
  firmware: z.enum(["uefi", "bios"]).nullable(),
  osInstalled: z.string().nullable(),
  osAssigned: z.string().nullable(),
  status: z.enum(PROVISION_STATUSES),
  statusSince: iso,
  lastSeen: iso,
})

describe("AC-2.5 GET /api/hosts", () => {
  it("200, Cache-Control no-store, {hosts, serverTime} lolos skema Host", async () => {
    const res = await listGET()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(["hosts", "serverTime"])
    expect(iso.safeParse(body.serverTime).success).toBe(true)
    expect(body.hosts).toHaveLength(14)
    for (const h of body.hosts) expect(HostSchema.safeParse(h).error).toBeUndefined()
  })

  it("seed empty → hosts []", async () => {
    resetDb("empty")
    const body = await (await listGET()).json()
    expect(body.hosts).toEqual([])
  })
})

describe("AC-2.5 GET /api/hosts/:id", () => {
  it("200 host", async () => {
    const res = await oneGET(jsonReq("/api/hosts/525400101011", "GET"), ctx("525400101011"))
    expect(res.status).toBe(200)
    const h = await res.json()
    expect(HostSchema.parse(h)).toMatchObject({ hostname: "node01", mac: "52:54:00:10:10:11" })
  })
  it("id huruf besar dinormalisasi", async () => {
    const res = await oneGET(jsonReq("/x", "GET"), ctx("525400101011".toUpperCase()))
    expect(res.status).toBe(200)
  })
  it("404 {error} untuk id tak dikenal", async () => {
    const res = await oneGET(jsonReq("/x", "GET"), ctx("000000000000"))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })
  it("400 {error} untuk id bukan 12 hex", async () => {
    for (const bad of ["abc", "52:54:00:10:10:11", "zzzzzzzzzzzz", "5254001010111"]) {
      const res = await oneGET(jsonReq("/x", "GET"), ctx(bad))
      expect(res.status, bad).toBe(400)
      expect((await res.json()).error).toMatch(/12 digit hex/)
    }
  })
})

describe("AC-2.6 DELETE & reboot", () => {
  it("DELETE → 204 tanpa body, lalu GET → 404", async () => {
    const res = await DELETE(jsonReq("/x", "DELETE"), ctx("525400101011"))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe("")
    const again = await oneGET(jsonReq("/x", "GET"), ctx("525400101011"))
    expect(again.status).toBe(404)
    const list = await (await listGET()).json()
    expect(list.hosts).toHaveLength(13)
  })
  it("DELETE id tak dikenal → 404; id invalid → 400", async () => {
    expect((await DELETE(jsonReq("/x", "DELETE"), ctx("000000000000"))).status).toBe(404)
    expect((await DELETE(jsonReq("/x", "DELETE"), ctx("nope"))).status).toBe(400)
  })
  it("DEC-012: POST reboot → 501 {error} 'butuh IPMI/Redfish', status host TIDAK berubah", async () => {
    for (const id of ["ac1f6b227d40", "3ca82a10447c"]) {
      const before = dbSnapshot()
      const statusBefore = getHost(id)!.status
      const res = await reboot(jsonReq("/x", "POST"), ctx(id))
      expect(res.status).toBe(501)
      const body = await res.json()
      expect(Object.keys(body)).toEqual(["error"])
      expect(body.error).toMatch(/IPMI\/Redfish/)
      expect(dbSnapshot()).toBe(before)
      const persisted = HostSchema.parse(await (await oneGET(jsonReq("/x", "GET"), ctx(id))).json())
      expect(persisted.status).toBe(statusBefore)
    }
  })
  it("POST reboot id tak dikenal → 404; id invalid → 400", async () => {
    expect((await reboot(jsonReq("/x", "POST"), ctx("000000000000"))).status).toBe(404)
    expect((await reboot(jsonReq("/x", "POST"), ctx("xyz"))).status).toBe(400)
  })
})
