// M5-T12 (test-engineer): integration route handler API M5 (DB :memory: per test, jam injeksi).
//   AC-5.1  GET /api/settings memuat pengaturan job dari env, tanpa path DB/flag rahasia
//   AC-5.4  allowlist Host untuk SEMUA GET /api/** (403/200) + X-Forwarded-Host hanya bila trust proxy
//   AC-5.14 (integration) baris log installer berisi secret tersimpan tersamarkan
//   AC-5.15 retensi riwayat per host (PXE_JOB_HISTORY_PER_HOST) lewat route install + cascade hapus host
//   AC-5.16 GET /api/jobs (filter, urutan, cursor, bentuk, tanpa token rekursif, 400) + /:id + lastJob
//   AC-5.17 SSE /api/jobs/:id/logs (header, backlog, live ≤ 2 dtk, Last-Event-ID, gabungan, ping,
//           stage, end, abort, 503, 404) + konsistensi mode JSON
//   AC-5.18 PATCH /api/ssh-keys/:id + usedBy ssh-keys/os-images + 409 hapus terpakai
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyConfig } from "@/lib/server/config-service"
import { getDb } from "@/lib/server/db"
import { appendEvent, eventsAfter } from "@/lib/server/db/repos/job-events"
import { getActiveJob, listJobsForHost } from "@/lib/server/db/repos/jobs"
import { decideBoot } from "@/lib/server/discovery"
import { handleLogPost, handleStatusCallback } from "@/lib/server/provisioning"
import { jobLogStream, SSE_MAX_CONNECTIONS, sseConnections } from "@/lib/server/sse"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD, FAKE_PRIVATE_KEY, SSH_ED25519, SSH_ED25519_B } from "@/test/fixtures"
import { getReq, jsonReq } from "@/test/route"

import { DELETE as hostDELETE, GET as hostGET } from "./hosts/[id]/route"
import { GET as configGET } from "./hosts/[id]/config/route"
import { POST as installPOST } from "./hosts/[id]/install/route"
import { GET as hostsGET } from "./hosts/route"
import { GET as jobGET } from "./jobs/[id]/route"
import { GET as logsGET } from "./jobs/[id]/logs/route"
import { GET as jobsGET } from "./jobs/route"
import { GET as networkGET } from "./network/route"
import { DELETE as imageDELETE } from "./os-images/[id]/route"
import { GET as imagesGET } from "./os-images/route"
import { GET as statusGET } from "./server-status/route"
import { GET as settingsGET } from "./settings/route"
import { DELETE as keyDELETE, PATCH as keyPATCH } from "./ssh-keys/[id]/route"
import { GET as keysGET, POST as keysPOST } from "./ssh-keys/route"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

const MEDIA = makeMediaRoot(tmpDir("m5te-api-media"))
withDb("empty", {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_MEDIA_ROOT: MEDIA,
  PXE_INSECURE_NO_LEASE_CHECK: "1",
})

const MACS = ["52:54:00:99:00:11", "52:54:00:99:00:12"]
const IDS = MACS.map((m) => m.replaceAll(":", ""))
const IP = "10.99.0.150"
const T0 = Date.parse("2026-11-05T10:00:00.000Z")
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//
const p = <T extends object>(v: T) => ({ params: Promise.resolve(v) }) as never
const FORBIDDEN_KEYS = ["token", "tokenHash", "token_hash", "tokenExpiresAt", "token_expires_at"]

function hasKeyDeep(v: unknown, keys: string[]): boolean {
  if (Array.isArray(v)) return v.some((x) => hasKeyDeep(x, keys))
  if (v && typeof v === "object") return Object.entries(v).some(([k, x]) => keys.includes(k) || hasKeyDeep(x, keys))
  return false
}

let clock = T0
const tick = (ms = 1000) => {
  clock += ms
  vi.setSystemTime(clock)
  return new Date(clock)
}

/** Host dikenali + konfigurasi (OS, credentials, key library bersama). */
async function ready(i: number, keyIds: string[] = []) {
  decideBoot({ mac: MACS[i], platform: "efi", ip: IP, wait: 0, now: new Date(clock) })
  const r = await applyConfig([IDS[i]], {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
    ssh: keyIds.length
      ? { keyIds, newKeys: [], user: "" }
      : { keyIds: [], newKeys: [{ name: "lab", publicKey: SSH_ED25519.publicKey, saveToLibrary: true }], user: "" },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
}
async function install(i: number) {
  tick()
  const res = await installPOST(jsonReq(`/api/hosts/${IDS[i]}/install`, "POST"), p({ id: IDS[i] }))
  expect(res.status).toBe(200)
  return getActiveJob(IDS[i])!.id
}
function bootToken(i: number) {
  const d = decideBoot({ mac: MACS[i], platform: "efi", ip: IP, wait: 0, now: tick() })
  return TOKEN_RE.exec(d.script)![1]
}
/** install → boot → failed (callback installer-error) → job final. */
async function installAndFail(i: number) {
  const id = await install(i)
  const token = bootToken(i)
  expect(handleStatusCallback({ mac: MACS[i], token, stage: "failed", ip: IP, now: tick() })).toMatchObject({ status: 200 })
  return id
}

beforeEach(() => {
  clock = T0
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(clock)
})
afterEach(() => vi.useRealTimers())

// ---------------------------------------------------------------------------
describe("AC-5.1 GET /api/settings: pengaturan job dari env, read-only, tanpa rahasia", () => {
  it("nilai env (KVM) tercermin; default bila tidak diset; tanpa path DB/seed/allowlist/leases", async () => {
    Object.assign(process.env, {
      PXE_JOB_BOOTING_TIMEOUT_MIN: "30",
      PXE_JOB_INSTALLING_TIMEOUT_MIN: "15",
      PXE_JOB_CONFIGURING_TIMEOUT_MIN: "45",
      PXE_JOB_MAX_INSTALLER_BOOTS: "2",
      PXE_DB_PATH: ":memory:",
      PXE_ALLOWED_HOSTS: "localhost,pxe.lab.example",
    })
    const res = await settingsGET(getReq("/api/settings"))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(body).toMatchObject({
      jobTimeouts: { bootingMin: 30, installingMin: 15, configuringMin: 45 },
      maxInstallerBoots: 2,
      insecureNoLeaseCheck: true,
    })
    const text = JSON.stringify(body)
    for (const k of ["dbPath", "PXE_DB_PATH", ":memory:", "seed", "allowedHosts", "pxe.lab.example", "dnsmasqLeases", "watchdogIntervalSec", "jobLogMaxEvents"]) {
      expect(text, k).not.toContain(k)
    }
    delete process.env.PXE_JOB_BOOTING_TIMEOUT_MIN
    delete process.env.PXE_JOB_INSTALLING_TIMEOUT_MIN
    delete process.env.PXE_JOB_CONFIGURING_TIMEOUT_MIN
    delete process.env.PXE_JOB_MAX_INSTALLER_BOOTS
    process.env.PXE_INSECURE_NO_LEASE_CHECK = "0"
    const d = await (await settingsGET(getReq("/api/settings"))).json()
    expect(d).toMatchObject({ jobTimeouts: { bootingMin: 60, installingMin: 120, configuringMin: 60 }, maxInstallerBoots: 3, insecureNoLeaseCheck: false })
  })
  it("env job tidak valid → 500 yang menyebut nama variabel", async () => {
    process.env.PXE_JOB_MAX_INSTALLER_BOOTS = "0"
    const res = await settingsGET(getReq("/api/settings"))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/PXE_JOB_MAX_INSTALLER_BOOTS/)
  })
})

describe("AC-5.4 allowlist Host untuk semua GET /api/** + CR-4-15 X-Forwarded-Host", () => {
  async function routes(host: Record<string, string>) {
    const jobId = getActiveJob(IDS[0])!.id
    const g = (u: string) => getReq(u, host)
    return {
      hosts: await hostsGET(g("/api/hosts")),
      "hosts/:id": await hostGET(g(`/api/hosts/${IDS[0]}`), p({ id: IDS[0] })),
      config: await configGET(g(`/api/hosts/${IDS[0]}/config`), p({ id: IDS[0] })),
      jobs: await jobsGET(g("/api/jobs")),
      "jobs/:id": await jobGET(g(`/api/jobs/${jobId}`), p({ id: jobId })),
      "jobs/:id/logs": await logsGET(g(`/api/jobs/${jobId}/logs?format=json`), p({ id: jobId })),
      settings: await settingsGET(g("/api/settings")),
      "server-status": await statusGET(g("/api/server-status")),
      network: await networkGET(g("/api/network")),
      "os-images": await imagesGET(g("/api/os-images")),
      "ssh-keys": await keysGET(g("/api/ssh-keys")),
    }
  }
  it("Host di luar allowlist → 403 `Host tidak diizinkan` untuk 11 GET; Host diizinkan → 200", async () => {
    await ready(0)
    await install(0)
    const bad = await routes({ host: "evil.example" })
    expect(Object.keys(bad)).toHaveLength(11)
    for (const [name, res] of Object.entries(bad)) {
      expect(res.status, name).toBe(403)
      expect(await res.json(), name).toEqual({ error: "Host tidak diizinkan" })
    }
    const good = await routes({ host: "localhost:3000" })
    for (const [name, res] of Object.entries(good)) expect(res.status, name).toBe(200)
    process.env.PXE_ALLOWED_HOSTS = "pxe.lab.example"
    for (const [name, res] of Object.entries(await routes({ host: "pxe.lab.example" }))) expect(res.status, name).toBe(200)
    for (const [name, res] of Object.entries(await routes({ host: "localhost" }))) expect(res.status, name).toBe(403)
  })
  it("PXE_TRUST_PROXY=0: X-Forwarded-Host yang diizinkan tidak membuka GET/mutasi ber-Host asing; =1 → header dipakai", async () => {
    await ready(0)
    const id = (await (await keysGET(getReq("/api/ssh-keys"))).json())[0].id
    process.env.PXE_ALLOWED_HOSTS = "pxe.lab.example"
    const hdr = { host: "evil.example", "x-forwarded-host": "pxe.lab.example" }
    const mut = () => keyPATCH(new Request(`http://evil.example/api/ssh-keys/${id}`, { method: "PATCH", headers: { ...hdr, "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) }), p({ id }))
    expect((await hostsGET(getReq("/api/hosts", hdr))).status).toBe(403)
    expect((await mut()).status).toBe(403)
    process.env.PXE_TRUST_PROXY = "1"
    process.env.PXE_INSECURE_NO_LEASE_CHECK = "1"
    expect((await hostsGET(getReq("/api/hosts", hdr))).status).toBe(200)
    expect((await mut()).status).toBe(200)
    // Trust proxy + XFH asing → 403 walau Host diizinkan.
    expect((await hostsGET(getReq("/api/hosts", { host: "pxe.lab.example", "x-forwarded-host": "evil.example" }))).status).toBe(403)
  })
})

describe("AC-5.14 (integration) log installer dengan secret tersimpan tersamarkan", () => {
  it("token path/kv, hash $6$, blok private key, base64 bertoken → [REDACTED…]; tidak ada plaintext di DB", async () => {
    await ready(0)
    await install(0)
    const token = bootToken(0)
    const TOK = "Q".repeat(43)
    const HASH = "$6$rounds=5000$saltsalt$" + "h".repeat(86)
    const b64 = Buffer.from(`curl http://10.99.0.2/boot/52:54:00:99:00:11/${TOK}/status`).toString("base64")
    const lines = [
      `GET /boot/52:54:00:99:00:11/${TOK}/user-data`,
      `token=${TOK}`,
      `{"token":"${TOK}"}`,
      `password: ${HASH}`,
      FAKE_PRIVATE_KEY.split("\n")[0] + " " + FAKE_PRIVATE_KEY.split("\n").slice(1, 3).join(" "),
      `printf %s '${b64}' | base64 -d`,
      "baris biasa tanpa secret",
    ]
    const r = handleLogPost({ mac: MACS[0], token, text: lines.join("\n") + "\n", ip: IP, now: tick() })
    expect(r).toMatchObject({ ok: true, accepted: lines.length })
    const msgs = eventsAfter(getActiveJob(IDS[0])!.id, 0, 100).filter((e) => e.kind === "installer").map((e) => e.message)
    expect(msgs[0]).toBe("GET /boot/52:54:00:99:00:11/[REDACTED]/user-data")
    expect(msgs[1]).toBe("token=[REDACTED]")
    expect(msgs[2]).toBe('{"token":"[REDACTED]"}')
    expect(msgs[3]).toBe("password: $6$[REDACTED]")
    expect(msgs[4]).toContain("[REDACTED PRIVATE KEY]")
    expect(msgs[5]).toBe("printf %s '[REDACTED-B64]' | base64 -d")
    expect(msgs[6]).toBe("baris biasa tanpa secret")
    const all = (getDb().prepare("SELECT message FROM job_events").all() as { message: string }[]).map((x) => x.message).join("\n")
    for (const s of [TOK, HASH, "$6$rounds", b64, token]) expect(all).not.toContain(s)
  })
})

describe("AC-5.15 retensi riwayat per host + cascade", () => {
  it("PXE_JOB_HISTORY_PER_HOST=2: install ke-4 menyisakan 2 job final terbaru + job aktif; event job terhapus ikut hilang", async () => {
    process.env.PXE_JOB_HISTORY_PER_HOST = "2"
    await ready(0)
    const ids = [await installAndFail(0), await installAndFail(0), await installAndFail(0)]
    expect(listJobsForHost(IDS[0])).toHaveLength(3) // prune terjadi saat install (bukan saat gagal)
    const active = await install(0)
    const left = listJobsForHost(IDS[0]).map((j) => j.id)
    expect([...left].sort()).toEqual([active, ids[2], ids[1]].sort())
    const evOrphan = getDb().prepare("SELECT count(*) AS n FROM job_events WHERE job_id = ?").get(ids[0]) as { n: number }
    expect(evOrphan.n).toBe(0)
    expect(eventsAfter(ids[1], 0, 100).length).toBeGreaterThan(0)
    const { jobs } = await (await jobsGET(getReq(`/api/jobs?hostId=${IDS[0]}`))).json()
    expect(jobs.map((j: { id: string }) => j.id)).toEqual([active, ids[2], ids[1]])
  })
  it("host lain tidak terpengaruh prune; hapus host → semua job & event host itu terhapus", async () => {
    process.env.PXE_JOB_HISTORY_PER_HOST = "1"
    await ready(0)
    const kid = (await (await keysGET(getReq("/api/ssh-keys"))).json())[0].id
    await ready(1, [kid])
    await installAndFail(1)
    await installAndFail(0)
    await installAndFail(0)
    await install(0)
    expect(listJobsForHost(IDS[1])).toHaveLength(1)
    expect(listJobsForHost(IDS[0])).toHaveLength(2)
    const res = await hostDELETE(new Request(`http://localhost/api/hosts/${IDS[0]}`, { method: "DELETE" }), p({ id: IDS[0] }))
    expect([200, 204]).toContain(res.status)
    const n = (sql: string, ...a: string[]) => (getDb().prepare(sql).get(...a) as { n: number }).n
    expect(n("SELECT count(*) AS n FROM jobs WHERE host_id = ?", IDS[0])).toBe(0)
    expect(n("SELECT count(*) AS n FROM job_events e JOIN jobs j ON j.id = e.job_id WHERE j.host_id = ?", IDS[0])).toBe(0)
    expect(n("SELECT count(*) AS n FROM job_events WHERE job_id NOT IN (SELECT id FROM jobs)")).toBe(0)
    expect(listJobsForHost(IDS[1])).toHaveLength(1)
  })
})

describe("AC-5.16 GET /api/jobs + /:id + lastJob", () => {
  async function seed() {
    await ready(0)
    const kid = (await (await keysGET(getReq("/api/ssh-keys"))).json())[0].id
    await ready(1, [kid])
    const a1 = await installAndFail(0)
    const b1 = await installAndFail(1)
    const a2 = await installAndFail(0)
    const b2 = await install(1)
    const a3 = await install(0)
    return { a1, a2, a3, b1, b2 } // urutan dibuat: a1 b1 a2 b2 a3
  }
  it("urut terbaru dulu; filter hostId/status; bentuk JobSummary persis; tanpa kunci token (rekursif); no-store", async () => {
    const { a1, a2, a3, b1, b2 } = await seed()
    const res = await jobsGET(getReq("/api/jobs"))
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(["jobs", "nextBefore", "serverTime"])
    expect(body.jobs.map((j: { id: string }) => j.id)).toEqual([a3, b2, a2, b1, a1])
    expect(hasKeyDeep(body, FORBIDDEN_KEYS)).toBe(false)
    for (const j of body.jobs) {
      expect(Object.keys(j).sort()).toEqual(
        ["createdAt", "eventCount", "failureReason", "finishedAt", "host", "hostId", "id", "installerBoots", "osImageId", "stages", "status", "type", "updatedAt"],
      )
      expect(Object.keys(j.host).sort()).toEqual(["hostname", "mac"])
      for (const s of j.stages) expect(Object.keys(s).sort()).toEqual(["at", "source", "stage"])
      expect(j.type).toBe("install")
    }
    const ids = async (q: string) => (await (await jobsGET(getReq(`/api/jobs?${q}`))).json()).jobs.map((j: { id: string }) => j.id)
    expect(await ids(`hostId=${IDS[0]}`)).toEqual([a3, a2, a1])
    expect(await ids(`hostId=${IDS[0].toUpperCase()}`)).toEqual([a3, a2, a1])
    expect(await ids("status=failed")).toEqual([a2, b1, a1])
    expect(await ids(`status=booting&hostId=${IDS[1]}`)).toEqual([b2])
    expect(await ids("status=done")).toEqual([])
    const f = body.jobs.find((j: { id: string }) => j.id === a1)
    expect(f).toMatchObject({ status: "failed", failureReason: "installer-error", installerBoots: 1, host: { mac: MACS[0], hostname: null } })
    expect(f.eventCount).toBeGreaterThan(0)
    expect(f.finishedAt).not.toBeNull()
  })
  it("limit + nextBefore: halaman tanpa duplikat/lompatan sampai habis", async () => {
    const { a1, a2, a3, b1, b2 } = await seed()
    const seen: string[] = []
    let before: string | null = null
    let pages = 0
    do {
      const q: string = `limit=2${before ? `&before=${before}` : ""}`
      const body: { jobs: { id: string }[]; nextBefore: string | null } = await (await jobsGET(getReq(`/api/jobs?${q}`))).json()
      expect(body.jobs.length).toBeLessThanOrEqual(2)
      seen.push(...body.jobs.map((j) => j.id))
      before = body.nextBefore
      pages++
    } while (before && pages < 10)
    expect(seen).toEqual([a3, b2, a2, b1, a1])
    expect(pages).toBe(3)
    // filter + cursor
    const p1 = await (await jobsGET(getReq(`/api/jobs?hostId=${IDS[0]}&limit=1`))).json()
    const p2 = await (await jobsGET(getReq(`/api/jobs?hostId=${IDS[0]}&limit=1&before=${p1.nextBefore}`))).json()
    expect([p1.jobs[0].id, p2.jobs[0].id]).toEqual([a3, a2])
  })
  it.each(["limit=0", "limit=500", "limit=201", "limit=1.5", "status=xyz", "hostId=52540099001", "hostId=zzzzzzzzzzzz", "before=a/b", "foo=1", "limit=1&limit=2"])(
    "%s → 400",
    async (q) => {
      const res = await jobsGET(getReq(`/api/jobs?${q}`))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toEqual(expect.any(String))
    },
  )
  it("limit=200 dan limit=1 diterima", async () => {
    expect((await jobsGET(getReq("/api/jobs?limit=200"))).status).toBe(200)
    expect((await jobsGET(getReq("/api/jobs?limit=1"))).status).toBe(200)
  })
  it("GET /api/jobs/:id → 200 JobSummary sama dengan item daftar; 400 id tidak valid; 404 tidak ada", async () => {
    const { a2 } = await seed()
    const list = (await (await jobsGET(getReq("/api/jobs"))).json()).jobs
    const one = await jobGET(getReq(`/api/jobs/${a2}`), p({ id: a2 }))
    expect(one.status).toBe(200)
    const j = await one.json()
    expect(j).toEqual(list.find((x: { id: string }) => x.id === a2))
    expect(hasKeyDeep(j, FORBIDDEN_KEYS)).toBe(false)
    expect((await jobGET(getReq("/api/jobs/x"), p({ id: "../etc" }))).status).toBe(400)
    expect((await jobGET(getReq("/api/jobs/x"), p({ id: "x".repeat(65) }))).status).toBe(400)
    expect((await jobGET(getReq("/api/jobs/x"), p({ id: "job-00000000-0000-0000-0000-000000000000" }))).status).toBe(404)
  })
  it("GET /api/hosts: lastJob = job terbaru tiap host; host tanpa job → null; /api/hosts/:id konsisten", async () => {
    await ready(0)
    const kid = (await (await keysGET(getReq("/api/ssh-keys"))).json())[0].id
    await ready(1, [kid])
    await installAndFail(0)
    const latest = await install(0)
    const hosts = (await (await hostsGET(getReq("/api/hosts"))).json()).hosts
    const h0 = hosts.find((h: { id: string }) => h.id === IDS[0])
    const h1 = hosts.find((h: { id: string }) => h.id === IDS[1])
    const j = getActiveJob(IDS[0])!
    expect(h0.lastJob).toEqual({ id: latest, status: "booting", failureReason: null, createdAt: j.createdAt })
    expect(h1.lastJob).toBeNull()
    const one = await (await hostGET(getReq(`/api/hosts/${IDS[0]}`), p({ id: IDS[0] }))).json()
    expect(one.lastJob).toEqual(h0.lastJob)
    expect(hasKeyDeep(hosts, FORBIDDEN_KEYS)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe("AC-5.17 SSE GET /api/jobs/:id/logs", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.useFakeTimers({ now: T0, toFake: ["Date", "setTimeout", "setInterval", "clearTimeout", "clearInterval"] })
  })

  /** Kumpulkan stream di latar; `text()` = isi sejauh ini, `done` = stream selesai. */
  function collect(res: Response) {
    const reader = res.body!.getReader()
    const st = { buf: "", done: false }
    const loop = (async () => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          st.done = true
          return
        }
        st.buf += new TextDecoder().decode(value)
      }
    })()
    return { st, loop, reader }
  }
  const frames = (buf: string) => buf.split("\n\n").filter(Boolean)
  const logFrames = (buf: string) =>
    frames(buf)
      .filter((f) => f.startsWith("event: log\n"))
      .map((f) => {
        const id = Number(/^id: (\d+)$/m.exec(f)![1])
        const data = JSON.parse(/^data: (.*)$/m.exec(f)![1])
        return { id, data }
      })
  const sse = (jobId: string, headers: Record<string, string> = {}, signal?: AbortSignal, q = "") =>
    logsGET(
      new Request(`http://localhost/api/jobs/${jobId}/logs${q}`, { headers: { accept: "text/event-stream", ...headers }, signal }),
      p({ id: jobId }),
    )
  async function activeJob() {
    await ready(0)
    const jobId = await install(0)
    const token = bootToken(0)
    return { jobId, token }
  }

  it("header; retry; backlog id=seq + data lengkap; event baru tiba ≤ 2 dtk; ping 15 dtk; stage; end lalu selesai; tanpa timer tersisa", async () => {
    const { jobId, token } = await activeJob()
    const res = await sse(jobId)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/)
    expect(res.headers.get("cache-control")).toContain("no-cache")
    expect(res.headers.get("x-accel-buffering")).toBe("no")
    const c = collect(res)
    await vi.advanceTimersByTimeAsync(10)
    expect(c.st.buf.startsWith("retry: 3000\n\n")).toBe(true)
    const backlog = logFrames(c.st.buf)
    const dbEv = eventsAfter(jobId, 0, 100)
    expect(backlog.map((f) => f.id)).toEqual(dbEv.map((e) => e.seq))
    expect(backlog[0].data).toEqual({ seq: dbEv[0].seq, at: dbEv[0].at, kind: dbEv[0].kind, level: dbEv[0].level, source: dbEv[0].source, message: dbEv[0].message, repeat: dbEv[0].repeat })
    // event baru setelah tersambung
    handleLogPost({ mac: MACS[0], token, text: "installer: live 1\n", ip: IP, now: new Date() })
    await vi.advanceTimersByTimeAsync(2000)
    expect(logFrames(c.st.buf).at(-1)!.data.message).toBe("installer: live 1")
    // heartbeat
    expect(c.st.buf).not.toContain(": ping")
    await vi.advanceTimersByTimeAsync(13_100)
    expect(c.st.buf.match(/^: ping$/gm)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(c.st.buf.match(/^: ping$/gm)).toHaveLength(2)
    // perubahan status → event: stage
    expect(handleStatusCallback({ mac: MACS[0], token, stage: "configuring", ip: IP, now: new Date() }).status).toBe(200)
    await vi.advanceTimersByTimeAsync(1100)
    const stageFrame = frames(c.st.buf).find((f) => f.startsWith("event: stage\n"))!
    expect(JSON.parse(/^data: (.*)$/m.exec(stageFrame)![1])).toMatchObject({ id: jobId, status: "configuring" })
    expect(hasKeyDeep(JSON.parse(/^data: (.*)$/m.exec(stageFrame)![1]), FORBIDDEN_KEYS)).toBe(false)
    expect(c.st.done).toBe(false)
    // final → end + selesai
    handleStatusCallback({ mac: MACS[0], token, stage: "done", ip: IP, now: new Date() })
    await vi.advanceTimersByTimeAsync(1100)
    await c.loop
    expect(c.st.done).toBe(true)
    expect(frames(c.st.buf).at(-1)).toMatch(/^event: end\ndata: \{"status":"done"\}$/)
    expect(logFrames(c.st.buf).at(-1)!.id).toBe(eventsAfter(jobId, 0, 100).at(-1)!.seq)
    expect(sseConnections()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it("Last-Event-ID: k → hanya seq > k; ?after=k sama", async () => {
    const { jobId, token } = await activeJob()
    handleLogPost({ mac: MACS[0], token, text: "a\nb\nc\n", ip: IP, now: new Date() })
    const total = eventsAfter(jobId, 0, 100).length
    for (const res of [await sse(jobId, { "last-event-id": "3" }), await sse(jobId, {}, undefined, "?after=3")]) {
      const c = collect(res)
      await vi.advanceTimersByTimeAsync(10)
      expect(logFrames(c.st.buf).map((f) => f.id)).toEqual(Array.from({ length: total - 3 }, (_, i) => i + 4))
      await c.reader.cancel()
    }
    expect(sseConnections()).toBe(0)
    expect((await sse(jobId, { "last-event-id": "abc" })).status).toBe(400)
  })
  it("event gabungan dikirim ulang dengan id sama + repeat baru (klien mengganti baris)", async () => {
    const { jobId } = await activeJob()
    const w = { kind: "system", level: "warn", source: "boot-script", message: "PXE boot ulang" } as const
    appendEvent(jobId, { ...w, at: new Date().toISOString() }, 5000)
    const c = collect(await sse(jobId))
    await vi.advanceTimersByTimeAsync(10)
    const last = logFrames(c.st.buf).at(-1)!
    expect(last.data).toMatchObject({ message: "PXE boot ulang", repeat: 1 })
    vi.setSystemTime(Date.now() + 5000)
    expect(appendEvent(jobId, { ...w, at: new Date().toISOString() }, 5000)).toMatchObject({ status: "merged", repeat: 2 })
    await vi.advanceTimersByTimeAsync(1100)
    const again = logFrames(c.st.buf).filter((f) => f.id === last.id)
    expect(again.map((f) => f.data.repeat)).toEqual([1, 2])
    await c.reader.cancel()
  })
  it("abort klien menghentikan loop (tanpa timer & koneksi tersisa); signal sudah abort → tertutup", async () => {
    const { jobId } = await activeJob()
    const ac = new AbortController()
    const c = collect(await sse(jobId, {}, ac.signal))
    await vi.advanceTimersByTimeAsync(3000)
    expect(sseConnections()).toBe(1)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    ac.abort()
    await vi.advanceTimersByTimeAsync(10)
    expect(sseConnections()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    await c.loop
    expect(c.st.done).toBe(true)
  })
  it("umur maksimum 30 mnt → stream ditutup", async () => {
    const { jobId } = await activeJob()
    const c = collect(await sse(jobId))
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 100)
    await c.loop
    expect(c.st.done).toBe(true)
    expect(sseConnections()).toBe(0)
  })
  it("koneksi ke-51 → 503 + Retry-After; job tak ada → 404; id invalid → 400", async () => {
    const { jobId } = await activeJob()
    const open = Array.from({ length: SSE_MAX_CONNECTIONS }, () => jobLogStream(jobId, 0, null)!)
    expect(sseConnections()).toBe(50)
    const res = await sse(jobId)
    expect(res.status).toBe(503)
    expect(res.headers.get("retry-after")).toBe("5")
    for (const s of open) await s.cancel()
    expect(sseConnections()).toBe(0)
    expect((await sse("job-00000000-0000-0000-0000-000000000000")).status).toBe(404)
    expect((await sse("a/b")).status).toBe(400)
  })
  it("mode JSON (?format=json&after=k) konsisten dengan SSE; final setelah job selesai", async () => {
    const { jobId, token } = await activeJob()
    handleLogPost({ mac: MACS[0], token, text: "x\ny\n", ip: IP, now: new Date() })
    const c = collect(await sse(jobId))
    await vi.advanceTimersByTimeAsync(10)
    const viaSse = logFrames(c.st.buf).map((f) => f.data)
    await c.reader.cancel()
    const j = await (await logsGET(getReq(`/api/jobs/${jobId}/logs?format=json&after=0`, { accept: "text/event-stream" }), p({ id: jobId }))).json()
    expect(j.events).toEqual(viaSse)
    expect(j).toMatchObject({ lastSeq: viaSse.at(-1).seq, final: false })
    const j2 = await (await logsGET(getReq(`/api/jobs/${jobId}/logs?format=json&after=2`), p({ id: jobId }))).json()
    expect(j2.events).toEqual(viaSse.filter((e: { seq: number }) => e.seq > 2))
    handleStatusCallback({ mac: MACS[0], token, stage: "failed", ip: IP, now: new Date() })
    const j3 = await (await logsGET(getReq(`/api/jobs/${jobId}/logs?format=json&after=${j.lastSeq}`), p({ id: jobId }))).json()
    expect(j3.final).toBe(true)
    expect(j3.events.at(-1)).toMatchObject({ kind: "stage" })
    const j4 = await (await logsGET(getReq(`/api/jobs/${jobId}/logs?format=json&after=${j3.lastSeq}`), p({ id: jobId }))).json()
    expect(j4).toEqual({ events: [], lastSeq: j3.lastSeq, final: true })
  })
})

// ---------------------------------------------------------------------------
describe("AC-5.18 PATCH /api/ssh-keys/:id + usedBy + 409", () => {
  async function keyId() {
    await ready(0)
    return (await (await keysGET(getReq("/api/ssh-keys"))).json())[0] as { id: string; name: string; publicKey: string; fingerprint: string; usedBy: number }
  }
  const patch = (id: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
    keyPATCH(new Request(`http://localhost/api/ssh-keys/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) }), p({ id }))

  it("{name} → 200 dan tersimpan (GET); nama 64 karakter diterima", async () => {
    const k = await keyId()
    const res = await patch(k.id, { name: "kunci-lab-baru" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ id: k.id, name: "kunci-lab-baru", publicKey: k.publicKey, fingerprint: k.fingerprint })
    expect((await (await keysGET(getReq("/api/ssh-keys"))).json())[0].name).toBe("kunci-lab-baru")
    expect((await patch(k.id, { name: "n".repeat(64) })).status).toBe(200)
  })
  it.each([[{ name: "" }], [{ name: "x".repeat(65) }], [{}], [{ name: 5 }], [{ name: "a", publicKey: SSH_ED25519_B.publicKey }], [{ name: "a", fingerprint: "SHA256:xxx" }]])(
    "body %j → 400, key tidak berubah",
    async (b) => {
      const k = await keyId()
      expect((await patch(k.id, b)).status).toBe(400)
      expect((await (await keysGET(getReq("/api/ssh-keys"))).json())[0]).toMatchObject({ name: k.name, publicKey: k.publicKey, fingerprint: k.fingerprint })
    },
  )
  it("id tak ada → 404; tanpa application/json → 415; Origin lintas → 403; JSON rusak → 400", async () => {
    const k = await keyId()
    expect((await patch("key-tidak-ada", { name: "a" })).status).toBe(404)
    expect((await patch(k.id, { name: "a" }, {})).status).toBe(415)
    expect((await patch(k.id, { name: "a" }, { "content-type": "text/plain" })).status).toBe(415)
    expect((await patch(k.id, { name: "a" }, { "content-type": "application/json", origin: "http://evil.example" })).status).toBe(403)
    const bad = await keyPATCH(new Request(`http://localhost/api/ssh-keys/${k.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{" }), p({ id: k.id }))
    expect(bad.status).toBe(400)
    expect((await (await keysGET(getReq("/api/ssh-keys"))).json())[0].name).toBe(k.name)
  })
  it("usedBy ssh-keys & os-images benar (0/1/2 host); hapus key/image terpakai → 409, tidak terpakai → terhapus", async () => {
    const k = await keyId()
    expect(k.usedBy).toBe(1)
    await ready(1, [k.id])
    const created = await keysPOST(jsonReq("/api/ssh-keys", "POST", { name: "lain", publicKey: SSH_ED25519_B.publicKey }))
    const other = await created.json()
    const keys = await (await keysGET(getReq("/api/ssh-keys"))).json()
    expect(Object.fromEntries(keys.map((x: { id: string; usedBy: number }) => [x.id, x.usedBy]))).toEqual({ [k.id]: 2, [other.id]: 0 })
    const imgs = await (await imagesGET(getReq("/api/os-images"))).json()
    const used = Object.fromEntries(imgs.map((i: { id: string; usedBy: number }) => [i.id, i.usedBy]))
    expect(used["ubuntu-24.04"]).toBe(2)
    expect(used["debian-12"]).toBe(0)
    const del = await keyDELETE(new Request(`http://localhost/api/ssh-keys/${k.id}`, { method: "DELETE" }), p({ id: k.id }))
    expect(del.status).toBe(409)
    expect(JSON.stringify(await del.json())).toMatch(/2 host|dipakai/)
    expect((await keyDELETE(new Request(`http://localhost/api/ssh-keys/${other.id}`, { method: "DELETE" }), p({ id: other.id }))).status).toBe(204)
    const imgDel = await imageDELETE(new Request("http://localhost/api/os-images/ubuntu-24.04", { method: "DELETE" }), p({ id: "ubuntu-24.04" }))
    expect(imgDel.status).toBe(409)
  })
})
