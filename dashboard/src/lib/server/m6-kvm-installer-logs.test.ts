// AC-6.17 (SR-5-5(c)) dengan fixture log installer NYATA dari run KVM M6 (M6-T14/T15): template di
// `dashboard/test/fixtures/installer-logs/` (log asli disanitasi; secret hanya placeholder sintetis
// {{TOKEN}}/{{HASH}}/{{KEY}}/{{KEY_BODY}}, lihat src/test/installer-logs.ts). Setiap fixture dikirim
// lewat handleLogPost dalam potongan ≤ 200 baris/16 KB (LF dan CRLF) dan potongan kecil 7 baris →
// semua secret sintetis tersamar, setiap baris biasa tersimpan identik (normalisasi terdokumentasi).
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { applyConfig } from "@/lib/server/config-service"
import { getActiveJob } from "@/lib/server/db/repos/jobs"
import { eventsAfter } from "@/lib/server/db/repos/job-events"
import { decideBoot } from "@/lib/server/discovery"
import { installHosts } from "@/lib/server/install-service"
import { clearLeaseCache } from "@/lib/server/leases"
import { handleLogPost } from "@/lib/server/provisioning"
import { stopWatchdog } from "@/lib/server/watchdog"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD } from "@/test/fixtures"
import { checkStored, chunkBodies, expandTemplate, listFixtures } from "@/test/installer-logs"

export const REAL_DIR = path.resolve(__dirname, "../../../test/fixtures/installer-logs")

const MEDIA = makeMediaRoot(tmpDir("m6kvm-media"))
withDb("empty", {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_MEDIA_ROOT: MEDIA,
  PXE_INSECURE_NO_LEASE_CHECK: "1",
})

const MAC = "52:54:00:99:00:31"
const ID = "525400990031"
const IP = "10.99.0.152"
const T0 = Date.parse("2026-11-06T10:00:00.000Z")
const at = (sec: number) => new Date(T0 + sec * 1000)
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//

beforeEach(() => clearLeaseCache())
afterEach(() => stopWatchdog())

async function ready(): Promise<string> {
  decideBoot({ mac: MAC, platform: "efi", ip: IP, wait: 0, now: at(0) })
  const r = await applyConfig([ID], {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  expect(installHosts([ID], at(0)).started).toEqual([ID])
  return TOKEN_RE.exec(decideBoot({ mac: MAC, platform: "efi", ip: IP, wait: 0, now: at(1) }).script)![1]
}
const installerMessages = () =>
  eventsAfter(getActiveJob(ID)!.id, 0, 5000)
    .filter((e) => e.kind === "installer")
    .map((e) => e.message)

describe("AC-6.17 fixture log installer nyata dari KVM M6", () => {
  const fixtures = listFixtures(REAL_DIR)
  it("fixture nyata tersedia untuk kelima format (Ubuntu subiquity/curtin, Rocky anaconda/program, Debian d-i syslog) dan hanya memuat placeholder", () => {
    expect(fixtures.map((f) => f.name)).toEqual(["anaconda.log", "curtin-install.log", "di-syslog.log", "program.log", "subiquity-server-debug.log"])
    for (const f of fixtures) {
      expect(f.template, f.name).toMatch(/^# FIXTURE log installer nyata \(run KVM M6/)
      expect(f.template, f.name).not.toMatch(/\$6\$|PRIVATE KEY|\/boot\/[0-9A-Fa-f:%-]{12,40}\/[A-Za-z0-9_-]{8}|token["']?\s*[=:]\s*["']?[A-Za-z0-9_-]{8}/i)
      expect(f.template, f.name).not.toMatch(/52:54:00:99:0[0-9a-f]:[0-9a-f]{2}/)
      expect(f.template, f.name).toMatch(/\{\{(TOKEN|HASH|KEY|KEY_BODY)\}\}/)
      expect(f.template.split("\n").length, f.name).toBeGreaterThan(100)
    }
  })
  const rows = fixtures.flatMap((f) =>
    ([
      ["LF, 200 baris/16 KB", 200, "\n"],
      ["CRLF", 200, "\r\n"],
      ["potongan kecil 7 baris", 7, "\n"],
    ] as const).map(([mode, maxLines, eol]): [string, string, string, number, string] => [f.name, mode, f.template, maxLines, eol]),
  )
  it.each(rows)("%s (%s) via handleLogPost: secret sintetis tersamar, baris biasa identik", async (_name, _mode, tpl, maxLines, eol) => {
    const token = await ready()
    const lines = expandTemplate(tpl, { mac: MAC, token })
    const bodies = chunkBodies(
      lines.map((l) => l.text),
      maxLines,
      16 * 1024,
      eol,
    )
    bodies.forEach((b, i) => expect(handleLogPost({ mac: MAC, token, text: b, ip: IP, now: at(2 + i) })).toMatchObject({ ok: true, status: 200 }))
    const allow = maxLines === 7 && tpl.includes("{{KEY_BODY}}") ? 1 : 0
    expect(checkStored(installerMessages(), lines, token, { allowShortKeyTail: allow })).toEqual([])
  })
})
