// M5-T12 (test-engineer): integration route handler /boot/** + /api/** untuk siklus hidup job M5.
// DB :memory: per test (resetDb), fixture lease, jam injeksi (fake Date). Tanpa seam HTTP (DEC-005).
//   AC-5.2  (route)  tanpa lease & tanpa flag → boot lokal, token/installer_boots tetap
//   AC-5.5  CR-4-9   nama /boot tak terdekode → 400 `MAC tidak valid`, tanpa host baru
//   AC-5.6  CR-4-8   penolakan status/file/log → tepat satu baris log, `mac=-`, tanpa CR/LF/token
//   AC-5.7  CR-4-1   batas installer 3×, installing → lokal tanpa rotasi, callback terlambat sah
//   AC-5.8  watchdog per tahap (batas ± 1 dtk), token dicabut → 404, idempoten, final tak tersentuh
//   AC-5.9  pemicu sapuan: GET /api/hosts, /api/jobs, /api/jobs/:id, /boot/{mac}.ipxe; timer
//   AC-5.10 install ulang setelah failed (timeout, installer-boot-limit, installer-error)
//   AC-5.11 callback/log dengan token job failed → 404 seragam, tanpa event baru
//   AC-5.12 siklus simulasi lengkap → event berurutan, sumber benar, tanpa secret
//   AC-5.13 POST /boot/{mac}/{token}/log (otorisasi, sanitasi, 413/429, cap)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { utimesSync, writeFileSync } from "node:fs"
import path from "node:path"

import { applyConfig } from "@/lib/server/config-service"
import { getDb } from "@/lib/server/db"
import { getHost } from "@/lib/server/db/repos/hosts"
import { eventsAfter } from "@/lib/server/db/repos/job-events"
import { getActiveJob, getJob, listJobsForHost, updateJob } from "@/lib/server/db/repos/jobs"
import { clearLeaseCache } from "@/lib/server/leases"
import { hashToken } from "@/lib/server/tokens"
import { startWatchdog, stopWatchdog, watchdogRunning } from "@/lib/server/watchdog"
import { dbSnapshot, makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD, SSH_ED25519 } from "@/test/fixtures"
import { getReq, jsonReq } from "@/test/route"

import { GET as hostsGET } from "../api/hosts/route"
import { GET as hostGET } from "../api/hosts/[id]/route"
import { POST as installPOST } from "../api/hosts/[id]/install/route"
import { GET as jobsGET } from "../api/jobs/route"
import { GET as jobGET } from "../api/jobs/[id]/route"
import { GET as logsGET } from "../api/jobs/[id]/logs/route"
import { GET as bootGET } from "./[name]/route"
import { GET as fileGET } from "./[name]/[token]/[file]/route"
import { POST as logPOST } from "./[name]/[token]/log/route"
import { POST as statusPOST } from "./[name]/[token]/status/route"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

const MEDIA = makeMediaRoot(tmpDir("m5te-media"))
const LEASE_DIR = tmpDir("m5te-leases")
const ENV = {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_BASE_URL: "http://10.99.0.2",
  PXE_MEDIA_ROOT: MEDIA,
  PXE_TRUST_PROXY: "1",
  PXE_INSECURE_NO_LEASE_CHECK: "1",
}
withDb("empty", ENV)

const MAC = "52:54:00:99:00:11"
const ID = "525400990011"
const MAC2 = "52:54:00:99:00:12"
const ID2 = "525400990012"
const LEASE_IP = "10.99.0.150"
const STATIC_IP = "10.99.0.21"
const T0 = Date.parse("2026-11-05T10:00:00.000Z")
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//
const NOT_FOUND = "not found\n"
const MIN = 60_000

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(T0)
  clearLeaseCache()
})
afterEach(() => {
  stopWatchdog()
  vi.useRealTimers()
})

const p = <T extends object>(v: T) => ({ params: Promise.resolve(v) }) as never
const setNow = (ms: number) => vi.setSystemTime(ms)

function req(url: string, ip?: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (ip) headers.set("x-real-ip", ip)
  return new Request(`http://10.99.0.2${url}`, { ...init, headers })
}
async function boot(mac = MAC, ip: string | null = LEASE_IP, platform = "efi") {
  const res = await bootGET(req(`/boot/${mac}.ipxe?platform=${platform}`, ip), p({ name: `${mac}.ipxe` }))
  return { res, body: await res.text() }
}
async function file(token: string, name: string, ip: string | null = LEASE_IP, mac = MAC) {
  const res = await fileGET(req(`/boot/${mac}/${token}/${name}`, ip), p({ name: mac, token, file: name }))
  return { res, body: await res.text() }
}
async function status(token: string, stage: string, ip: string | null = STATIC_IP, mac = MAC) {
  const res = await statusPOST(
    req(`/boot/${mac}/${token}/status`, ip, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `stage=${stage}` }),
    p({ name: mac, token }),
  )
  return { res, body: await res.text() }
}
async function log(token: string, text: string | Uint8Array, ip: string | null = LEASE_IP, mac = MAC) {
  const res = await logPOST(
    req(`/boot/${mac}/${token}/log`, ip, { method: "POST", headers: { "content-type": "text/plain" }, body: text as BodyInit }),
    p({ name: mac, token }),
  )
  return { res, body: await res.text() }
}
async function apiJson(res: Response) {
  return { status: res.status, body: await res.json() }
}

function writeLeases(lines: string[]) {
  const f = path.join(LEASE_DIR, "dnsmasq.leases")
  writeFileSync(f, lines.join("\n") + "\n")
  const t = Date.now() / 1000 + Math.random() * 1000
  utimesSync(f, t, t)
  process.env.PXE_DNSMASQ_LEASES = f
  clearLeaseCache()
}
const exp = () => Math.floor(Date.now() / 1000) + 3600

async function readyHost(mac = MAC, id = ID, ip = STATIC_IP) {
  await boot(mac)
  const r = await applyConfig([id], {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
    network: { mode: "static", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2"], vlan: null, iface: { by: "mac" }, assignments: { [id]: ip } },
    hostname: { assignments: { [id]: `m5-node${id.slice(-2)}` } },
    ssh: { keyIds: [], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
}
async function install(id = ID) {
  return installPOST(jsonReq(`/api/hosts/${id}/install`, "POST"), p({ id }))
}
/** Siap + install (route) + layani installer → token plaintext. */
async function installAndBoot(mac = MAC, id = ID) {
  await readyHost(mac, id, id === ID ? STATIC_IP : "10.99.0.22")
  expect((await install(id)).status).toBe(200)
  const { body } = await boot(mac)
  const m = TOKEN_RE.exec(body)
  expect(m, body).not.toBeNull()
  return m![1]
}
const job = (id = ID) => listJobsForHost(id)[0]
const events = (jobId: string) => eventsAfter(jobId, 0, 100_000)

// ---------------------------------------------------------------------------
describe("AC-5.2 SR-4-2 (route): tanpa lease & tanpa flag insecure → tidak ada installer", () => {
  it("PXE_TRUST_PROXY=0, tanpa PXE_DNSMASQ_LEASES, flag 0: job booting → script lokal tanpa kernel/token; token_hash & installer_boots tetap", async () => {
    await readyHost()
    expect((await install()).status).toBe(200)
    process.env.PXE_TRUST_PROXY = "0"
    process.env.PXE_INSECURE_NO_LEASE_CHECK = "0"
    delete process.env.PXE_DNSMASQ_LEASES
    const before = getActiveJob(ID)!
    for (let i = 0; i < 4; i++) {
      const { res, body } = await boot(MAC, LEASE_IP)
      expect(res.status).toBe(200)
      expect(body).not.toMatch(/\bkernel\b/)
      expect(body).not.toMatch(TOKEN_RE)
      expect(body).toContain("exit 1")
    }
    const after = getActiveJob(ID)!
    expect(after).toMatchObject({ status: "booting", installerBoots: 0, tokenHash: before.tokenHash, tokenExpiresAt: before.tokenExpiresAt })
    expect(getHost(ID)!.status).toBe("booting")
  })
  it("kontras: flag insecure=1 → installer dilayani (flag yang membuka, bukan default)", async () => {
    await readyHost()
    expect((await install()).status).toBe(200)
    process.env.PXE_TRUST_PROXY = "0"
    process.env.PXE_INSECURE_NO_LEASE_CHECK = "1"
    const { body } = await boot(MAC, null)
    expect(body).toMatch(/\bkernel\b/)
    expect(getActiveJob(ID)!.installerBoots).toBe(1)
  })
  it("dengan lease: IP lease cocok → installer meski flag 0; IP bukan lease → lokal, job tak berubah", async () => {
    await readyHost()
    expect((await install()).status).toBe(200)
    process.env.PXE_INSECURE_NO_LEASE_CHECK = "0"
    writeLeases([`${exp()} ${MAC} ${LEASE_IP} * *`])
    const j0 = getActiveJob(ID)!
    const bad = await boot(MAC, "10.99.0.1")
    expect(bad.body).not.toMatch(/\bkernel\b/)
    expect(getActiveJob(ID)).toMatchObject({ installerBoots: 0, tokenHash: j0.tokenHash })
    const ok = await boot(MAC, LEASE_IP)
    expect(ok.body).toMatch(TOKEN_RE)
    expect(getActiveJob(ID)!.installerBoots).toBe(1)
  })
})

describe("AC-5.5 CR-4-9: nama /boot tak terdekode/invalid → 400, tidak pernah 500", () => {
  it.each([
    ["%25zz.ipxe", "%zz.ipxe"],
    ["%E0%A4%A.ipxe", "%E0%A4%A.ipxe"],
    ["zz:zz.ipxe", "zz:zz.ipxe"],
    [".ipxe", ".ipxe"],
  ])("GET /boot/%s → 400 MAC tidak valid, tanpa host baru", async (urlName, paramName) => {
    const before = dbSnapshot()
    const res = await bootGET(req(`/boot/${urlName}`, LEASE_IP), p({ name: paramName }))
    expect(res.status).toBe(400)
    expect(await res.text()).toBe("MAC tidak valid\n")
    expect(dbSnapshot()).toBe(before)
    expect(getDb().prepare("SELECT count(*) AS n FROM hosts").get()).toEqual({ n: 0 })
  })
  it("parameter mentah ter-encode ganda (%2525zz) juga 400", async () => {
    const res = await bootGET(req(`/boot/%2525zz.ipxe`, LEASE_IP), p({ name: "%25zz.ipxe" }))
    expect(res.status).toBe(400)
  })
})

describe("AC-5.6 CR-4-8/SR-4-4: penolakan → tepat satu baris log, tanpa CR/LF input, tanpa token", () => {
  const INJECT = "52:54:00:99:00:11\n[boot] tolak status mac=ff:ff:ff:ff:ff:ff alasan=palsu\r"
  async function captured(fn: () => Promise<unknown>) {
    const saved = process.env.VITEST
    delete process.env.VITEST
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await fn()
      return warn.mock.calls.map((c) => c.map(String).join(" "))
    } finally {
      warn.mockRestore()
      process.env.VITEST = saved
    }
  }
  it("POST status dengan segmen MAC berisi %0a[boot] tolak … → satu baris `mac=-`", async () => {
    const token = await installAndBoot()
    const lines = await captured(async () => {
      const res = await statusPOST(
        req(`/boot/x/${token}/status`, STATIC_IP, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "stage=done" }),
        p({ name: INJECT, token }),
      )
      expect(res.status).toBe(404)
      expect(await res.text()).toBe(NOT_FOUND)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[boot\] tolak status mac=- alasan=/)
    expect(lines[0]).not.toMatch(/[\r\n]/)
    expect(lines[0]).not.toContain(token)
    expect(lines[0]).not.toContain("ff:ff:ff:ff:ff:ff")
  })
  it("GET file dengan segmen MAC injeksi → satu baris `mac=-`; MAC valid + token salah → MAC ternormalisasi", async () => {
    const token = await installAndBoot()
    const lines = await captured(async () => {
      const r1 = await fileGET(req(`/boot/x/${token}/user-data`, LEASE_IP), p({ name: INJECT, token, file: "user-data" }))
      expect(r1.status).toBe(404)
      const wrong = "B".repeat(43)
      const r2 = await fileGET(req(`/boot/x/${wrong}/user-data`, LEASE_IP), p({ name: "52-54-00-99-00-11", token: wrong, file: "user-data" }))
      expect(r2.status).toBe(404)
    })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\[boot\] tolak file mac=- alasan=/)
    expect(lines[1]).toMatch(/^\[boot\] tolak file mac=52:54:00:99:00:11 alasan=/)
    for (const l of lines) {
      expect(l).not.toMatch(/[\r\n]/)
      expect(l).not.toContain(token)
      expect(l).not.toContain("B".repeat(43))
    }
  })
  it("POST log ditolak → satu baris `tolak log`, tanpa token", async () => {
    const token = await installAndBoot()
    const lines = await captured(async () => {
      expect((await log(token, "x\n", LEASE_IP, MAC2)).res.status).toBe(404)
    })
    expect(lines).toEqual([expect.stringMatching(/^\[boot\] tolak log mac=52:54:00:99:00:12 alasan=\S+$/)])
    expect(lines[0]).not.toContain(token)
  })
})

describe("AC-5.7 CR-4-1 batas penyajian installer (route)", () => {
  it("booting: permintaan 1..3 → installer token baru (hash berganti, installer_boots 1..3, event per penyajian); ke-4 → lokal, failed installer-boot-limit, token dicabut", async () => {
    await readyHost()
    expect((await install()).status).toBe(200)
    const hashes: string[] = []
    const tokens: string[] = []
    for (let k = 1; k <= 3; k++) {
      setNow(T0 + k * 1000)
      const { body } = await boot()
      const m = TOKEN_RE.exec(body)
      expect(m, `boot ke-${k}`).not.toBeNull()
      tokens.push(m![1])
      const j = getActiveJob(ID)!
      expect(j.installerBoots).toBe(k)
      expect(j.tokenHash).toBe(hashToken(m![1]))
      hashes.push(j.tokenHash!)
    }
    expect(new Set(hashes).size).toBe(3)
    const served = events(job().id).filter((e) => e.source === "boot-script" && e.message.startsWith("Script installer dilayani"))
    expect(served.map((e) => e.message.match(/ke-(\d)\/3/)![1])).toEqual(["1", "2", "3"])
    // Token lama (ke-1, ke-2) tidak berlaku lagi.
    expect((await file(tokens[0], "user-data")).res.status).toBe(404)
    setNow(T0 + 4000)
    const { body: b4 } = await boot()
    expect(b4).not.toMatch(/\bkernel\b/)
    expect(b4).not.toMatch(TOKEN_RE)
    const j = job()
    expect(j).toMatchObject({ status: "failed", failureReason: "installer-boot-limit", tokenHash: null, tokenExpiresAt: null, installerBoots: 3 })
    expect(getHost(ID)!.status).toBe("failed")
    expect(events(j.id).at(-1)).toMatchObject({ level: "error", kind: "stage" })
    expect((await file(tokens[2], "user-data")).res.status).toBe(404)
  })
  it("PXE_JOB_MAX_INSTALLER_BOOTS=1 → permintaan ke-2 sudah lokal + failed", async () => {
    process.env.PXE_JOB_MAX_INSTALLER_BOOTS = "1"
    await readyHost()
    expect((await install()).status).toBe(200)
    expect((await boot()).body).toMatch(TOKEN_RE)
    expect((await boot()).body).not.toMatch(TOKEN_RE)
    expect(job()).toMatchObject({ status: "failed", failureReason: "installer-boot-limit", installerBoots: 1 })
  })
  it("installing → lokal; token_hash/expires/installer_boots tetap; satu event warn digabung (repeat); callback done sah → 200, host done", async () => {
    const token = await installAndBoot()
    setNow(T0 + 10_000)
    expect((await file(token, "user-data")).res.status).toBe(200)
    const before = getActiveJob(ID)!
    expect(before.status).toBe("installing")
    const n0 = before.eventSeq
    for (let i = 1; i <= 3; i++) {
      setNow(T0 + 10_000 + i * 5_000)
      const { body } = await boot()
      expect(body).not.toMatch(/\bkernel\b/)
      expect(body).not.toMatch(TOKEN_RE)
    }
    const after = getActiveJob(ID)!
    expect(after).toMatchObject({ tokenHash: before.tokenHash, tokenExpiresAt: before.tokenExpiresAt, installerBoots: 1, status: "installing" })
    const warns = events(after.id).filter((e) => e.level === "warn" && e.source === "boot-script")
    expect(warns).toHaveLength(1)
    expect(warns[0].repeat).toBe(3)
    expect(after.eventSeq).toBe(n0 + 1)
    // Lewat 60 dtk dari event terakhir → event baru (bukan gabungan).
    setNow(T0 + 10_000 + 15_000 + 61_000)
    await boot()
    expect(events(after.id).filter((e) => e.level === "warn" && e.source === "boot-script")).toHaveLength(2)
    // Callback terlambat yang sah tetap diterima.
    const { res } = await status(token, "done")
    expect(res.status).toBe(200)
    expect(getHost(ID)!.status).toBe("done")
    expect(job().status).toBe("done")
  })
  it("configuring → lokal tanpa event warn baru dan tanpa rotasi", async () => {
    const token = await installAndBoot()
    await file(token, "user-data")
    expect((await status(token, "configuring")).res.status).toBe(200)
    const j0 = getActiveJob(ID)!
    const { body } = await boot()
    expect(body).not.toMatch(/\bkernel\b/)
    expect(getActiveJob(ID)).toMatchObject({ tokenHash: j0.tokenHash, installerBoots: 1, eventSeq: j0.eventSeq })
  })
})

describe("AC-5.8 watchdog per tahap (jam injeksi, timeout 60/120/60)", () => {
  async function toStage(stage: "booting" | "installing" | "configuring") {
    const token = await installAndBoot()
    if (stage !== "booting") expect((await file(token, "user-data")).res.status).toBe(200)
    if (stage === "configuring") expect((await status(token, "configuring")).res.status).toBe(200)
    const j = getActiveJob(ID)!
    expect(j.status).toBe(stage)
    const entered = Date.parse(j.stages.filter((s) => s.stage === stage).at(-1)!.at)
    return { token, j, entered }
  }
  it.each([
    ["booting", 60],
    ["installing", 120],
    ["configuring", 60],
  ] as const)("%s: batas − 1 dtk → tetap; + 1 dtk → failed timeout-%s, stage watchdog, finished_at, token dicabut (file/status 404), satu event error; sapuan kedua no-op", async (stage, min) => {
    const { token, j, entered } = await toStage(stage)
    setNow(entered + min * MIN - 1000)
    await apiJson(await hostsGET(getReq("/api/hosts")))
    expect(getJob(j.id)!.status).toBe(stage)
    const seqBefore = getJob(j.id)!.eventSeq
    setNow(entered + min * MIN + 1000)
    await apiJson(await hostsGET(getReq("/api/hosts")))
    const f = getJob(j.id)!
    expect(f).toMatchObject({ status: "failed", failureReason: `timeout-${stage}`, tokenHash: null, tokenExpiresAt: null })
    expect(f.finishedAt).toBe(new Date(entered + min * MIN + 1000).toISOString())
    expect(f.stages.at(-1)).toEqual({ stage: "failed", at: f.finishedAt, source: "watchdog" })
    expect(getHost(ID)!.status).toBe("failed")
    const newEv = eventsAfter(j.id, seqBefore, 100)
    expect(newEv).toHaveLength(1)
    expect(newEv[0]).toMatchObject({ level: "error", source: "watchdog", message: `Timeout di tahap ${stage[0].toUpperCase()}${stage.slice(1)} (> ${min} mnt)` })
    expect((await file(token, "meta-data")).res.status).toBe(404)
    expect((await status(token, "done")).res.status).toBe(404)
    const snap = dbSnapshot()
    setNow(entered + min * MIN + 60_000)
    await hostsGET(getReq("/api/hosts"))
    await jobsGET(getReq("/api/jobs"))
    expect(dbSnapshot()).toBe(snap)
  })
  it("job done dan failed tidak tersentuh sapuan berapa pun lamanya", async () => {
    const token = await installAndBoot()
    await file(token, "user-data")
    await status(token, "configuring")
    await status(token, "done")
    const done = job()
    expect(done.status).toBe("done")
    await installAndBoot(MAC2, ID2)
    await boot(MAC2)
    await boot(MAC2)
    await boot(MAC2) // ke-4 → failed installer-boot-limit
    const failed = job(ID2)
    expect(failed).toMatchObject({ status: "failed", failureReason: "installer-boot-limit" })
    const snap = dbSnapshot()
    setNow(T0 + 30 * 24 * 60 * MIN)
    await hostsGET(getReq("/api/hosts"))
    expect(dbSnapshot()).toBe(snap)
  })
})

describe("AC-5.9 pemicu sapuan", () => {
  async function overdue() {
    await installAndBoot()
    const j = getActiveJob(ID)!
    setNow(Date.parse(j.stages.at(-1)!.at) + 61 * MIN)
    return j
  }
  it("GET /api/hosts → host failed + lastJob failed timeout-booting", async () => {
    const j = await overdue()
    const { body } = await apiJson(await hostsGET(getReq("/api/hosts")))
    const h = body.hosts.find((x: { id: string }) => x.id === ID)
    expect(h.status).toBe("failed")
    expect(h.lastJob).toMatchObject({ id: j.id, status: "failed", failureReason: "timeout-booting" })
  })
  it("GET /api/hosts/:id → failed", async () => {
    await overdue()
    const { body } = await apiJson(await hostGET(getReq(`/api/hosts/${ID}`), p({ id: ID })))
    expect(body.status).toBe("failed")
  })
  it("GET /api/jobs → job failed", async () => {
    const j = await overdue()
    const { body } = await apiJson(await jobsGET(getReq("/api/jobs")))
    expect(body.jobs.find((x: { id: string }) => x.id === j.id)).toMatchObject({ status: "failed", failureReason: "timeout-booting" })
  })
  it("GET /api/jobs/:id → job failed", async () => {
    const j = await overdue()
    const { body } = await apiJson(await jobGET(getReq(`/api/jobs/${j.id}`), p({ id: j.id })))
    expect(body).toMatchObject({ status: "failed", failureReason: "timeout-booting" })
  })
  it("GET /api/jobs/:id/logs (JSON) → final + event error", async () => {
    const j = await overdue()
    const { body } = await apiJson(await logsGET(getReq(`/api/jobs/${j.id}/logs?format=json`), p({ id: j.id })))
    expect(body.final).toBe(true)
    expect(body.events.at(-1)).toMatchObject({ level: "error", source: "watchdog" })
  })
  it("GET /boot/{mac}.ipxe host itu → script lokal + job failed (tanpa installer baru)", async () => {
    const j = await overdue()
    const { body } = await boot()
    expect(body).not.toMatch(/\bkernel\b/)
    expect(getJob(j.id)).toMatchObject({ status: "failed", failureReason: "timeout-booting", installerBoots: 1 })
  })
  it("startWatchdog (fake timers): sapuan tiap PXE_WATCHDOG_INTERVAL_SEC; dua panggilan = satu timer; stopWatchdog membersihkan", async () => {
    process.env.PXE_WATCHDOG_INTERVAL_SEC = "15"
    const token = await installAndBoot()
    expect(token).toHaveLength(43)
    const j = getActiveJob(ID)!
    vi.useRealTimers()
    vi.useFakeTimers({ now: Date.parse(j.stages.at(-1)!.at) + 60 * MIN - 20_000 })
    expect(startWatchdog()).toBe(15)
    expect(startWatchdog()).toBe(15)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(15_000) // +60 mnt − 5 dtk → belum lewat
    expect(getJob(j.id)!.status).toBe("booting")
    vi.advanceTimersByTime(15_000) // +60 mnt + 10 dtk → failed
    expect(getJob(j.id)).toMatchObject({ status: "failed", failureReason: "timeout-booting" })
    stopWatchdog()
    expect(watchdogRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("AC-5.10 install ulang setelah failed", () => {
  async function failWith(reason: "timeout" | "installer-boot-limit" | "installer-error") {
    const token = await installAndBoot()
    if (reason === "timeout") {
      setNow(T0 + 61 * MIN)
      await hostsGET(getReq("/api/hosts"))
    } else if (reason === "installer-boot-limit") {
      await boot()
      await boot()
      await boot()
    } else {
      await file(token, "user-data")
      expect((await status(token, "failed")).res.status).toBe(200)
    }
    const old = job()
    expect(old.status).toBe("failed")
    return { token, old }
  }
  it.each([
    ["timeout", "timeout-booting"],
    ["installer-boot-limit", "installer-boot-limit"],
    ["installer-error", "installer-error"],
  ] as const)("alasan %s → POST install 200, job baru booting installer_boots 0; job lama tetap; GET /api/jobs?hostId = 2; token lama 404; installer untuk job baru", async (reason, failureReason) => {
    const { token, old } = await failWith(reason)
    expect(old.failureReason).toBe(failureReason)
    expect(getHost(ID)!.status).toBe("failed")
    setNow(Date.now() + 1000) // job baru dibuat setelah job lama (urutan created_at)
    const res = await install()
    expect(res.status).toBe(200)
    const fresh = getActiveJob(ID)!
    expect(fresh.id).not.toBe(old.id)
    expect(fresh).toMatchObject({ status: "booting", installerBoots: 0, failureReason: null })
    expect(getJob(old.id)).toMatchObject({ status: "failed", failureReason })
    const { body } = await apiJson(await jobsGET(getReq(`/api/jobs?hostId=${ID}`)))
    expect(body.jobs.map((j: { id: string; status: string }) => [j.id, j.status])).toEqual([
      [fresh.id, "booting"],
      [old.id, "failed"],
    ])
    expect((await file(token, "user-data")).res.status).toBe(404)
    expect((await status(token, "done")).res.status).toBe(404)
    const { body: script } = await boot()
    const t2 = TOKEN_RE.exec(script)![1]
    expect(t2).not.toBe(token)
    expect(getActiveJob(ID)).toMatchObject({ id: fresh.id, installerBoots: 1, tokenHash: hashToken(t2) })
  })
  it("host aktif (booting) → install ditolak 422 'sedang berjalan' (perilaku M4), tanpa job baru", async () => {
    await installAndBoot()
    const before = listJobsForHost(ID).length
    const res = await install()
    expect(res.status).toBe(422)
    expect(JSON.stringify(await res.json())).toMatch(/sedang berjalan/)
    expect(listJobsForHost(ID)).toHaveLength(before)
  })
})

describe("AC-5.11 token job failed (watchdog) → 404 seragam, tanpa event baru", () => {
  it("status (done/configuring) dan log dengan token job yang di-timeout → 404 `not found`; host tetap failed; eventSeq tetap", async () => {
    const token = await installAndBoot()
    await file(token, "user-data")
    const j = getActiveJob(ID)!
    setNow(Date.parse(j.stages.at(-1)!.at) + 121 * MIN)
    await hostsGET(getReq("/api/hosts"))
    const f = getJob(j.id)!
    expect(f).toMatchObject({ status: "failed", failureReason: "timeout-installing" })
    const seq = f.eventSeq
    for (const r of [await status(token, "done"), await status(token, "configuring"), await log(token, "installer: halo\n")]) {
      expect(r.res.status).toBe(404)
      expect(r.body).toBe(NOT_FOUND)
    }
    expect(getHost(ID)!.status).toBe("failed")
    expect(getJob(j.id)!.eventSeq).toBe(seq)
  })
})

describe("AC-5.12 siklus simulasi lengkap → event berurutan, sumber benar, tanpa secret", () => {
  it("install → boot → meta-data, user-data → configuring → done", async () => {
    const token = await installAndBoot()
    setNow(T0 + 5_000)
    expect((await file(token, "meta-data")).res.status).toBe(200)
    const ud = await file(token, "user-data")
    expect(ud.res.status).toBe(200)
    expect(ud.body).toContain("$6$") // payload memang memuat hash — event TIDAK boleh
    setNow(T0 + 60_000)
    expect((await log(token, "installer: autoinstall mulai\n")).res.status).toBe(200)
    expect((await status(token, "configuring")).res.status).toBe(200)
    setNow(T0 + 120_000)
    expect((await status(token, "done")).res.status).toBe(200)
    const j = job()
    expect(j.status).toBe("done")
    const ev = events(j.id)
    expect(ev.map((e) => e.seq)).toEqual(ev.map((_, i) => i + 1))
    expect(j.eventSeq).toBe(ev.length)
    const sig = ev.map((e) => `${e.kind}/${e.source}`)
    expect(sig[0]).toBe("stage/install")
    expect(sig).toContain("system/boot-script")
    expect(sig).toContain("system/config-fetch")
    expect(sig).toContain("stage/config-fetch") // → installing
    expect(sig).toContain("installer/installer")
    expect(sig.filter((s) => s === "stage/callback")).toHaveLength(2) // configuring, done
    expect(ev.find((e) => e.source === "boot-script")!.message).toContain(LEASE_IP)
    expect(ev.filter((e) => e.source === "config-fetch" && e.kind === "system").every((e) => e.message.includes(LEASE_IP))).toBe(true)
    expect(ev.filter((e) => e.source === "callback").every((e) => e.message.includes(STATIC_IP))).toBe(true)
    // Urutan tahap: installing sebelum configuring sebelum done.
    const idx = (re: RegExp) => ev.findIndex((e) => e.kind === "stage" && re.test(e.message))
    expect(idx(/^Installing/)).toBeLessThan(idx(/^Configuring/))
    expect(idx(/^Configuring/)).toBeLessThan(idx(/^Done/))
    // Tanpa secret di DB event.
    const rows = getDb().prepare("SELECT message FROM job_events").all() as { message: string }[]
    const hash = getDb().prepare("SELECT token_hash FROM jobs").all() as { token_hash: string | null }[]
    for (const r of rows) {
      expect(r.message).not.toContain(token)
      expect(r.message).not.toContain("$6$")
      for (const h of hash) if (h.token_hash) expect(r.message).not.toContain(h.token_hash)
      expect(r.message).not.toContain(hashToken(token))
    }
  })
})

describe("AC-5.13 POST /boot/{mac}/{token}/log", () => {
  it("3 baris → 3 event installer urut; CR & kontrol dibuang, tab dipertahankan; baris kosong diabaikan; ERROR → error", async () => {
    const token = await installAndBoot()
    const n0 = job().eventSeq
    const { res, body } = await log(token, "satu\r\n\n  \ndua\x07\x1b[31m merah\tkolom\nERROR gagal x\n")
    expect(res.status).toBe(200)
    expect(body).toBe("ok\n")
    const ev = eventsAfter(job().id, n0, 100)
    expect(ev.map((e) => [e.kind, e.level, e.source, e.message])).toEqual([
      ["installer", "info", "installer", "satu"],
      ["installer", "info", "installer", "dua[31m merah\tkolom"],
      ["installer", "error", "installer", "ERROR gagal x"],
    ])
    expect(ev.map((e) => e.seq)).toEqual([n0 + 1, n0 + 2, n0 + 3])
  })
  it("baris > 2048 → dipotong + penanda", async () => {
    const token = await installAndBoot()
    const n0 = job().eventSeq
    expect((await log(token, `${"x".repeat(3000)}\n`)).res.status).toBe(200)
    const [e] = eventsAfter(job().id, n0, 10)
    expect(e.message.length).toBeLessThanOrEqual(2048 + "…[dipotong]".length)
    expect(e.message.endsWith("…[dipotong]")).toBe(true)
    expect(e.message.startsWith("x".repeat(2000))).toBe(true)
  })
  it("otorisasi = callback status: token salah, MAC lain, IP asing, job final, expired → 404 body identik; IP statis/mgmt diterima", async () => {
    const token = await installAndBoot()
    await readyHost(MAC2, ID2, "10.99.0.22")
    const n0 = job().eventSeq
    const denied = [
      await log("C".repeat(43), "x\n"),
      await log(token, "x\n", LEASE_IP, MAC2),
      await log(token, "x\n", "10.99.0.77"),
      await log(token, "x\n", null),
      await log(token.slice(0, 42), "x\n"),
    ]
    for (const d of denied) {
      expect(d.res.status).toBe(404)
      expect(d.body).toBe(NOT_FOUND)
    }
    expect(job().eventSeq).toBe(n0)
    expect((await log(token, "dari statis\n", STATIC_IP)).res.status).toBe(200)
    // expired (fixture DB: token_expires_at di masa lalu, job masih aktif)
    updateJob(job().id, { tokenExpiresAt: new Date(T0 - 1000).toISOString() }, new Date().toISOString())
    const ex = await log(token, "x\n")
    expect(ex.res.status).toBe(404)
    expect(ex.body).toBe(NOT_FOUND)
  })
  it("job final (done) → 404 identik", async () => {
    const token = await installAndBoot()
    await file(token, "user-data")
    await status(token, "configuring")
    await status(token, "done")
    const n = job().eventSeq
    const r = await log(token, "terlambat\n", STATIC_IP)
    expect(r.res.status).toBe(404)
    expect(r.body).toBe(NOT_FOUND)
    expect(job().eventSeq).toBe(n)
  })
  it("> 16 KB → 413 tanpa event, juga dengan token salah (sebelum otorisasi)", async () => {
    const token = await installAndBoot()
    const n0 = job().eventSeq
    const big = "a".repeat(16 * 1024 + 1)
    expect((await log(token, big)).res.status).toBe(413)
    expect((await log("D".repeat(43), big)).res.status).toBe(413)
    expect((await log(token, big, "10.99.0.77", MAC2)).res.status).toBe(413)
    expect(job().eventSeq).toBe(n0)
    expect((await log(token, "a".repeat(16 * 1024 - 1))).res.status).toBe(200)
  })
  it("> 200 baris → 413 tanpa event; 200 baris → 200", async () => {
    const token = await installAndBoot()
    const n0 = job().eventSeq
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `b${i}`).join("\n") + "\n"
    expect((await log(token, lines(201))).res.status).toBe(413)
    expect(job().eventSeq).toBe(n0)
    expect((await log(token, lines(200))).res.status).toBe(200)
    expect(job().eventSeq).toBe(n0 + 200)
  })
  it("> 60 request/menit per job → 429; menit berikutnya diterima lagi", async () => {
    const token = await installAndBoot()
    for (let i = 0; i < 60; i++) expect((await log(token, `r${i}\n`)).res.status, `req ${i}`).toBe(200)
    const n = job().eventSeq
    const r = await log(token, "kelebihan\n")
    expect(r.res.status).toBe(429)
    expect(job().eventSeq).toBe(n)
    setNow(T0 + 61_000)
    expect((await log(token, "lagi\n")).res.status).toBe(200)
  })
  it("cap PXE_JOB_LOG_MAX_EVENTS: satu warn 'log dipotong', installer berikutnya dibuang, event stage tetap", async () => {
    process.env.PXE_JOB_LOG_MAX_EVENTS = "100"
    const token = await installAndBoot()
    const lines = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`).join("\n") + "\n"
    expect((await log(token, lines(150, "a"))).res.status).toBe(200)
    expect((await log(token, lines(10, "b"))).res.status).toBe(200)
    await file(token, "user-data")
    expect((await status(token, "configuring")).res.status).toBe(200)
    const ev = events(job().id)
    const warn = ev.filter((e) => e.level === "warn" && /dipotong/.test(e.message))
    expect(warn).toHaveLength(1)
    expect(ev.filter((e) => e.kind === "installer").length).toBeLessThan(100)
    expect(ev.some((e) => e.message === "b0")).toBe(false)
    expect(ev.filter((e) => e.kind === "stage").map((e) => e.message.split(":")[0].split(" ")[0])).toEqual(
      expect.arrayContaining(["Installing", "Configuring"]),
    )
    expect(ev.at(-1)!.kind).toBe("stage")
  })
})

// test-migration #9: test AC-4.23 "token expired" kini ditolak karena watchdog mencabut token lebih
// dulu (DEC-014 §2). Cabang `token_expires_at` itu sendiri tetap diuji di sini dengan fixture DB
// (job masih aktif, masa berlaku token lewat) agar penolakan karena kedaluwarsa tidak kehilangan test.
describe("Token kedaluwarsa pada job yang masih aktif (cabang expiry, pengganti asersi #9)", () => {
  it("file, status, dan log → 404 identik; job & host tidak berubah", async () => {
    const token = await installAndBoot()
    expect((await file(token, "meta-data")).res.status).toBe(200)
    const j = getActiveJob(ID)!
    updateJob(j.id, { tokenExpiresAt: new Date(T0 - 1).toISOString() }, new Date().toISOString())
    const snap = getJob(j.id)!
    for (const r of [await file(token, "user-data"), await status(token, "configuring"), await log(token, "x\n")]) {
      expect(r.res.status).toBe(404)
      expect(r.body).toBe(NOT_FOUND)
    }
    expect(getJob(j.id)).toEqual(snap)
    expect(getHost(ID)!.status).toBe("booting")
  })
})
