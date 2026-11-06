// M6-T11 (test-engineer) — integration route handler /boot/** (tanpa sesi):
//   AC-6.7  /boot/** (ipxe, file, status, log) tetap bekerja tanpa cookie (dan cookie sampah diabaikan)
//   AC-6.12 SR-5-3: 100 penolakan POST /boot/<x>/<y>/log lewat ROUTE → 20 baris detail + tepat 1
//           ringkasan `[boot] 80 penolakan log ditekan dalam 60 dtk`; jalur file kuota sendiri; tiap
//           baris satu baris, ter-escape, tanpa token (regresi AC-5.6)
//   AC-6.22 CR-5-7: event identik tiap 30 dtk selama 5 menit → 1 event repeat=11, lastAt = kemunculan
//           terakhir (repo + GET /api/jobs/:id/logs); jeda > 60 dtk dari lastAt → event baru
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyConfig } from "@/lib/server/config-service"
import { BOOT_LOG_WINDOW_MS, resetBootLogThrottle } from "@/lib/server/boot-http"
import { appendEvent } from "@/lib/server/db/repos/job-events"
import { getActiveJob } from "@/lib/server/db/repos/jobs"
import { installHosts } from "@/lib/server/install-service"
import { clearLeaseCache } from "@/lib/server/leases"
import { resetLogRate } from "@/lib/server/provisioning"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD } from "@/test/fixtures"
import { getReq } from "@/test/route"

import { GET as logsGET } from "../api/jobs/[id]/logs/route"
import { GET as bootGET } from "./[name]/route"
import { GET as fileGET } from "./[name]/[token]/[file]/route"
import { POST as logPOST } from "./[name]/[token]/log/route"
import { POST as statusPOST } from "./[name]/[token]/status/route"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

const MEDIA = makeMediaRoot(tmpDir("m6te-boot-media"))
withDb("empty", {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_BASE_URL: "http://10.99.0.2",
  PXE_MEDIA_ROOT: MEDIA,
  PXE_TRUST_PROXY: "1",
  PXE_INSECURE_NO_LEASE_CHECK: "1",
  // Logging /boot aktif di test throttle (VITEST di-stub kosong) → DB tetap :memory: yang sama.
  PXE_DB_PATH: ":memory:",
})

const MAC = "52:54:00:99:00:61"
const ID = "525400990061"
const IP = "10.99.0.161"
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//
const p = <T extends object>(v: T) => ({ params: Promise.resolve(v) }) as never

beforeEach(() => {
  clearLeaseCache()
  resetLogRate()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetBootLogThrottle()
})

function req(url: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-real-ip", IP)
  if (init.cookie) headers.set("cookie", init.cookie)
  return new Request(`http://10.99.0.2${url}`, { ...init, headers })
}

async function installed(): Promise<string> {
  await bootGET(req(`/boot/${MAC}.ipxe?platform=efi`), p({ name: `${MAC}.ipxe` }))
  const r = await applyConfig([ID], {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  installHosts([ID])
  const res = await bootGET(req(`/boot/${MAC}.ipxe?platform=efi`), p({ name: `${MAC}.ipxe` }))
  return TOKEN_RE.exec(await res.text())![1]
}

describe("AC-6.7 /boot/** tanpa sesi (token per-MAC, DEC-008/013)", () => {
  it.each([
    ["tanpa cookie", undefined],
    ["cookie sesi sampah", `pxe_session=${"A".repeat(43)}`],
  ])("%s: ipxe, file, status, log → 200", async (_n, cookie) => {
    await installed()
    // ipxe tanpa sesi → 200 + script ber-token baru (token sebelumnya diganti).
    const ipxe = await bootGET(req(`/boot/${MAC}.ipxe?platform=efi`, { cookie }), p({ name: `${MAC}.ipxe` }))
    expect(ipxe.status).toBe(200)
    const token = TOKEN_RE.exec(await ipxe.text())![1]
    const file = await fileGET(req(`/boot/${MAC}/${token}/user-data`, { cookie }), p({ name: MAC, token, file: "user-data" }))
    expect(file.status).toBe(200)
    const st = await statusPOST(
      req(`/boot/${MAC}/${token}/status`, { cookie, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "stage=installing" }),
      p({ name: MAC, token }),
    )
    expect(st.status).toBe(200)
    const lg = await logPOST(
      req(`/boot/${MAC}/${token}/log`, { cookie, method: "POST", headers: { "content-type": "text/plain" }, body: "installer: mulai\n" }),
      p({ name: MAC, token }),
    )
    expect(lg.status).toBe(200)
    expect(getActiveJob(ID)!.status).toBe("installing")
  })
})

describe("AC-6.12 SR-5-3 throttle log penolakan lewat route", () => {
  it("100 POST log ditolak dalam 60 dtk → 20 detail + 1 ringkasan; file kuota sendiri; satu baris, ter-escape, tanpa token", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.stubEnv("VITEST", "") // logBootDenied aktif seperti di server
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    resetBootLogThrottle()
    const token = "Q".repeat(43)
    for (let i = 0; i < 100; i++) {
      const name = i % 2 ? "zz" : `52:54:00:99:00:7${i % 10}\n${token}`
      const res = await logPOST(
        req(`/boot/x/${token}/log`, { method: "POST", headers: { "content-type": "text/plain" }, body: "a\n" }),
        p({ name, token }),
      )
      expect(res.status).toBe(404)
    }
    for (let i = 0; i < 5; i++) {
      const res = await fileGET(req(`/boot/zz/${token}/user-data`), p({ name: "zz", token, file: "user-data" }))
      expect(res.status).toBe(404)
    }
    const lines = () => warn.mock.calls.map((c) => String(c[0]))
    expect(lines().filter((l) => l.startsWith("[boot] tolak log "))).toHaveLength(20)
    expect(lines().filter((l) => l.startsWith("[boot] tolak file "))).toHaveLength(5)
    expect(lines().filter((l) => l.includes("ditekan"))).toEqual([])
    await vi.advanceTimersByTimeAsync(BOOT_LOG_WINDOW_MS)
    const summaries = lines().filter((l) => l.includes("ditekan"))
    expect(summaries).toEqual(["[boot] 80 penolakan log ditekan dalam 60 dtk"])
    for (const l of lines()) {
      expect(l).not.toMatch(/[\r\n]/)
      expect(l).not.toContain(token)
    }
    expect(lines().some((l) => l.includes("\\u000a"))).toBe(false) // MAC tidak valid → "-" (bukan input mentah)
  })
})

describe("AC-6.22 CR-5-7 jendela gabung dari kemunculan terakhir", () => {
  it("event identik tiap 30 dtk selama 5 mnt → 1 event repeat=11, lastAt terakhir; jeda > 60 dtk → event baru", async () => {
    await installed()
    const job = getActiveJob(ID)!
    const t0 = Date.parse("2026-11-06T08:00:00.000Z")
    const at = (s: number) => new Date(t0 + s * 1000).toISOString()
    const ev = (s: number) => appendEvent(job.id, { at: at(s), kind: "system", level: "warn", source: "boot-script", message: "PXE boot ulang" }, 5000)
    for (let s = 0; s <= 300; s += 30) ev(s)
    const fetchEvents = async () => {
      const res = await logsGET(getReq(`/api/jobs/${job.id}/logs?format=json&after=0`), p({ id: job.id }))
      expect(res.status).toBe(200)
      return ((await res.json()) as { events: { seq: number; message: string; repeat: number; at: string; lastAt: string }[] }).events.filter(
        (e) => e.message === "PXE boot ulang",
      )
    }
    let merged = await fetchEvents()
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ repeat: 11, at: at(0), lastAt: at(300) })
    // Tepat 60 dtk dari lastAt masih digabung; > 60 dtk dari lastAt → event baru.
    ev(360)
    merged = await fetchEvents()
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ repeat: 12, lastAt: at(360) })
    ev(421)
    merged = await fetchEvents()
    expect(merged).toHaveLength(2)
    expect(merged[1]).toMatchObject({ repeat: 1, at: at(421), lastAt: at(421) })
    expect(merged[1].seq).toBeGreaterThan(merged[0].seq)
  })
})
