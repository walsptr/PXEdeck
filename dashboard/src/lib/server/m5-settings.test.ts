// M5-T1 (backend-dev, dasar): settings job/SR-4-2/CR-4-10, requestHost (CR-4-15), guardRead
// (DEC-015), hook start. Test menyeluruh AC-5.1–5.4 = M5-T11/T12 (test-engineer).
import { describe, expect, it, vi } from "vitest"

import { entryScript, installerScript } from "@/lib/server/boot-script"
import { guardRead, requestHost } from "@/lib/server/http"
import { onServerStart, startOrExit } from "@/lib/server/startup"
import { authHeaders } from "@/test/auth"
import { isolateEnv } from "@/test/env"

import { settingsFromEnv, settingsWarnings, type SettingsEnv } from "./settings"

isolateEnv()

const KVM: SettingsEnv = {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_BASE_URL: "http://10.99.0.2",
  PXE_DNSMASQ_LEASES: "/var/lib/misc/dnsmasq.leases",
  PXE_TRUST_PROXY: "1",
}

describe("settings job (DEC-014)", () => {
  it("default 60/120/60, 3 boot, 30 dtk, 5000 event, 20 job, insecure 0", () => {
    const s = settingsFromEnv({})
    expect(s.jobTimeouts).toEqual({ bootingMin: 60, installingMin: 120, configuringMin: 60 })
    expect(s).toMatchObject({
      maxInstallerBoots: 3,
      watchdogIntervalSec: 30,
      jobLogMaxEvents: 5000,
      jobHistoryPerHost: 20,
      insecureNoLeaseCheck: false,
    })
  })
  it("nilai KVM diterima", () => {
    const s = settingsFromEnv({ ...KVM, PXE_JOB_INSTALLING_TIMEOUT_MIN: "15", PXE_WATCHDOG_INTERVAL_SEC: "15" })
    expect(s.jobTimeouts.installingMin).toBe(15)
    expect(s.watchdogIntervalSec).toBe(15)
  })
  it.each([
    ["PXE_JOB_BOOTING_TIMEOUT_MIN", "0"],
    ["PXE_JOB_INSTALLING_TIMEOUT_MIN", "1441"],
    ["PXE_JOB_CONFIGURING_TIMEOUT_MIN", "abc"],
    ["PXE_JOB_MAX_INSTALLER_BOOTS", "11"],
    ["PXE_WATCHDOG_INTERVAL_SEC", "4"],
    ["PXE_JOB_LOG_MAX_EVENTS", "99"],
    ["PXE_JOB_HISTORY_PER_HOST", "1.5"],
    ["PXE_INSECURE_NO_LEASE_CHECK", "yes"],
  ])("%s=%s → error menyebut variabel", (k, v) => {
    expect(() => settingsFromEnv({ [k]: v })).toThrow(new RegExp(k))
  })
  it("TTL < jumlah timeout → error menyebut PXE_TOKEN_TTL_MIN", () => {
    expect(() => settingsFromEnv({ PXE_TOKEN_TTL_MIN: "239" })).toThrow(/PXE_TOKEN_TTL_MIN/)
    expect(settingsFromEnv({ PXE_TOKEN_TTL_MIN: "240" }).tokenTtlMin).toBe(240)
  })
})

describe("SR-4-2 / DEC-013 fail-closed", () => {
  it("trust proxy tanpa lease → error menyebut kedua variabel", () => {
    const env = { ...KVM, PXE_DNSMASQ_LEASES: undefined }
    expect(() => settingsFromEnv(env)).toThrow(/PXE_TRUST_PROXY.*PXE_DNSMASQ_LEASES/)
  })
  it("flag insecure → diterima + peringatan", () => {
    const s = settingsFromEnv({ ...KVM, PXE_DNSMASQ_LEASES: undefined, PXE_INSECURE_NO_LEASE_CHECK: "1" })
    expect(s.insecureNoLeaseCheck).toBe(true)
    expect(settingsWarnings(s)).toHaveLength(1)
    expect(settingsWarnings(s)[0]).toMatch(/PXE_INSECURE_NO_LEASE_CHECK/)
    expect(settingsWarnings(settingsFromEnv(KVM))).toEqual([])
  })
  it("onServerStart mencatat peringatan satu baris dan melempar bila env invalid", () => {
    const warn = vi.fn()
    process.env.PXE_INSECURE_NO_LEASE_CHECK = "1"
    onServerStart({ warn, error: vi.fn() }, false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).not.toContain("\n")
    process.env.PXE_INSECURE_NO_LEASE_CHECK = "0"
    process.env.PXE_TRUST_PROXY = "1"
    expect(() => onServerStart({ warn, error: vi.fn() }, false)).toThrow(/PXE_DNSMASQ_LEASES/)
  })
})

describe("CR-4-10 URL IPv6 ditolak; URL yang lolos aman untuk iPXE", () => {
  it.each([
    ["PXE_BASE_URL", "http://[fd00::2]"],
    ["PXE_MEDIA_URL", "http://[fd00::2]/media"],
  ])("%s=%s → error", (k, v) => {
    expect(() => settingsFromEnv({ [k]: v })).toThrow(new RegExp(k))
  })
  it.each(["http://10.99.0.2", "https://pxe.lab.example:8443/x/", "http://pxe-1.lab.example/a_b/c"])(
    "%s → entryScript/installerScript tidak melempar",
    (u) => {
      const s = settingsFromEnv({ PXE_BASE_URL: u })
      expect(() => entryScript(s.baseUrl)).not.toThrow()
      expect(() =>
        installerScript({
          method: "autoinstall",
          mediaUrl: s.mediaUrl,
          mediaRoot: s.mediaRoot,
          serverIp: s.network.pxeServer,
          configUrl: `${s.baseUrl}/boot/52:54:00:99:00:11/${"A".repeat(43)}/`,
          source: { kernel: "k", initrd: "i", repo: "r" },
          extraArgs: "",
        }),
      ).not.toThrow()
    },
  )
})

describe("CR-4-15 requestHost & DEC-015 guardRead", () => {
  // M6: + cookie sesi admin sungguhan agar guardRead lolos sampai pemeriksaan sesi (DEC-017 §4).
  const r = (h: Record<string, string>) => new Request("http://localhost/api/hosts", { headers: { ...authHeaders(), ...h } })
  it("X-Forwarded-Host hanya dibaca bila trust proxy", () => {
    expect(requestHost(r({ host: "a.example", "x-forwarded-host": "b.example" }), false)).toBe("a.example")
    expect(requestHost(r({ host: "a.example", "x-forwarded-host": "b.example, c" }), true)).toBe("b.example")
    expect(requestHost(r({}), false)).toBe("localhost")
  })
  it("Host di luar allowlist → 403; diizinkan → null; env invalid → 500", async () => {
    expect(guardRead(r({}))).toBeNull()
    const bad = guardRead(r({ host: "evil.example" }))!
    expect(bad.status).toBe(403)
    expect(await bad.json()).toEqual({ error: "Host tidak diizinkan" })
    // X-Forwarded-Host palsu tanpa trust proxy tidak membuka allowlist.
    process.env.PXE_ALLOWED_HOSTS = "pxe.lab.example"
    expect(guardRead(r({ host: "evil.example", "x-forwarded-host": "pxe.lab.example" }))!.status).toBe(403)
    process.env.PXE_TOKEN_TTL_MIN = "0"
    const err = guardRead(r({}))!
    expect(err.status).toBe(500)
    expect((await err.json()).error).toMatch(/PXE_TOKEN_TTL_MIN/)
  })
})

describe("startOrExit", () => {
  it("env invalid → error satu baris + exit(1)", () => {
    const error = vi.fn()
    const exit = vi.fn((c: number) => {
      throw new Error(`exit ${c}`)
    }) as unknown as (c: number) => never
    process.env.PXE_TRUST_PROXY = "1"
    expect(() => startOrExit({ warn: vi.fn(), error }, exit)).toThrow("exit 1")
    expect(String(error.mock.calls[0][0])).toMatch(/^\[pxe\] start ditolak: .*PXE_DNSMASQ_LEASES/)
  })
})
