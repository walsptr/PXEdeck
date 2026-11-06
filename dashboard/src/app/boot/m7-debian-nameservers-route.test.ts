// DEC-026 §1 (M7) integration: GET /boot/{mac}.ipxe untuk image Debian memakai entri PERTAMA
// PXE_MGMT_DNS (DNS jaringan PXE = opsi dns-server DHCP) sebagai `netcfg/get_nameservers`, bukan
// PXE_SERVER_IP. Env sengaja membuat keduanya berbeda.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyConfig } from "@/lib/server/config-service"
import { installHosts } from "@/lib/server/install-service"
import { clearLeaseCache } from "@/lib/server/leases"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD, SSH_ED25519 } from "@/test/fixtures"

import { GET as bootGET } from "./[name]/route"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

const MEDIA = makeMediaRoot(tmpDir("m7-ns-media"))
withDb("empty", {
  PXE_MGMT_CIDR: "10.99.10.0/24",
  PXE_MGMT_GATEWAY: "10.99.10.1",
  PXE_MGMT_DNS: "10.99.10.53,10.99.10.54",
  PXE_SERVER_IP: "10.99.10.2",
  PXE_DHCP_RANGE: "10.99.10.100-10.99.10.200",
  PXE_BASE_URL: "http://10.99.10.2",
  PXE_MEDIA_ROOT: MEDIA,
  PXE_TRUST_PROXY: "1",
  PXE_INSECURE_NO_LEASE_CHECK: "1",
  PXE_KERNEL_EXTRA_ARGS: "console=ttyS0,115200n8 console=tty0",
})

const MAC = "52:54:00:99:00:43"
const ID = "525400990043"
const IP = "10.99.10.150"

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-06T10:00:00.000Z"))
  clearLeaseCache()
})
afterEach(() => {
  vi.useRealTimers()
})

async function boot(): Promise<string> {
  const headers = new Headers({ "x-real-ip": IP })
  const res = await bootGET(new Request(`http://10.99.10.2/boot/${MAC}.ipxe?platform=efi`, { headers }), {
    params: Promise.resolve({ name: `${MAC}.ipxe` }),
  } as never)
  expect(res.status).toBe(200)
  return res.text()
}

describe("DEC-026 §1: cmdline Debian dari route memakai PXE_MGMT_DNS[0]", () => {
  it("netcfg/get_nameservers=10.99.10.53 (bukan PXE_SERVER_IP, bukan entri kedua)", async () => {
    await boot()
    const r = await applyConfig([ID], {
      os: { osImageId: "debian-12", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
      credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
      network: { mode: "dhcp" },
      hostname: { assignments: { [ID]: "m7-node43" } },
      ssh: { keyIds: [], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" },
    })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(installHosts([ID]).started).toEqual([ID])
    const script = await boot()
    const kernel = script.split("\n").find((l) => l.startsWith("kernel "))!
    expect(kernel).toBeDefined()
    const args = kernel.split(" ")
    expect(args.filter((a) => a.startsWith("netcfg/get_nameservers"))).toEqual(["netcfg/get_nameservers=10.99.10.53"])
    expect(args.at(-1)).toBe("---")
    expect(args).toContain("netcfg/no_default_route=true")
  })
})
