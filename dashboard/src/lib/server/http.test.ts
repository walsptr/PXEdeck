// Konvensi kode status API (lib/server/http.ts).
import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  guardMutation,
  hostIdParam,
  hostNotFound,
  INVALID_HOST_ID,
  jsonNoStore,
  MAX_JSON_BODY_BYTES,
  NO_STORE,
  readBodyLimited,
  readJson,
  validationFailed,
} from "./http"

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

// ---- Iterasi 2 ----
describe("iter2 http: batas body, no-store, guardMutation", () => {
  it("MAX_JSON_BODY_BYTES = 1 MiB; NO_STORE", () => {
    expect(MAX_JSON_BODY_BYTES).toBe(1024 * 1024)
    expect(NO_STORE).toEqual({ "Cache-Control": "no-store" })
  })
  it("readBodyLimited: tanpa body → ''; tepat di batas → teks; lewat batas → null", async () => {
    expect(await readBodyLimited(new Request("http://x", { method: "POST" }))).toBe("")
    expect(await readBodyLimited(req("abcd"), 4)).toBe("abcd")
    expect(await readBodyLimited(req("abcde"), 4)).toBeNull()
    // UTF-8 multi-byte dihitung per byte, bukan per karakter.
    expect(await readBodyLimited(req("éé"), 3)).toBeNull()
    expect(await readBodyLimited(req("éé"), 4)).toBe("éé")
  })
  it("readJson > batas → 413 {error}", async () => {
    const r = await readJson(req(JSON.stringify({ x: "y".repeat(MAX_JSON_BODY_BYTES) })), z.object({}))
    if (!("response" in r)) throw new Error("harus gagal")
    expect(r.response.status).toBe(413)
    expect(await r.response.json()).toEqual({ error: "Body melebihi batas 1 MB" })
  })
  it("jsonNoStore mempertahankan status & header lain", async () => {
    const r = jsonNoStore({ a: 1 }, { status: 201, headers: { "x-a": "b", "Cache-Control": "max-age=60" } })
    expect(r.status).toBe(201)
    expect(r.headers.get("cache-control")).toBe("no-store")
    expect(r.headers.get("x-a")).toBe("b")
    expect(await r.json()).toEqual({ a: 1 })
  })
  it("guardMutation: null bila same-origin + JSON; host dibandingkan case-insensitive", () => {
    const mk = (h: Record<string, string>) => new Request("http://Pxe.Lab:3000/api", { method: "POST", headers: h })
    expect(guardMutation(mk({ origin: "http://pxe.lab:3000", "content-type": "application/json" }), "json")).toBeNull()
    expect(guardMutation(mk({ "content-type": "application/json" }), "json")).toBeNull()
    expect(guardMutation(mk({}), "none")).toBeNull()
    expect(guardMutation(mk({ origin: "http://pxe.lab", "content-type": "application/json" }), "json")!.status).toBe(403)
    expect(guardMutation(mk({}), "json")!.status).toBe(415)
  })
})
