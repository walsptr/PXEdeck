// M5-T3 (backend-dev, dasar): CR-4-1 batas installer, installing → lokal tanpa rotasi, DEC-013
// tanpa lease → lokal, watchdog (sweepJobs + timer), install ulang setelah failed. Test menyeluruh
// AC-5.7–5.11 = M5-T12 (test-engineer).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyConfig } from "@/lib/server/config-service"
import { getHost } from "@/lib/server/db/repos/hosts"
import { eventsAfter } from "@/lib/server/db/repos/job-events"
import { getActiveJob, getJob, listJobsForHost } from "@/lib/server/db/repos/jobs"
import { decideBoot, REBOOT_WHILE_INSTALLING } from "@/lib/server/discovery"
import { installHosts } from "@/lib/server/install-service"
import { stageEnteredAt, sweepJobs, timeoutMessage } from "@/lib/server/job-lifecycle"
import { clearLeaseCache } from "@/lib/server/leases"
import { handleStatusCallback, serveConfigFile } from "@/lib/server/provisioning"
import { startWatchdog, stopWatchdog, watchdogRunning, watchdogTick } from "@/lib/server/watchdog"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD } from "@/test/fixtures"

const MEDIA = makeMediaRoot(tmpDir("m5-media"))
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
const T0 = Date.parse("2026-11-05T10:00:00.000Z")
const at = (sec: number) => new Date(T0 + sec * 1000)
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//

beforeEach(() => clearLeaseCache())
afterEach(() => {
  stopWatchdog()
  vi.useRealTimers()
})

async function ready() {
  decideBoot({ mac: MAC, platform: "efi", ip: IP, wait: 0, now: at(0) })
  const r = await applyConfig([ID], {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  expect(installHosts([ID], at(0)).started).toEqual([ID])
}
const boot = (sec: number, ip: string | null = IP) => decideBoot({ mac: MAC, platform: "efi", ip, wait: 0, now: at(sec) })

describe("CR-4-1 batas penyajian installer", () => {
  it("booting: 3× installer (token berganti), ke-4 → lokal + failed installer-boot-limit", async () => {
    await ready()
    const hashes = new Set<string>()
    for (let k = 1; k <= 3; k++) {
      const d = boot(k)
      expect(d.kind).toBe("installer")
      const j = getActiveJob(ID)!
      expect(j.installerBoots).toBe(k)
      hashes.add(j.tokenHash!)
    }
    expect(hashes.size).toBe(3)
    const d4 = boot(4)
    expect(d4.kind).toBe("local")
    expect(d4.script).not.toMatch(/\bkernel\b/)
    const job = listJobsForHost(ID)[0]
    expect(job).toMatchObject({ status: "failed", failureReason: "installer-boot-limit", tokenHash: null, installerBoots: 3 })
    expect(getHost(ID)!.status).toBe("failed")
  })

  it("installing → lokal tanpa rotasi; warn digabung; callback sah tetap diterima", async () => {
    await ready()
    const token = TOKEN_RE.exec(boot(1).script)![1]
    expect(serveConfigFile({ mac: MAC, token, file: "user-data", ip: IP, now: at(2) }).ok).toBe(true)
    const before = getActiveJob(ID)!
    expect(before.status).toBe("installing")
    expect(boot(10).kind).toBe("local")
    expect(boot(20).kind).toBe("local")
    const after = getActiveJob(ID)!
    expect(after).toMatchObject({ tokenHash: before.tokenHash, tokenExpiresAt: before.tokenExpiresAt, installerBoots: 1 })
    const warns = eventsAfter(after.id, 0).filter((e) => e.message === REBOOT_WHILE_INSTALLING)
    expect(warns).toHaveLength(1)
    expect(warns[0]).toMatchObject({ level: "warn", repeat: 2 })
    expect(handleStatusCallback({ mac: MAC, token, stage: "done", ip: IP, now: at(30) })).toMatchObject({ status: 200 })
    expect(getHost(ID)!.status).toBe("done")
  })

  it("DEC-013: tanpa lease dan tanpa flag insecure → lokal, token & installer_boots tetap", async () => {
    await ready()
    process.env.PXE_INSECURE_NO_LEASE_CHECK = "0"
    const j0 = getActiveJob(ID)!
    const d = boot(1, null)
    expect(d.kind).toBe("local")
    expect(getActiveJob(ID)).toMatchObject({ tokenHash: j0.tokenHash, installerBoots: 0, status: "booting" })
  })
})

describe("watchdog", () => {
  it("timeout per tahap: batas − 1 dtk tetap; + 1 dtk → failed timeout-<tahap>; idempoten", async () => {
    await ready()
    const job = getActiveJob(ID)!
    const entered = stageEnteredAt(job)
    expect(sweepJobs(new Date(entered + 60 * 60_000 - 1000))).toEqual([])
    expect(sweepJobs(new Date(entered + 60 * 60_000 + 1000))).toEqual([job.id])
    expect(sweepJobs(new Date(entered + 60 * 60_000 + 2000))).toEqual([])
    const j = getJob(job.id)!
    expect(j).toMatchObject({ status: "failed", failureReason: "timeout-booting", tokenHash: null })
    expect(j.stages.at(-1)).toMatchObject({ stage: "failed", source: "watchdog" })
    expect(eventsAfter(job.id, 0).at(-1)).toMatchObject({ level: "error", message: timeoutMessage("booting", 60) })
    // Install ulang setelah failed → job baru booting, installer_boots 0; job lama tetap.
    expect(installHosts([ID], new Date(entered + 61 * 60_000)).started).toEqual([ID])
    expect(getActiveJob(ID)).toMatchObject({ status: "booting", installerBoots: 0 })
    expect(getJob(job.id)!.failureReason).toBe("timeout-booting")
  })
  it("installing timeout → token dicabut, callback terlambat 404, tanpa event baru", async () => {
    await ready()
    const token = TOKEN_RE.exec(boot(1).script)![1]
    serveConfigFile({ mac: MAC, token, file: "user-data", ip: IP, now: at(2) })
    const id = getActiveJob(ID)!.id
    const late = at(2 + 120 * 60 + 1)
    expect(handleStatusCallback({ mac: MAC, token, stage: "done", ip: IP, now: late })).toMatchObject({ status: 404 })
    expect(getJob(id)).toMatchObject({ status: "failed", failureReason: "timeout-installing" })
    const n = getJob(id)!.eventSeq
    expect(handleStatusCallback({ mac: MAC, token, stage: "done", ip: IP, now: late })).toMatchObject({ status: 404 })
    expect(getJob(id)!.eventSeq).toBe(n)
  })
  it("startWatchdog: satu timer, interval dari settings, stop membersihkan", () => {
    vi.useFakeTimers()
    process.env.PXE_WATCHDOG_INTERVAL_SEC = "5"
    expect(startWatchdog()).toBe(5)
    expect(startWatchdog()).toBe(5)
    expect(vi.getTimerCount()).toBe(1)
    stopWatchdog()
    expect(watchdogRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
  it("watchdogTick mencatat error tanpa melempar", () => {
    const error = vi.fn()
    process.env.PXE_TOKEN_TTL_MIN = "0"
    expect(watchdogTick({ error })).toBe(0)
    expect(error).toHaveBeenCalledOnce()
  })
})
