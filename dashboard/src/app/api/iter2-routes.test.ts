// Iterasi 2 (integration route handler): perilaku baru dari perbaikan review iter1.
//  - GET /api/network (CR-3-2, DEC-006): default lab, override env, env tidak konsisten → 500.
//  - Cache-Control: no-store di semua GET API (CR-2-5).
//  - guardMutation (SR-2-2/SR-3-2): Origin asing / null / Sec-Fetch-Site cross-site → 403;
//    Content-Type → 415; readJson > 1 MB → 413 (SR-3-3).
//  - SR-3-4/AC-3.9: CSV import tidak memantulkan kolom mentah yang invalid (password).
//  - CR-3-3: mode CSV hanya menghitung/menandai host yang benar-benar diubah.
//  - CR-3-9: IP host = gateway payload ditolak; gateway di range DHCP dinamis ditolak.
// M4: DB SQLite (`resetDb("demo")`), snapshot = semua tabel DB. Reboot → 501 (DEC-012); allowlist
// header Host (SR-3-5) → host asing 403 "Host tidak diizinkan". NODE01 diberi credentials + media
// agar install tetap bisa 200 (seed M4 tanpa credentials, SR-2-1).
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

import { MGMT_NETWORK } from "@/lib/net"
import { applyConfig } from "@/lib/server/config-service"
import { peekConfig } from "@/lib/server/db/repos/configs"
import { dbSnapshot, makeMediaRoot, tmpDir, useDb } from "@/test/db"
import { DUMMY_PASSWORD, SSH_ED25519 } from "@/test/fixtures"
import { ctx, jsonReq } from "@/test/route"

import { POST as csvImport } from "./credentials/import/route"
import { GET as networkGET } from "./network/route"
import { POST as bulk } from "./hosts/bulk/route"
import { POST as bulkInstall } from "./hosts/bulk/install/route"
import { GET as listGET } from "./hosts/route"
import { GET as getConfig } from "./hosts/[id]/config/route"
import { POST as install } from "./hosts/[id]/install/route"
import { POST as reboot } from "./hosts/[id]/reboot/route"
import { DELETE, GET as oneGET, PATCH } from "./hosts/[id]/route"
import { GET as sshKeys } from "./ssh-keys/route"

const MEDIA = makeMediaRoot(tmpDir("media"))
useDb("demo", { PXE_MEDIA_ROOT: MEDIA })
beforeEach(async () => {
  // NODE01 siap install (credentials eksplisit + key) — pengganti credentials seed M2/M3.
  const r = await applyConfig(["525400101011"], {
    credentials: { mode: "same", username: "ubuntu", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: false },
    ssh: { keyIds: [], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
})

const NODE01 = "525400101011" // done, 10.10.10.11
const DISC1 = "b083fe5c19e2" // discovered
const DISC2 = "b083fe5c19e3"
const DISC3 = "a0369f0b725d"
const LEGACY01 = "3ca82a10447c"

const URL_BASE = "http://localhost"

/** Request mentah dengan header bebas (Host = localhost dari URL). */
function rawReq(path: string, method: string, headers: Record<string, string>, body?: string) {
  return new Request(`${URL_BASE}${path}`, { method, headers, body })
}

const staticNet = (assignments: Record<string, string>, gateway = "10.10.10.1") => ({
  mode: "static" as const,
  assignments,
  prefix: 24,
  gateway,
  dns: ["10.10.10.1"],
  vlan: null,
  iface: { by: "mac" as const },
})

// ---------------------------------------------------------------------------------------------
describe("iter2 CR-3-2 GET /api/network", () => {
  it("tanpa env → default lab {cidr,prefix,gateway,dns,dynamicRange,pxeServer} + no-store", async () => {
    const res = await networkGET()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({
      cidr: MGMT_NETWORK.cidr,
      prefix: 24,
      gateway: MGMT_NETWORK.gateway,
      dns: [...MGMT_NETWORK.dns],
      dynamicRange: [...MGMT_NETWORK.dynamicRange],
      pxeServer: MGMT_NETWORK.pxeServer,
    })
  })

  it("override env PXE_MGMT_* (subnet KVM) tercermin di respons", async () => {
    process.env.PXE_MGMT_CIDR = "10.99.0.0/24"
    process.env.PXE_MGMT_GATEWAY = "10.99.0.1"
    process.env.PXE_MGMT_DNS = "10.99.0.1,1.1.1.1"
    process.env.PXE_SERVER_IP = "10.99.0.2"
    process.env.PXE_DYNAMIC_RANGE = "10.99.0.100-10.99.0.200"
    const res = await networkGET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      cidr: "10.99.0.0/24",
      prefix: 24,
      gateway: "10.99.0.1",
      dns: ["10.99.0.1", "1.1.1.1"],
      dynamicRange: ["10.99.0.100", "10.99.0.200"],
      pxeServer: "10.99.0.2",
    })
  })

  it("prefix mengikuti CIDR env (/16)", async () => {
    process.env.PXE_MGMT_CIDR = "172.16.0.0/16"
    process.env.PXE_MGMT_GATEWAY = "172.16.0.1"
    process.env.PXE_SERVER_IP = "172.16.0.2"
    process.env.PXE_DYNAMIC_RANGE = "172.16.200.1-172.16.200.254"
    expect(await (await networkGET()).json()).toMatchObject({ cidr: "172.16.0.0/16", prefix: 16 })
  })

  it("env tidak konsisten → 500 {error} yang menyebut variabelnya, tetap no-store", async () => {
    process.env.PXE_MGMT_CIDR = "10.99.0.0/24" // gateway default 10.10.10.1 di luar subnet
    const res = await networkGET()
    expect(res.status).toBe(500)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect((await res.json()).error).toMatch(/PXE_MGMT_GATEWAY/)
  })

  it("validasi server memakai subnet yang sama dengan /api/network (UI = API, DEC-006)", async () => {
    process.env.PXE_MGMT_CIDR = "10.99.0.0/24"
    process.env.PXE_MGMT_GATEWAY = "10.99.0.1"
    process.env.PXE_SERVER_IP = "10.99.0.2"
    process.env.PXE_DYNAMIC_RANGE = "10.99.0.100-10.99.0.200"
    const net = await (await networkGET()).json()
    const ok = await PATCH(
      jsonReq(`/api/hosts/${DISC1}`, "PATCH", {
        network: { ...staticNet({ [DISC1]: "10.99.0.11" }, net.gateway), prefix: net.prefix, dns: net.dns },
      }),
      ctx(DISC1),
    )
    expect(ok.status).toBe(200)
    const bad = await PATCH(
      jsonReq(`/api/hosts/${DISC2}`, "PATCH", {
        network: { ...staticNet({ [DISC2]: "10.10.10.50" }, net.gateway), prefix: net.prefix, dns: net.dns },
      }),
      ctx(DISC2),
    )
    expect(bad.status).toBe(422)
    expect((await bad.json()).errors[0].message).toMatch(/Di luar subnet 10\.99\.0\.0\/24$/)
  })
})

// ---------------------------------------------------------------------------------------------
describe("iter2 CR-2-5 Cache-Control: no-store di semua GET API", () => {
  it("hosts, host/:id, host/:id 404, config, ssh-keys, network", async () => {
    const responses: [string, Response][] = [
      ["GET /api/hosts", await listGET()],
      ["GET /api/hosts/:id", await oneGET(jsonReq("/x", "GET"), ctx(NODE01))],
      ["GET /api/hosts/:id/config", await getConfig(jsonReq("/x", "GET"), ctx(NODE01))],
      ["GET /api/ssh-keys", await sshKeys()],
      ["GET /api/network", await networkGET()],
    ]
    for (const [name, res] of responses) {
      expect(res.status, name).toBe(200)
      expect(res.headers.get("cache-control"), name).toBe("no-store")
    }
  })
})

// ---------------------------------------------------------------------------------------------
type Mut = {
  name: string
  body: "json" | "none"
  call: (headers: Record<string, string>, body?: string) => Promise<Response>
  validBody: string
  /** Status bila request lolos guard (reboot = 501 sejak DEC-012). */
  okStatus: number[]
}

const MUTATIONS: Mut[] = [
  {
    name: "PATCH /api/hosts/:id",
    okStatus: [200],
    body: "json",
    validBody: JSON.stringify({ network: { mode: "dhcp" } }),
    call: (h, b) => PATCH(rawReq(`/api/hosts/${NODE01}`, "PATCH", h, b), ctx(NODE01)),
  },
  {
    name: "POST /api/hosts/bulk",
    okStatus: [200],
    body: "json",
    validBody: JSON.stringify({ hostIds: [NODE01], network: { mode: "dhcp" } }),
    call: (h, b) => bulk(rawReq("/api/hosts/bulk", "POST", h, b)),
  },
  {
    name: "POST /api/hosts/bulk/install",
    okStatus: [200],
    body: "json",
    validBody: JSON.stringify({ hostIds: [NODE01] }),
    call: (h, b) => bulkInstall(rawReq("/api/hosts/bulk/install", "POST", h, b)),
  },
  {
    name: "POST /api/credentials/import",
    okStatus: [200],
    body: "json",
    validBody: JSON.stringify({ csv: `b0:83:fe:5c:19:e2,ops,${DUMMY_PASSWORD}`, hostIds: [DISC1] }),
    call: (h, b) => csvImport(rawReq("/api/credentials/import", "POST", h, b)),
  },
  {
    name: "DELETE /api/hosts/:id",
    okStatus: [204],
    body: "none",
    validBody: "",
    call: (h) => DELETE(rawReq(`/api/hosts/${LEGACY01}`, "DELETE", h), ctx(LEGACY01)),
  },
  {
    name: "POST /api/hosts/:id/reboot",
    okStatus: [501],
    body: "none",
    validBody: "",
    call: (h) => reboot(rawReq(`/api/hosts/${LEGACY01}/reboot`, "POST", h), ctx(LEGACY01)),
  },
  {
    name: "POST /api/hosts/:id/install",
    okStatus: [200],
    body: "none",
    validBody: "",
    call: (h) => install(rawReq(`/api/hosts/${NODE01}/install`, "POST", h), ctx(NODE01)),
  },
]

const JSON_CT = { "content-type": "application/json" }

/** Snapshot DB (semua tabel) untuk membuktikan request yang ditolak tidak berefek. */
const storeSnapshot = dbSnapshot

describe("iter2 SR-3-2 guardMutation: request lintas-origin → 403 tanpa efek", () => {
  const cross: [string, Record<string, string>][] = [
    ["Origin asing", { origin: "http://evil.example" }],
    ["Origin port beda", { origin: "http://localhost:9999" }],
    ["Origin: null", { origin: "null" }],
    ["Origin rusak", { origin: "::bukan-url" }],
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
    ["Origin sama tetapi Sec-Fetch-Site cross-site", { origin: "http://localhost", "sec-fetch-site": "cross-site" }],
  ]
  for (const m of MUTATIONS) {
    for (const [label, headers] of cross) {
      it(`${m.name}: ${label} → 403`, async () => {
        const before = storeSnapshot()
        const res = await m.call({ ...JSON_CT, ...headers }, m.body === "json" ? m.validBody : undefined)
        expect(res.status).toBe(403)
        expect(await res.json()).toEqual({ error: "Request lintas-origin ditolak" })
        expect(storeSnapshot()).toBe(before)
      })
    }
  }

  it("Origin sama (Host / X-Forwarded-Host) dan Sec-Fetch-Site same-origin diterima", async () => {
    const r1 = await PATCH(
      rawReq(`/api/hosts/${NODE01}`, "PATCH", { ...JSON_CT, origin: "http://localhost" }, JSON.stringify({ network: { mode: "dhcp" } })),
      ctx(NODE01),
    )
    expect(r1.status).toBe(200)
    // SR-3-5: pxe.lab.example harus ada di allowlist Host agar lolos guard.
    process.env.PXE_ALLOWED_HOSTS = "localhost,pxe.lab.example"
    const r2 = await reboot(
      rawReq(`/api/hosts/${LEGACY01}/reboot`, "POST", {
        origin: "https://pxe.lab.example",
        "x-forwarded-host": "pxe.lab.example",
        "sec-fetch-site": "same-origin",
      }),
      ctx(LEGACY01),
    )
    // Lolos guard; reboot sendiri 501 sejak DEC-012 (bukan 403/415).
    expect(r2.status).toBe(501)
    // X-Forwarded-Host berbeda dari Origin → tetap 403.
    const r3 = await reboot(
      rawReq(`/api/hosts/${LEGACY01}/reboot`, "POST", { origin: "http://localhost", "x-forwarded-host": "pxe.lab.example" }),
      ctx(LEGACY01),
    )
    expect(r3.status).toBe(403)
  })
})

describe("SR-3-5 guardMutation: header Host di luar allowlist → 403 tanpa efek", () => {
  // DNS rebinding: Origin = Host = domain penyerang (cek Origin saja tidak cukup).
  for (const m of MUTATIONS) {
    it(`${m.name}: Origin = Host = evil.example → 403 "Host tidak diizinkan"`, async () => {
      const before = storeSnapshot()
      const res = await m.call(
        { ...JSON_CT, host: "evil.example", "x-forwarded-host": "evil.example", origin: "http://evil.example", "sec-fetch-site": "same-origin" },
        m.body === "json" ? m.validBody : undefined,
      )
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: "Host tidak diizinkan" })
      expect(storeSnapshot()).toBe(before)
    })
  }
  it("PXE_ALLOWED_HOSTS: entri tanpa port menerima port apa pun; host lain tetap 403", async () => {
    process.env.PXE_ALLOWED_HOSTS = "pxe.lab.example"
    const ok = await PATCH(
      rawReq(`/api/hosts/${NODE01}`, "PATCH", { ...JSON_CT, "x-forwarded-host": "pxe.lab.example:8080", origin: "http://pxe.lab.example:8080" }, JSON.stringify({ network: { mode: "dhcp" } })),
      ctx(NODE01),
    )
    expect(ok.status).toBe(200)
    // localhost tidak lagi di allowlist bila PXE_ALLOWED_HOSTS diset eksplisit.
    const bad = await PATCH(rawReq(`/api/hosts/${NODE01}`, "PATCH", JSON_CT, JSON.stringify({ network: { mode: "dhcp" } })), ctx(NODE01))
    expect(bad.status).toBe(403)
  })
})

describe("iter2 SR-3-2 guardMutation: Content-Type → 415", () => {
  for (const m of MUTATIONS.filter((x) => x.body === "json")) {
    it(`${m.name}: tanpa Content-Type / text/plain / form → 415 tanpa efek; application/json; charset=utf-8 diterima`, async () => {
      const before = storeSnapshot()
      for (const headers of [
        {},
        { "content-type": "text/plain" },
        { "content-type": "application/x-www-form-urlencoded" },
        { "content-type": "multipart/form-data; boundary=x" },
        { "content-type": "application/jsonp" },
      ] as Record<string, string>[]) {
        // Request tanpa header content-type eksplisit: body string → undici menambah text/plain.
        const res = await m.call(headers, m.validBody)
        expect(res.status, JSON.stringify(headers)).toBe(415)
        expect(await res.json()).toEqual({ error: "Content-Type harus application/json" })
      }
      expect(storeSnapshot()).toBe(before)
      const ok = await m.call({ "content-type": "Application/JSON; charset=utf-8" }, m.validBody)
      expect(ok.status).not.toBe(415)
      expect(ok.status).toBeLessThan(500)
    })
  }

  it("body JSON benar-benar tanpa header Content-Type → 415", async () => {
    const req = new Request(`${URL_BASE}/api/hosts/bulk`, { method: "POST" })
    expect((await bulk(req)).status).toBe(415)
  })

  for (const m of MUTATIONS.filter((x) => x.body === "none")) {
    it(`${m.name}: tanpa Content-Type diterima; Content-Type non-JSON → 415`, async () => {
      const bad = await m.call({ "content-type": "text/plain" })
      expect(bad.status).toBe(415)
      const form = await m.call({ "content-type": "application/x-www-form-urlencoded" })
      expect(form.status).toBe(415)
      const ok = await m.call({})
      expect(m.okStatus).toContain(ok.status)
    })
  }

  it("endpoint tanpa body menerima Content-Type application/json", async () => {
    // reboot lolos guard → 501 (DEC-012); DELETE & install membuktikan jalur sukses.
    const res = await reboot(rawReq(`/api/hosts/${LEGACY01}/reboot`, "POST", JSON_CT), ctx(LEGACY01))
    expect(res.status).toBe(501)
    expect((await install(rawReq(`/api/hosts/${NODE01}/install`, "POST", JSON_CT), ctx(NODE01))).status).toBe(200)
    expect((await DELETE(rawReq(`/api/hosts/${LEGACY01}`, "DELETE", JSON_CT), ctx(LEGACY01))).status).toBe(204)
  })
})

describe("iter2 SR-3-3 body > 1 MB → 413", () => {
  const big = (bytes: number) => JSON.stringify({ hostIds: [NODE01], network: { mode: "dhcp" }, pad: "x".repeat(bytes) })

  it("Content-Length > 1 MB → 413 tanpa membaca body", async () => {
    const res = await bulk(rawReq("/api/hosts/bulk", "POST", { ...JSON_CT, "content-length": String(1024 * 1024 + 1) }, "{}"))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "Body melebihi batas 1 MB" })
  })

  it("body stream > 1 MB tanpa Content-Length → 413 tanpa efek (bulk, PATCH, CSV import)", async () => {
    const before = storeSnapshot()
    const stream = (s: string) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          const b = new TextEncoder().encode(s)
          // Potong menjadi beberapa chunk agar batas terlewati di tengah stream.
          for (let i = 0; i < b.length; i += 64 * 1024) c.enqueue(b.slice(i, i + 64 * 1024))
          c.close()
        },
      })
    const mk = (path: string, method: string, body: string) =>
      new Request(`${URL_BASE}${path}`, { method, headers: JSON_CT, body: stream(body), duplex: "half" } as RequestInit)
    const payload = big(1024 * 1024)
    expect((await bulk(mk("/api/hosts/bulk", "POST", payload))).status).toBe(413)
    expect((await PATCH(mk(`/api/hosts/${NODE01}`, "PATCH", payload), ctx(NODE01))).status).toBe(413)
    expect((await csvImport(mk("/api/credentials/import", "POST", payload))).status).toBe(413)
    expect(storeSnapshot()).toBe(before)
  })

  it("body sedikit di bawah 1 MB tidak ditolak 413", async () => {
    const payload = big(1024 * 1024 - 200)
    expect(new TextEncoder().encode(payload).length).toBeLessThanOrEqual(1024 * 1024)
    const res = await bulk(rawReq("/api/hosts/bulk", "POST", JSON_CT, payload))
    expect(res.status).not.toBe(413)
  })
})

// ---------------------------------------------------------------------------------------------
describe("iter2 SR-3-4 / AC-3.9: CSV import tidak memantulkan password", () => {
  const imp = (csv: string, hostIds: string[]) => csvImport(jsonReq("/api/credentials/import", "POST", { csv, hostIds }))
  const SECRET = `${DUMMY_PASSWORD}-csv`

  it("baris 1 kolom berisi password → mac \"\", respons tidak memuat password", async () => {
    const res = await imp(`mac,username,password\n${SECRET}`, [DISC1])
    const raw = await res.text()
    expect(res.status).toBe(200)
    expect(raw).not.toContain(SECRET)
    const row = JSON.parse(raw).rows[0]
    expect(row).toMatchObject({ line: 2, mac: "", username: "", hostId: null })
    expect(row.errors).toEqual(expect.arrayContaining(["Harus 3 kolom, ada 1", "MAC tidak valid"]))
  })

  it("kolom tertukar (password di kolom MAC / username) → tidak di-echo", async () => {
    const csv = [`${SECRET},ops,${SECRET}`, `b0:83:fe:5c:19:e2,${SECRET},${SECRET}`, `ops,${SECRET}`].join("\n")
    const res = await imp(csv, [DISC1])
    const raw = await res.text()
    expect(raw).not.toContain(SECRET)
    const rows = JSON.parse(raw).rows
    expect(rows[0]).toMatchObject({ mac: "", username: "ops" })
    expect(rows[1]).toMatchObject({ mac: "b0:83:fe:5c:19:e2", username: "", hostId: DISC1 })
    expect(rows[1].errors[0]).toMatch(/Huruf kecil/)
    expect(rows[2]).toMatchObject({ mac: "", username: "" })
  })

  it("username invalid di-kosongkan; username valid tetap tampil", async () => {
    const rows = (await (await imp(`b0:83:fe:5c:19:e2,Root,${DUMMY_PASSWORD}\nb0:83:fe:5c:19:e3,ops,x`, [DISC1, DISC2])).json()).rows
    expect(rows[0].username).toBe("")
    expect(rows[1].username).toBe("ops")
  })

  it("422 bulk mode csv tidak memuat password dari baris invalid", async () => {
    const res = await bulk(
      jsonReq("/api/hosts/bulk", "POST", {
        hostIds: [DISC1],
        credentials: { mode: "csv", csv: `${SECRET}\nb0:83:fe:5c:19:e2,${SECRET},${SECRET}`, sudo: true, disableSshPassword: false },
      }),
    )
    expect(res.status).toBe(422)
    expect(await res.text()).not.toContain(SECRET)
  })
})

// ---------------------------------------------------------------------------------------------
describe("iter2 CR-3-3 mode CSV: updated/updatedAt hanya host yang diubah", () => {
  it("3 host terpilih, CSV 1 host → updated 1; updatedAt hanya host itu", async () => {
    const before = Object.fromEntries([DISC1, DISC2, DISC3].map((id) => [id, peekConfig(id)?.updatedAt ?? null]))
    const res = await bulk(
      jsonReq("/api/hosts/bulk", "POST", {
        hostIds: [DISC1, DISC2, DISC3],
        credentials: { mode: "csv", csv: `b0:83:fe:5c:19:e3,ops,${DUMMY_PASSWORD}`, sudo: true, disableSshPassword: false },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1 })
    expect(peekConfig(DISC2)!.updatedAt).toEqual(expect.any(String))
    expect(peekConfig(DISC2)!.updatedAt).not.toBe(before[DISC2])
    expect(peekConfig(DISC1)?.updatedAt ?? null).toBe(before[DISC1])
    expect(peekConfig(DISC3)?.updatedAt ?? null).toBe(before[DISC3])
  })

  it("mode CSV + bagian lain di request yang sama → semua host batch dihitung", async () => {
    const res = await bulk(
      jsonReq("/api/hosts/bulk", "POST", {
        hostIds: [DISC1, DISC2, DISC3],
        credentials: { mode: "csv", csv: `b0:83:fe:5c:19:e3,ops,${DUMMY_PASSWORD}`, sudo: true, disableSshPassword: false },
        network: { mode: "dhcp" },
      }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).updated).toBe(3)
  })
})

// ---------------------------------------------------------------------------------------------
describe("iter2 CR-3-9 gateway payload", () => {
  it("IP host = gateway payload → 422 'Bentrok dengan gateway <gw>' tanpa efek", async () => {
    const before = storeSnapshot()
    const res = await PATCH(
      jsonReq(`/api/hosts/${DISC1}`, "PATCH", { network: staticNet({ [DISC1]: "10.10.10.5" }, "10.10.10.5") }),
      ctx(DISC1),
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.errors).toEqual([
      expect.objectContaining({ section: "network", hostId: DISC1, message: expect.stringMatching(/: Bentrok dengan gateway 10\.10\.10\.5$/) }),
    ])
    expect(storeSnapshot()).toBe(before)
  })

  it("bulk: hanya host dengan IP = gateway payload yang ditandai", async () => {
    const res = await bulk(
      jsonReq("/api/hosts/bulk", "POST", {
        hostIds: [DISC1, DISC2],
        network: staticNet({ [DISC1]: "10.10.10.5", [DISC2]: "10.10.10.6" }, "10.10.10.6"),
      }),
    )
    expect(res.status).toBe(422)
    const errs = (await res.json()).errors
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ hostId: DISC2, message: expect.stringMatching(/Bentrok dengan gateway 10\.10\.10\.6$/) })
  })

  it("gateway di dalam range DHCP dinamis → 422 section network", async () => {
    const res = await PATCH(
      jsonReq(`/api/hosts/${DISC1}`, "PATCH", { network: staticNet({ [DISC1]: "10.10.10.50" }, "10.10.10.150") }),
      ctx(DISC1),
    )
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.errors).toEqual([
      expect.objectContaining({
        section: "network",
        message: "Gateway 10.10.10.150 di dalam range DHCP dinamis 10.10.10.100–10.10.10.200",
      }),
    ])
  })

  it("gateway valid di luar range dinamis dan ≠ IP host → 200", async () => {
    const res = await PATCH(
      jsonReq(`/api/hosts/${DISC1}`, "PATCH", { network: staticNet({ [DISC1]: "10.10.10.50" }, "10.10.10.5") }),
      ctx(DISC1),
    )
    expect(res.status).toBe(200)
  })
})
