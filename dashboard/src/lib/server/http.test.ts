// Konvensi kode status API (lib/server/http.ts).
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { hostIdParam, hostNotFound, INVALID_HOST_ID, readJson, validationFailed } from "./http"

const req = (body: string) => new Request("http://x", { method: "POST", body })

describe("http helpers", () => {
  it("hostIdParam: valid → id kecil; invalid → 400", async () => {
    expect(hostIdParam("AABBCCDDEEFF")).toEqual({ id: "aabbccddeeff" })
    const r = hostIdParam("bad")
    expect("response" in r && r.response.status).toBe(400)
    if ("response" in r) expect(await r.response.json()).toEqual({ error: INVALID_HOST_ID })
  })
  it("hostNotFound → 404 {error}", async () => {
    const r = hostNotFound()
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: "Host tidak ditemukan" })
  })
  it("readJson: bukan JSON → 400 {error}; skema gagal → 400 errors[] dengan section", async () => {
    const schema = z.object({ os: z.object({ a: z.number() }) })
    const a = await readJson(req("{"), schema)
    expect("response" in a && a.response.status).toBe(400)
    const b = await readJson(req(JSON.stringify({ os: { a: "x" } })), schema)
    if (!("response" in b)) throw new Error("harus gagal")
    const body = await b.response.json()
    expect(body.error).toBe("Input tidak valid")
    expect(body.errors[0]).toMatchObject({ section: "os", message: expect.stringMatching(/^os\.a: /) })
    const top = await readJson(req("[]"), schema)
    if (!("response" in top)) throw new Error("harus gagal")
    expect((await top.response.json()).errors[0].section).toBe("hostIds")
    const c = await readJson(req(JSON.stringify({ os: { a: 1 } })), schema)
    expect(c).toEqual({ data: { os: { a: 1 } } })
  })
  it("validationFailed → 422; pesan default bila errors kosong", async () => {
    const r = validationFailed([{ section: "network", message: "x" }])
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: "x", errors: [{ section: "network", message: "x" }] })
    expect((await validationFailed([]).json()).error).toBe("Validasi gagal")
  })
})
