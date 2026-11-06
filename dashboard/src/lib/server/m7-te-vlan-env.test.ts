// M7-T7 (test-engineer) — AC-7.6 (unit): DEC-021/022 dengan env topologi VLAN.
//   - infra/server/dashboard-vlan.env di-parse `settingsFromEnv` tanpa error (NODE_ENV=production,
//     hash admin uji menggantikan placeholder deploy), nilai jaringan sesuai plan §2.3;
//   - isLocalMedia(mediaUrl, pxeServer) true → generator Debian (VLAN 20) tidak menolak media;
//   - varian PXE_MEDIA_URL=http://10.99.0.2/media + PXE_SERVER_IP=10.99.10.2 → debianExternalMediaError
//     (fail-closed);
//   - PXE_SERVER_IP=10.99.20.1 (alamat VLAN management) dengan PXE_MGMT_CIDR=10.99.10.0/24 → start
//     ditolak (DEC-006 tetap; startOrExit exit 1).
// Juga: dashboard-vlan.env identik dashboard.env (M6) di luar blok jaringan VLAN (komentar file).
import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { testAdminHash } from "@/test/auth"
import { isolateEnv } from "@/test/env"
import { SSH_ED25519 } from "@/test/fixtures"

import { debianExternalMediaError, InstallerInputError, isLocalMedia, type InstallContext } from "./installers/context"
import { debianPreseed } from "./installers/debian"
import { settingsFromEnv, type SettingsEnv } from "./settings"
import { startOrExit } from "./startup"
import { stopWatchdog } from "./watchdog"

isolateEnv()
afterEach(() => {
  stopWatchdog()
  vi.unstubAllEnvs()
})

const REPO = path.resolve(__dirname, "../../../..")

function parseEnvFile(rel: string): SettingsEnv {
  const env: SettingsEnv = {}
  for (const l of readFileSync(path.join(REPO, rel), "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(l.trim())
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1")
  }
  return env
}
const VLAN_ENV = parseEnvFile("infra/server/dashboard-vlan.env")
/** Env file + hash admin runtime (placeholder deploy diganti, seperti install-dashboard.sh). */
const runtime = (over: SettingsEnv = {}): SettingsEnv => ({
  ...VLAN_ENV,
  PXE_ADMIN_PASSWORD_HASH: testAdminHash(),
  PXE_DB_PATH: ":memory:",
  ...over,
})

const FAKE_HASH = `$6$fixturesalt$${"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789./".repeat(3).slice(0, 86)}`
const MAC = "52:54:00:99:00:33"
function debCtx(mediaUrl: string, serverIp: string): InstallContext {
  return {
    jobId: "job-0b6c3f0e-1d2a-4c6b-9f00-000000000033",
    mac: MAC,
    hostname: "m7-node33",
    username: "ops",
    passwordHash: FAKE_HASH,
    sudo: true,
    disableSshPassword: true,
    network: { mode: "static", ip: "10.99.20.43", prefix: 24, gateway: "10.99.20.1", dns: ["10.99.10.2"], vlan: 20, iface: { by: "mac" } },
    authorizedKeys: [SSH_ED25519.publicKey],
    storage: { partition: "lvm", disk: "" },
    timezone: "UTC",
    locale: "en_US.UTF-8",
    mediaUrl,
    imageRepo: "debian-12",
    serverIp,
    callbackUrl: `http://${serverIp}/boot/${MAC}/FIXTURE-token-not-real_00000000000000000000/status`,
  }
}

describe("AC-7.6 infra/server/dashboard-vlan.env di-parse settingsFromEnv (production)", () => {
  it("file memuat NODE_ENV=production, placeholder hash (bukan hash nyata), PXE_VLAN_NETWORKS VLAN 20", () => {
    expect(VLAN_ENV.NODE_ENV).toBe("production")
    expect(VLAN_ENV.PXE_ADMIN_PASSWORD_HASH).toBe("@PXE_ADMIN_PASSWORD_HASH@")
    expect(VLAN_ENV.PXE_VLAN_NETWORKS).toBe("20:10.99.20.0/24:10.99.20.1")
    // Placeholder apa adanya → start ditolak (fail-closed, sama seperti dashboard.env M6).
    expect(() => settingsFromEnv({ ...VLAN_ENV, PXE_DB_PATH: ":memory:" })).toThrow(/PXE_ADMIN_PASSWORD_HASH/)
  })

  it("dengan hash admin uji → tanpa error; jaringan VLAN 10 PXE + vlanNetworks VLAN 20; isLocalMedia true", () => {
    const s = settingsFromEnv(runtime())
    expect(s.network).toMatchObject({
      cidr: "10.99.10.0/24",
      gateway: "10.99.10.1",
      dns: ["10.99.10.2"],
      pxeServer: "10.99.10.2",
      dynamicRange: ["10.99.10.100", "10.99.10.200"],
    })
    expect(s.vlanNetworks).toEqual([{ vlan: 20, cidr: "10.99.20.0/24", prefix: 24, gateway: "10.99.20.1" }])
    expect(s.baseUrl).toBe("http://10.99.10.2")
    expect(s.mediaUrl).toBe("http://10.99.10.2/media")
    expect(s.insecureNoLeaseCheck).toBe(false)
    expect(s.admin).toEqual({ username: "pxeadmin", passwordHash: testAdminHash() })
    expect(isLocalMedia(s.mediaUrl, s.network.pxeServer)).toBe(true)
  })

  it("install Debian diizinkan: preseed VLAN 20 dirender dari media lokal (trusted=yes hanya untuk media lokal)", () => {
    const s = settingsFromEnv(runtime())
    const pre = debianPreseed(debCtx(s.mediaUrl, s.network.pxeServer))
    expect(pre).toContain("http://10.99.10.2/media")
    expect(pre).not.toContain("10.99.0.2")
    expect(pre).not.toContain("FIXTURE-token-not-real")
  })

  it("varian PXE_MEDIA_URL=http://10.99.0.2/media + PXE_SERVER_IP=10.99.10.2 → debianExternalMediaError (fail-closed)", () => {
    const s = settingsFromEnv(runtime({ PXE_MEDIA_URL: "http://10.99.0.2/media" }))
    expect(s.network.pxeServer).toBe("10.99.10.2")
    expect(isLocalMedia(s.mediaUrl, s.network.pxeServer)).toBe(false)
    const msg = debianExternalMediaError(s.mediaUrl, s.network.pxeServer)
    expect(msg).toMatch(/^Debian: media 10\.99\.0\.2 bukan server PXE lokal \(10\.99\.10\.2\)/)
    let err: unknown = null
    try {
      debianPreseed(debCtx(s.mediaUrl, s.network.pxeServer))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(InstallerInputError)
    expect((err as Error).message).toBe(msg)
  })

  it("PXE_SERVER_IP=10.99.20.1 (VLAN management) dengan PXE_MGMT_CIDR=10.99.10.0/24 → settings ditolak (DEC-006)", () => {
    expect(() => settingsFromEnv(runtime({ PXE_SERVER_IP: "10.99.20.1" }))).toThrow(/PXE_SERVER_IP/)
    // Juga PXE_SERVER_IP di subnet VLAN terdaftar lain mana pun.
    expect(() => settingsFromEnv(runtime({ PXE_SERVER_IP: "10.99.20.2" }))).toThrow(/PXE_SERVER_IP/)
  })

  it("startOrExit dengan env proses = dashboard-vlan.env + PXE_SERVER_IP=10.99.20.1 → `[pxe] start ditolak:` + exit 1; env asli → start", () => {
    vi.stubEnv("NODE_ENV", "production")
    const apply = (env: SettingsEnv) => {
      for (const [k, v] of Object.entries(env)) if (k !== "NODE_ENV" && v !== undefined) process.env[k] = v
    }
    apply(runtime({ PXE_SERVER_IP: "10.99.20.1" }))
    const error = vi.fn()
    const exit = vi.fn((c: number) => {
      throw new Error(`exit ${c}`)
    }) as unknown as (c: number) => never
    expect(() => startOrExit({ warn: vi.fn(), error }, exit)).toThrow("exit 1")
    expect(String(error.mock.calls[0][0])).toMatch(/^\[pxe\] start ditolak: .*PXE_SERVER_IP/)
    // Kontrol: env file apa adanya (dengan hash runtime) → start berhasil, tanpa exit.
    apply(runtime())
    const exit2 = vi.fn() as unknown as (c: number) => never
    const s = startOrExit({ warn: vi.fn(), error: vi.fn() }, exit2)
    expect(exit2).not.toHaveBeenCalled()
    expect(s.network.pxeServer).toBe("10.99.10.2")
    expect(s.vlanNetworks.map((v) => v.vlan)).toEqual([20])
  })

  it("selain blok jaringan VLAN, dashboard-vlan.env identik dashboard.env (M6)", () => {
    const flat = parseEnvFile("infra/server/dashboard.env")
    const NET = ["PXE_MGMT_CIDR", "PXE_MGMT_GATEWAY", "PXE_MGMT_DNS", "PXE_SERVER_IP", "PXE_DHCP_RANGE", "PXE_DHCP_INTERFACE", "PXE_VLAN_NETWORKS", "PXE_BASE_URL", "PXE_MEDIA_URL", "PXE_ALLOWED_HOSTS"]
    const strip = (e: SettingsEnv) => Object.fromEntries(Object.entries(e).filter(([k]) => !NET.includes(k)))
    expect(strip(VLAN_ENV)).toEqual(strip(flat))
    expect(flat.PXE_VLAN_NETWORKS).toBeUndefined()
  })
})
