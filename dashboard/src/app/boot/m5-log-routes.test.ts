// M5-T4 (backend-dev, dasar): POST /boot/{mac}/{token}/log, logBootDenied (CR-4-8), decode
// (CR-4-9). Test menyeluruh AC-5.5/5.6/5.13 = M5-T11/T12 (test-engineer).
import { beforeEach, describe, expect, it, vi } from "vitest"

import { applyConfig } from "@/lib/server/config-service"
import { getDb } from "@/lib/server/db"
import { eventsAfter } from "@/lib/server/db/repos/job-events"
import { getActiveJob } from "@/lib/server/db/repos/jobs"
import { bootDeniedLine, escapeLogValue } from "@/lib/server/boot-http"
import { installHosts } from "@/lib/server/install-service"
import { clearLeaseCache } from "@/lib/server/leases"
import { resetLogRate } from "@/lib/server/provisioning"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD } from "@/test/fixtures"

import { GET as bootGET } from "./[name]/route"
import { POST as logPOST } from "./[name]/[token]/log/route"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

const MEDIA = makeMediaRoot(tmpDir("m5-log-media"))
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
})

const MAC = "52:54:00:99:00:11"
const ID = "525400990011"
const IP = "10.99.0.150"
const p = <T extends object>(v: T) => ({ params: Promise.resolve(v) }) as never

beforeEach(() => {
  clearLeaseCache()
  resetLogRate()
})

function req(url: string, ip: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (ip) headers.set("x-real-ip", ip)
  return new Request(`http://10.99.0.2${url}`, { ...init, headers })
}
const boot = async (name: string, ip: string | null = IP) => {
  const res = await bootGET(req(`/boot/${name}?platform=efi`, ip), p({ name }))
  return { res, body: await res.text() }
}
const log = async (token: string, body: string, ip: string | null = IP, mac = MAC) => {
  const res = await logPOST(
    req(`/boot/${mac}/${token}/log`, ip, { method: "POST", headers: { "content-type": "text/plain" }, body }),
    p({ name: mac, token }),
  )
  return { res, body: await res.text() }
}

async function installed(): Promise<string> {
  await boot(`${MAC}.ipxe`)
  const r = await applyConfig([ID], {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  installHosts([ID])
  return /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//.exec((await boot(`${MAC}.ipxe`)).body)![1]
}

describe("POST /boot/{mac}/{token}/log", () => {
  it("3 baris → 3 event installer; CR/kontrol dibuang; kosong diabaikan; ERROR → level error; token diredaksi", async () => {
    const token = await installed()
    const job = getActiveJob(ID)!
    const before = job.eventSeq
    const r = await log(token, `installer: autoinstall mulai\r\n\n  \nERROR gagal\u0007 x\nurl /boot/${MAC}/${token}/status\n`)
    expect(r.res.status).toBe(200)
    const ev = eventsAfter(job.id, before)
    expect(ev.map((e) => [e.kind, e.level, e.message])).toEqual([
      ["installer", "info", "installer: autoinstall mulai"],
      ["installer", "error", "ERROR gagal x"],
      ["installer", "info", `url /boot/${MAC}/[REDACTED]/status`],
    ])
  })
  it("penolakan → 404 identik; > 16 KB → 413 juga dengan token salah; > 200 baris → 413; > 60/mnt → 429", async () => {
    const token = await installed()
    for (const r of [await log("A".repeat(43), "x"), await log(token, "x", "10.99.0.1"), await log(token, "x", null), await log(token, "x", IP, "52:54:00:99:00:12")]) {
      expect(r.res.status).toBe(404)
      expect(r.body).toBe("not found\n")
    }
    expect((await log("A".repeat(43), "x".repeat(16 * 1024 + 1))).res.status).toBe(413)
    expect((await log(token, "x".repeat(16 * 1024 + 1))).res.status).toBe(413)
    expect((await log(token, Array.from({ length: 201 }, (_, i) => `l${i}`).join("\n"))).res.status).toBe(413)
    let last = 0
    for (let i = 0; i < 61; i++) last = (await log(token, "x")).res.status
    expect(last).toBe(429)
  })
})

describe("CR-4-9 / CR-4-8", () => {
  it("nama tak terdekode/invalid → 400 MAC tidak valid, tanpa host baru", async () => {
    for (const name of ["%zz.ipxe", "%E0%A4%A.ipxe", "zz:zz.ipxe", ".ipxe"]) {
      const r = await boot(name)
      expect(r.res.status, name).toBe(400)
      expect(r.body).toBe("MAC tidak valid\n")
    }
    expect(getDb().prepare("SELECT count(*) AS n FROM hosts").get()).toEqual({ n: 0 })
  })
  it("bootDeniedLine: satu baris, mac=- untuk segmen invalid, alasan di-escape", () => {
    const l = bootDeniedLine("status", "x\n[boot] tolak palsu", "generator: a\r\nb")
    expect(l).toBe("[boot] tolak status mac=- alasan=generator: a\\u000d\\u000ab")
    expect(l).not.toMatch(/[\r\n]/)
    expect(bootDeniedLine("file", "52-54-00-99-00-11", "ip")).toBe("[boot] tolak file mac=52:54:00:99:00:11 alasan=ip")
    expect(escapeLogValue("x".repeat(300))).toHaveLength(201)
  })
})
