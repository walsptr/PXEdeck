// M6-T2/T5 (backend-dev): SSE dengan sesi (AC-6.9, SR-5-7), CR-5-6, CR-5-11, CR-5-3, CR-5-4,
// CR-5-7, CR-5-8, SR-5-8 di tingkat route handler.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

import { DatabaseSync } from "node:sqlite"
import path from "node:path"

import { createSession, destroySessionId } from "@/lib/server/auth/session"
import { closeDb, getDb } from "@/lib/server/db"
import { appendEvent } from "@/lib/server/db/repos/job-events"
import { decodeJobCursor, encodeJobCursor, getJob, insertJob, listJobs, type Job } from "@/lib/server/db/repos/jobs"
import { getSettings } from "@/lib/server/settings"
import { SSE_MAX_PER_SESSION, sseConnections, sseConnectionsFor } from "@/lib/server/sse"
import { withDb, tmpDir } from "@/test/db"
import { SSH_ED25519_B } from "@/test/fixtures"
import { getReq, jsonReq } from "@/test/route"

import { GET as hostsGET } from "./hosts/route"
import { POST as installPOST } from "./hosts/[id]/install/route"
import { GET as jobGET } from "./jobs/[id]/route"
import { GET as logsGET } from "./jobs/[id]/logs/route"
import { GET as jobsGET } from "./jobs/route"
import { POST as imagesPOST } from "./os-images/route"
import { PATCH as keyPATCH } from "./ssh-keys/[id]/route"
import { POST as keysPOST } from "./ssh-keys/route"

withDb("demo")

const HOST = "525400101011"
const T0 = new Date("2026-11-06T08:00:00.000Z")
const p = (id: string) => ({ params: Promise.resolve({ id }) }) as never

function job(id: string, over: Partial<Job> = {}): Job {
  const at = over.createdAt ?? T0.toISOString()
  const j: Job = {
    id,
    hostId: HOST,
    kind: "install",
    osImageId: "ubuntu-24.04",
    status: "done",
    stages: [{ stage: "booting", at, source: "install" }],
    tokenHash: null,
    tokenExpiresAt: null,
    bootServedAt: null,
    createdAt: at,
    updatedAt: at,
    finishedAt: at,
    failureReason: null,
    installerBoots: 0,
    eventSeq: 0,
    ...over,
  }
  insertJob(j)
  return j
}

function newCookie() {
  const s = createSession(getSettings().admin!, null)
  return { id: s.id, cookie: `pxe_session=${s.id}`, key: s.session.idHash }
}

function sseReq(jobId: string, cookie: string, signal?: AbortSignal, q = "") {
  return new Request(`http://localhost/api/jobs/${jobId}/logs${q}`, { headers: { accept: "text/event-stream", cookie }, signal })
}

async function drain(res: Response) {
  const reader = res.body!.getReader()
  const st = { buf: "", done: false }
  const loop = (async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        st.done = true
        return
      }
      st.buf += new TextDecoder().decode(value)
    }
  })()
  return { st, loop, reader }
}

afterEach(() => vi.useRealTimers())

describe("SSE dengan sesi (AC-6.9, SR-5-7)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] })
    vi.setSystemTime(T0)
  })

  it("tanpa sesi → 401; koneksi ke-6 dari sesi yang sama → 429 sementara sesi lain tetap bisa", async () => {
    job("job-a", { status: "installing", finishedAt: null })
    expect((await logsGET(sseReq("job-a", ""), p("job-a"))).status).toBe(401)
    const a = newCookie()
    const acs = Array.from({ length: SSE_MAX_PER_SESSION }, () => new AbortController())
    for (const ac of acs) expect((await logsGET(sseReq("job-a", a.cookie, ac.signal), p("job-a"))).status).toBe(200)
    expect(sseConnectionsFor(a.key)).toBe(SSE_MAX_PER_SESSION)
    const sixth = await logsGET(sseReq("job-a", a.cookie), p("job-a"))
    expect(sixth.status).toBe(429)
    expect(sixth.headers.get("retry-after")).toBe("5")
    expect(await sixth.json()).toEqual({ error: "Terlalu banyak koneksi log untuk sesi ini" })
    const b = newCookie()
    const acb = new AbortController()
    expect((await logsGET(sseReq("job-a", b.cookie, acb.signal), p("job-a"))).status).toBe(200)
    // Menutup satu stream membebaskan slot sesi itu.
    acs[0].abort()
    expect(sseConnectionsFor(a.key)).toBe(SSE_MAX_PER_SESSION - 1)
    const again = new AbortController()
    expect((await logsGET(sseReq("job-a", a.cookie, again.signal), p("job-a"))).status).toBe(200)
    for (const ac of [...acs, acb, again]) ac.abort()
    expect(sseConnections()).toBe(0)
    expect(sseConnectionsFor(a.key)).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("logout saat stream aktif → event end {reason: session} lalu tutup ≤ 30 dtk; tanpa timer tersisa", async () => {
    job("job-a", { status: "installing", finishedAt: null })
    const a = newCookie()
    const res = await logsGET(sseReq("job-a", a.cookie), p("job-a"))
    expect(res.status).toBe(200)
    const c = await drain(res)
    await vi.advanceTimersByTimeAsync(5000)
    expect(c.st.done).toBe(false)
    destroySessionId(a.id)
    await vi.advanceTimersByTimeAsync(25_000)
    await c.loop
    expect(c.st.done).toBe(true)
    expect(c.st.buf.trimEnd().split("\n\n").at(-1)).toBe('event: end\ndata: {"reason":"session"}')
    expect(sseConnections()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("sesi kedaluwarsa (idle) saat stream aktif → end reason session", async () => {
    process.env.PXE_SESSION_IDLE_MIN = "1"
    job("job-a", { status: "installing", finishedAt: null })
    const a = newCookie()
    const c = await drain(await logsGET(sseReq("job-a", a.cookie), p("job-a")))
    await vi.advanceTimersByTimeAsync(61_000)
    expect(c.st.done).toBe(false) // pemeriksaan di 30 & 60 dtk: masih ≤ 60 dtk idle
    await vi.advanceTimersByTimeAsync(30_000)
    await c.loop
    expect(c.st.buf).toContain('event: end\ndata: {"reason":"session"}')
  })

  it("CR-5-6: resume after=k → event k sekali dengan repeat terkini, lalu event > k (AC-6.21)", async () => {
    job("job-a", { status: "installing", finishedAt: null })
    const w = { kind: "system", level: "warn", source: "boot-script", message: "PXE boot ulang" } as const
    appendEvent("job-a", { kind: "stage", level: "info", source: "install", message: "a", at: T0.toISOString() }, 100)
    appendEvent("job-a", { ...w, at: T0.toISOString() }, 100) // seq 2, repeat 1 (dilihat klien)
    // Klien terputus; event 2 digabung dua kali.
    appendEvent("job-a", { ...w, at: new Date(T0.getTime() + 10_000).toISOString() }, 100)
    appendEvent("job-a", { ...w, at: new Date(T0.getTime() + 20_000).toISOString() }, 100)
    appendEvent("job-a", { kind: "installer", level: "info", source: "installer", message: "b", at: T0.toISOString() }, 100)
    const a = newCookie()
    const c = await drain(await logsGET(new Request("http://localhost/api/jobs/job-a/logs", { headers: { accept: "text/event-stream", cookie: a.cookie, "last-event-id": "2" } }), p("job-a")))
    await vi.advanceTimersByTimeAsync(10)
    const frames = [...c.st.buf.matchAll(/event: log\nid: (\d+)\ndata: (.*)\n/g)].map((m) => ({ id: Number(m[1]), data: JSON.parse(m[2]) }))
    expect(frames.map((f) => f.id)).toEqual([2, 3])
    expect(frames[0].data).toMatchObject({ seq: 2, repeat: 3, at: T0.toISOString(), lastAt: new Date(T0.getTime() + 20_000).toISOString() })
    await c.reader.cancel()
  })

  it("CR-5-11: tick yang melempar → tepat satu baris `[sse] tick gagal: <kelas>` tanpa isi pesan; stream tutup", async () => {
    job("job-a", { status: "installing", finishedAt: null })
    const a = newCookie()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const c = await drain(await logsGET(sseReq("job-a", a.cookie), p("job-a")))
    const db = getDb()
    const orig = db.prepare.bind(db)
    const spy = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (/FROM jobs WHERE id = \?/.test(sql)) throw Object.assign(new Error("rahasia token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), { name: "TypeError" })
      return orig(sql)
    })
    await vi.advanceTimersByTimeAsync(1100)
    await c.loop
    spy.mockRestore()
    expect(c.st.done).toBe(true)
    const lines = warn.mock.calls.map((x) => String(x[0])).filter((l) => l.startsWith("[sse]"))
    expect(lines).toEqual(["[sse] tick gagal: TypeError"])
    warn.mockRestore()
    expect(sseConnections()).toBe(0)
  })

  it("CR-5-11: SQLITE_BUSY sekali → retry tanpa log, stream tetap hidup dan event berikutnya terkirim", async () => {
    job("job-a", { status: "installing", finishedAt: null })
    const a = newCookie()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const c = await drain(await logsGET(sseReq("job-a", a.cookie), p("job-a")))
    await vi.advanceTimersByTimeAsync(10)
    const db = getDb()
    const orig = db.prepare.bind(db)
    let fails = 1
    const spy = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (fails > 0 && /FROM jobs WHERE id = \?/.test(sql)) {
        fails--
        throw Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode: 5 })
      }
      return orig(sql)
    })
    await vi.advanceTimersByTimeAsync(1100)
    spy.mockRestore()
    expect(c.st.done).toBe(false)
    appendEvent("job-a", { kind: "installer", level: "info", source: "installer", message: "setelah busy", at: T0.toISOString() }, 100)
    await vi.advanceTimersByTimeAsync(1100)
    expect(c.st.buf).toContain("setelah busy")
    expect(warn.mock.calls.filter((x) => String(x[0]).startsWith("[sse]"))).toEqual([])
    await c.reader.cancel()
    warn.mockRestore()
  })

  it("CR-5-11: SQLITE_BUSY dua kali berturut → satu baris SQLITE_BUSY lalu tutup", async () => {
    job("job-a", { status: "installing", finishedAt: null })
    const a = newCookie()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const c = await drain(await logsGET(sseReq("job-a", a.cookie), p("job-a")))
    const db = getDb()
    const orig = db.prepare.bind(db)
    const spy = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (/FROM jobs WHERE id = \?/.test(sql)) throw Object.assign(new Error("database is locked"), { errcode: 5 })
      return orig(sql)
    })
    await vi.advanceTimersByTimeAsync(2200)
    await c.loop
    spy.mockRestore()
    expect(warn.mock.calls.map((x) => String(x[0])).filter((l) => l.startsWith("[sse]"))).toEqual(["[sse] tick gagal: SQLITE_BUSY"])
    warn.mockRestore()
  })
})

describe("CR-5-4 cursor opak (AC-6.19)", () => {
  it("halaman 2 tetap 200 setelah job cursor terhapus; job baru di antara fetch tidak menghilangkan item; cursor rusak → 400", async () => {
    for (let i = 0; i < 5; i++) job(`j${i}`, { createdAt: new Date(T0.getTime() + i * 1000).toISOString() })
    const p1 = await (await jobsGET(getReq("/api/jobs?limit=2"))).json()
    expect(p1.jobs.map((j: { id: string }) => j.id)).toEqual(["j4", "j3"])
    expect(p1.nextBefore).not.toContain("j3")
    expect(decodeJobCursor(p1.nextBefore)).toEqual({ createdAt: new Date(T0.getTime() + 3000).toISOString(), id: "j3" })
    // Job cursor dihapus (retensi) + job baru masuk di depan.
    getDb().prepare("DELETE FROM jobs WHERE id = 'j3'").run()
    job("j9", { createdAt: new Date(T0.getTime() + 9000).toISOString() })
    const p2 = await jobsGET(getReq(`/api/jobs?limit=2&before=${p1.nextBefore}`))
    expect(p2.status).toBe(200)
    const b2 = await p2.json()
    expect(b2.jobs.map((j: { id: string }) => j.id)).toEqual(["j2", "j1"])
    const p3 = await (await jobsGET(getReq(`/api/jobs?limit=2&before=${b2.nextBefore}`))).json()
    expect(p3).toMatchObject({ nextBefore: null })
    expect(p3.jobs.map((j: { id: string }) => j.id)).toEqual(["j0"])
    for (const bad of ["j3", "x", Buffer.from("tanpa-pemisah").toString("base64url"), Buffer.from("bukan-tanggal|j1").toString("base64url"), Buffer.from(`${T0.toISOString()}|a b`).toString("base64url"), `${encodeJobCursor({ createdAt: T0.toISOString(), id: "j1" })}A`]) {
      const r = await jobsGET(getReq(`/api/jobs?before=${encodeURIComponent(bad)}`))
      expect(r.status, bad).toBe(400)
    }
    expect(listJobs({ limit: 1, before: "%%%" })).toBeNull()
  })
})

describe("CR-5-8 install setelah timeout tanpa GET (AC-6.23)", () => {
  it("job booting lewat timeout → POST install → 200 job baru; job lama failed timeout-booting", async () => {
    const media = tmpDir("m6-media")
    const { makeMediaRoot } = await import("@/test/db")
    makeMediaRoot(media)
    process.env.PXE_MEDIA_ROOT = media
    const { applyConfig } = await import("@/lib/server/config-service")
    const r = await applyConfig([HOST], {
      os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
      credentials: { mode: "same", username: "ops", password: "Fixture-Pass-7319", sudo: true, disableSshPassword: false },
    })
    expect(r.ok).toBe(true)
    const old = new Date(Date.now() - 61 * 60_000).toISOString()
    job("job-old", { status: "booting", finishedAt: null, createdAt: old, stages: [{ stage: "booting", at: old, source: "install" }] })
    getDb().prepare("UPDATE hosts SET status = 'booting' WHERE id = ?").run(HOST)
    const res = await installPOST(jsonReq(`/api/hosts/${HOST}/install`, "POST"), p(HOST))
    expect(res.status).toBe(200)
    expect(getJob("job-old")).toMatchObject({ status: "failed", failureReason: "timeout-booting" })
    expect((await (await jobsGET(getReq(`/api/jobs?hostId=${HOST}`))).json()).jobs[0]).toMatchObject({ status: "booting" })
  })
})

describe("CR-5-3 sweep tanpa write lock bila tidak ada kandidat (AC-6.18)", () => {
  it("koneksi kedua memegang BEGIN IMMEDIATE → GET hosts/jobs/job 200 tanpa SQLITE_BUSY; job jatuh tempo disapu setelah lock lepas", async () => {
    const file = path.join(tmpDir("m6-busy"), "pxe.db")
    process.env.PXE_DB_PATH = file
    closeDb()
    const { resetDb } = await import("@/lib/server/db/reset")
    resetDb("demo")
    job("job-active", { status: "installing", finishedAt: null, stages: [{ stage: "installing", at: new Date().toISOString(), source: "config-fetch" }] })
    getDb().exec("PRAGMA busy_timeout = 50")
    // Request (dan sesinya) disusun sebelum lock diambil: pembuatan sesi adalah tulis.
    const reqs = [getReq("/api/hosts"), getReq("/api/jobs"), getReq("/api/jobs/job-active")]
    const other = new DatabaseSync(file)
    other.exec("PRAGMA busy_timeout = 0")
    other.exec("BEGIN IMMEDIATE")
    try {
      const t = Date.now()
      expect((await hostsGET(reqs[0])).status).toBe(200)
      expect((await jobsGET(reqs[1])).status).toBe(200)
      expect((await jobGET(reqs[2], p("job-active"))).status).toBe(200)
      expect(Date.now() - t).toBeLessThan(2000)
    } finally {
      other.exec("ROLLBACK")
    }
    // Job jatuh tempo → sweep menandai failed (lock sudah lepas).
    getDb().prepare("UPDATE jobs SET stages = ? WHERE id = 'job-active'").run(JSON.stringify([{ stage: "installing", at: "2020-01-01T00:00:00.000Z", source: "x" }]))
    expect((await (await jobGET(getReq("/api/jobs/job-active"), p("job-active"))).json()).status).toBe("failed")
    other.close()
    closeDb()
    delete process.env.PXE_DB_PATH
  })
})

describe("SR-5-8 nama tampilan tanpa karakter kontrol/bidi/PUA (AC-6.27)", () => {
  const BAD = ["evil‮txt", "bel\u0007", "rlm‏", "pua", "tab\tx", "zw​j", "iso⁦x"]
  it("POST/PATCH ssh-keys dan POST os-images → 400 per field; Unicode biasa diterima", async () => {
    for (const name of BAD) {
      const r = await keysPOST(jsonReq("/api/ssh-keys", "POST", { name, publicKey: SSH_ED25519_B.publicKey }))
      expect(r.status, JSON.stringify(name)).toBe(400)
      const body = await r.json()
      expect(body.errors[0].message).toMatch(/^name: Tidak boleh memuat karakter kontrol/)
    }
    const ok = await keysPOST(jsonReq("/api/ssh-keys", "POST", { name: "Kunci Budi – lab é", publicKey: SSH_ED25519_B.publicKey }))
    expect(ok.status).toBe(201)
    const id = (await ok.json()).id
    for (const name of BAD) expect((await keyPATCH(jsonReq(`/api/ssh-keys/${id}`, "PATCH", { name }), p(id))).status, JSON.stringify(name)).toBe(400)
    expect((await keyPATCH(jsonReq(`/api/ssh-keys/${id}`, "PATCH", { name: "  Kunci Ñandú  " }), p(id))).status).toBe(200)
    const img = (o: Record<string, string>) => ({ id: "img-x", name: "Img", version: "1", arch: "amd64", method: "autoinstall", bootable: false, source: { kernel: "", initrd: "", repo: "img" }, ...o })
    for (const v of BAD) {
      for (const field of ["name", "version"]) {
        const r = await imagesPOST(jsonReq("/api/os-images", "POST", img({ [field]: v })))
        expect(r.status, `${field} ${JSON.stringify(v)}`).toBe(400)
        expect((await r.json()).errors[0].message).toMatch(new RegExp(`^${field}: Tidak boleh`))
      }
    }
    expect((await imagesPOST(jsonReq("/api/os-images", "POST", img({ name: "Ubuntu – kustom", version: "24.04 LTS" })))).status).toBe(201)
  })
})
