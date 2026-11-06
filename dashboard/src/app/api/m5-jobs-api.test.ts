// M5-T6 (backend-dev, dasar): GET /api/jobs, /:id, /:id/logs (JSON + SSE), lastJob di hosts,
// PATCH /api/ssh-keys/:id, usedBy. Test menyeluruh AC-5.16–5.18 = M5-T12 (test-engineer).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyConfig } from "@/lib/server/config-service"
import { appendEvent } from "@/lib/server/db/repos/job-events"
import { getActiveJob, listJobsForHost } from "@/lib/server/db/repos/jobs"
import { decideBoot } from "@/lib/server/discovery"
import { installHosts } from "@/lib/server/install-service"
import { handleStatusCallback } from "@/lib/server/provisioning"
import { jobLogStream, SSE_MAX_CONNECTIONS, sseConnections } from "@/lib/server/sse"
import { authHeaders } from "@/test/auth"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD, SSH_ED25519, SSH_ED25519_B } from "@/test/fixtures"
import { getReq, jsonReq } from "@/test/route"

import { GET as hostsGET } from "./hosts/route"
import { GET as jobGET } from "./jobs/[id]/route"
import { GET as logsGET } from "./jobs/[id]/logs/route"
import { GET as jobsGET } from "./jobs/route"
import { GET as imagesGET } from "./os-images/route"
import { PATCH as keyPATCH } from "./ssh-keys/[id]/route"
import { GET as keysGET, POST as keysPOST } from "./ssh-keys/route"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

const MEDIA = makeMediaRoot(tmpDir("m5-api-media"))
withDb("empty", {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_MEDIA_ROOT: MEDIA,
  PXE_INSECURE_NO_LEASE_CHECK: "1",
})

const MAC = "52:54:00:99:00:11"
const ID = "525400990011"
const IP = "10.99.0.150"
const p = <T extends object>(v: T) => ({ params: Promise.resolve(v) }) as never

async function installed(): Promise<{ jobId: string; token: string }> {
  decideBoot({ mac: MAC, platform: "efi", ip: IP, wait: 0 })
  const r = await applyConfig([ID], {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
    ssh: { keyIds: [], newKeys: [{ name: "lab", publicKey: SSH_ED25519.publicKey, saveToLibrary: true }], user: "" },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  installHosts([ID])
  const d = decideBoot({ mac: MAC, platform: "efi", ip: IP, wait: 0 })
  return { jobId: getActiveJob(ID)!.id, token: /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//.exec(d.script)![1] }
}

function hasKeyDeep(v: unknown, keys: string[]): boolean {
  if (Array.isArray(v)) return v.some((x) => hasKeyDeep(x, keys))
  if (v && typeof v === "object") return Object.entries(v).some(([k, x]) => keys.includes(k) || hasKeyDeep(x, keys))
  return false
}

describe("GET /api/jobs, /api/jobs/:id, lastJob", () => {
  it("bentuk JobSummary tanpa token; filter; 400; 404; lastJob", async () => {
    const { jobId } = await installed()
    const body = await (await jobsGET(getReq("/api/jobs"))).json()
    expect(body.jobs).toHaveLength(1)
    expect(Object.keys(body.jobs[0]).sort()).toEqual(
      ["id", "hostId", "host", "type", "osImageId", "status", "stages", "failureReason", "installerBoots", "createdAt", "updatedAt", "finishedAt", "eventCount"].sort(),
    )
    expect(body.jobs[0]).toMatchObject({ id: jobId, type: "install", status: "booting", installerBoots: 1, host: { mac: MAC, hostname: null } })
    expect(hasKeyDeep(body, ["token", "tokenHash", "token_hash", "tokenExpiresAt"])).toBe(false)
    expect(body.nextBefore).toBeNull()
    expect((await (await jobsGET(getReq(`/api/jobs?hostId=${ID}&status=booting&limit=1`))).json()).jobs).toHaveLength(1)
    expect((await (await jobsGET(getReq("/api/jobs?status=done"))).json()).jobs).toHaveLength(0)
    for (const q of ["limit=0", "limit=500", "status=xyz", "hostId=zz", "before=tidak-ada", "x=1"]) {
      expect((await jobsGET(getReq(`/api/jobs?${q}`))).status, q).toBe(400)
    }
    expect((await jobGET(getReq(`/api/jobs/${jobId}`), p({ id: jobId }))).status).toBe(200)
    expect((await jobGET(getReq("/api/jobs/x"), p({ id: "a/b" }))).status).toBe(400)
    expect((await jobGET(getReq("/api/jobs/x"), p({ id: "job-none" }))).status).toBe(404)
    const hosts = (await (await hostsGET(getReq("/api/hosts"))).json()).hosts
    expect(hosts[0].lastJob).toMatchObject({ id: jobId, status: "booting", failureReason: null })
    expect((await jobsGET(getReq("/api/jobs", { host: "evil.example" }))).status).toBe(403)
  })
})

describe("GET /api/jobs/:id/logs", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] }))
  afterEach(() => vi.useRealTimers())

  async function readAll(res: Response): Promise<string> {
    const r = res.body!.getReader()
    let out = ""
    for (;;) {
      const { done, value } = await r.read()
      if (done) return out
      out += new TextDecoder().decode(value)
    }
  }

  it("JSON: events setelah after, lastSeq, final", async () => {
    const { jobId } = await installed()
    const j = await (await logsGET(getReq(`/api/jobs/${jobId}/logs?format=json`), p({ id: jobId }))).json()
    expect(j.events.map((e: { seq: number }) => e.seq)).toEqual([1, 2])
    expect(j).toMatchObject({ lastSeq: 2, final: false })
    const j2 = await (await logsGET(getReq(`/api/jobs/${jobId}/logs?after=1`), p({ id: jobId }))).json()
    expect(j2.events.map((e: { seq: number }) => e.seq)).toEqual([2])
    expect((await logsGET(getReq(`/api/jobs/${jobId}/logs?after=-1`), p({ id: jobId }))).status).toBe(400)
    expect((await logsGET(getReq("/api/jobs/x/logs"), p({ id: "job-none" }))).status).toBe(404)
  })

  it("SSE: header, backlog id=seq, event baru, stage, end, Last-Event-ID", async () => {
    const { jobId, token } = await installed()
    const res = await logsGET(getReq(`/api/jobs/${jobId}/logs`, { accept: "text/event-stream", "last-event-id": "1" }), p({ id: jobId }))
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/)
    expect(res.headers.get("cache-control")).toContain("no-cache")
    expect(res.headers.get("x-accel-buffering")).toBe("no")
    const text = readAll(res)
    appendEvent(jobId, { at: new Date().toISOString(), kind: "installer", level: "info", source: "installer", message: "baris live" }, 100)
    handleStatusCallback({ mac: MAC, token, stage: "failed", ip: IP })
    await vi.advanceTimersByTimeAsync(1100)
    const out = await text
    expect(out.startsWith("retry: 3000\n\n")).toBe(true)
    // M6 CR-5-6 (AC-6.21): resume `Last-Event-ID: 1` mengirim ulang event 1 TEPAT SEKALI (repeat
    // terkini) sebagai frame pertama, lalu event > 1 (sebelumnya: event 1 tidak dikirim).
    expect(out.match(/\nid: 1\n/g)).toHaveLength(1)
    expect(out.indexOf("id: 1\n")).toBeLessThan(out.indexOf("id: 2\n"))
    expect(out).toContain("id: 2\n")
    expect(out).toMatch(/event: log\nid: 3\ndata: .*baris live/)
    expect(out).toContain("event: stage\n")
    expect(out.trimEnd().split("\n\n").at(-1)).toMatch(/^event: end\n/)
    expect(sseConnections()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("SSE: abort klien membersihkan timer; batas koneksi → null", async () => {
    const { jobId } = await installed()
    const ac = new AbortController()
    const res = await logsGET(new Request(`http://localhost/api/jobs/${jobId}/logs`, { headers: { accept: "text/event-stream", ...authHeaders() }, signal: ac.signal }), p({ id: jobId }))
    expect(sseConnections()).toBe(1)
    await vi.advanceTimersByTimeAsync(15_100)
    ac.abort()
    expect(sseConnections()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    void res
    const streams = Array.from({ length: SSE_MAX_CONNECTIONS }, () => jobLogStream(jobId, 0, null))
    expect(jobLogStream(jobId, 0, null)).toBeNull()
    for (const s of streams) await s!.cancel()
    expect(sseConnections()).toBe(0)
  })
})

describe("ssh-keys PATCH + usedBy; os-images usedBy", () => {
  it("rename 200; kosong/>64/field lain 400; 404; 415; usedBy", async () => {
    await installed()
    const keys = await (await keysGET(getReq("/api/ssh-keys"))).json()
    expect(keys[0]).toMatchObject({ usedBy: 1 })
    const id = keys[0].id
    const ok = await keyPATCH(jsonReq(`/api/ssh-keys/${id}`, "PATCH", { name: "baru" }), p({ id }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ id, name: "baru", usedBy: 1 })
    for (const b of [{ name: "" }, { name: "x".repeat(65) }, { name: "a", publicKey: "x" }, { name: "a", fingerprint: "x" }]) {
      expect((await keyPATCH(jsonReq(`/api/ssh-keys/${id}`, "PATCH", b), p({ id }))).status, JSON.stringify(b)).toBe(400)
    }
    expect((await keyPATCH(jsonReq("/api/ssh-keys/key-x", "PATCH", { name: "a" }), p({ id: "key-x" }))).status).toBe(404)
    expect((await keyPATCH(new Request(`http://localhost/api/ssh-keys/${id}`, { method: "PATCH", body: "{}" }), p({ id }))).status).toBe(415)
    const created = await keysPOST(jsonReq("/api/ssh-keys", "POST", { name: "x", publicKey: SSH_ED25519_B.publicKey }))
    expect(created.status).toBe(201)
    expect((await created.json()).usedBy).toBe(0)
    const imgs = await (await imagesGET(getReq("/api/os-images"))).json()
    expect(imgs.find((i: { id: string }) => i.id === "ubuntu-24.04")).toMatchObject({ usedBy: 1, repoUrl: "http://10.99.0.2/media/ubuntu-24.04" })
    expect(listJobsForHost(ID)).toHaveLength(1)
  })
})
