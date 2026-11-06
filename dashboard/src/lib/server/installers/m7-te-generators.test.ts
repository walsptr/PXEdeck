// M7-T7 (test-engineer) — pelengkap AC-7.7/7.8/7.9 di atas test dev (m7-vlan-generators.test.ts):
//   AC-7.7  Ubuntu VLAN dengan iface by name (match {name}) dan vlans.mgmt.<id> mengikuti VLAN id;
//           tanpa VLAN → netplan M6 (alamat di ethernets.mgmt, tanpa kunci `vlans`).
//   AC-7.8  [O10] paket tambahan tidak ditambahkan: `pkgsel/include` identik VLAN vs non-VLAN; preseed
//           VLAN hanya berbeda dari non-VLAN di baris late_command (stanza interfaces.d).
//   AC-7.9  Rocky VLAN dengan iface by name; tanpa VLAN → tanpa --vlanid; kickstart bebas token.
import { describe, expect, it } from "vitest"

import { SSH_ED25519 } from "@/test/fixtures"

import type { InstallContext, InstallNetwork } from "./context"
import { debianInterfacesText, debianPreseed } from "./debian"
import { rockyKickstart } from "./rocky"
import { ubuntuAutoinstall, ubuntuUserData } from "./ubuntu"

const FAKE_HASH = `$6$fixturesalt$${"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789./".repeat(3).slice(0, 86)}`
const TOKEN = "FIXTURE-token-not-real_00000000000000000000"
const MAC = "52:54:00:99:00:31"

const V20: InstallNetwork = {
  mode: "static",
  ip: "10.99.20.41",
  prefix: 24,
  gateway: "10.99.20.1",
  dns: ["10.99.10.2"],
  vlan: 20,
  iface: { by: "mac" },
}
const NAMED: InstallNetwork = { ...V20, iface: { by: "name", name: "enp1s0" } }
const FLAT: InstallNetwork = { ...V20, vlan: null }

function ctx(network: InstallNetwork, imageRepo: string): InstallContext {
  return {
    jobId: "job-0b6c3f0e-1d2a-4c6b-9f00-000000000031",
    mac: MAC,
    hostname: "m7-node31",
    username: "ops",
    passwordHash: FAKE_HASH,
    sudo: true,
    disableSshPassword: true,
    network,
    authorizedKeys: [SSH_ED25519.publicKey],
    storage: { partition: "lvm", disk: "" },
    timezone: "UTC",
    locale: "en_US.UTF-8",
    mediaUrl: "http://10.99.10.2/media",
    imageRepo,
    serverIp: "10.99.10.2",
    callbackUrl: `http://10.99.10.2/boot/${MAC}/${TOKEN}/status`,
  }
}

describe("AC-7.7 Ubuntu netplan VLAN (iface by name, id lain, tanpa VLAN)", () => {
  it("iface by name: ethernets.mgmt match {name} tanpa alamat; vlans.mgmt.20 link mgmt", () => {
    expect(ubuntuAutoinstall(ctx(NAMED, "ubuntu-24.04")).network).toEqual({
      version: 2,
      ethernets: { mgmt: { match: { name: "enp1s0" }, dhcp4: false, dhcp6: false } },
      vlans: {
        "mgmt.20": {
          id: 20,
          link: "mgmt",
          dhcp4: false,
          dhcp6: false,
          addresses: ["10.99.20.41/24"],
          routes: [{ to: "default", via: "10.99.20.1" }],
          nameservers: { addresses: ["10.99.10.2"] },
        },
      },
    })
  })
  it("VLAN id mengikuti config (VLAN 300 → vlans.mgmt.300 id 300)", () => {
    const n = ubuntuAutoinstall(ctx({ ...V20, vlan: 300 }, "ubuntu-24.04")).network as { vlans: Record<string, { id: number; link: string }> }
    expect(Object.keys(n.vlans)).toEqual(["mgmt.300"])
    expect(n.vlans["mgmt.300"]).toMatchObject({ id: 300, link: "mgmt" })
  })
  it("tanpa VLAN → bentuk M6: alamat di ethernets.mgmt, tanpa kunci vlans", () => {
    const n = ubuntuAutoinstall(ctx(FLAT, "ubuntu-24.04")).network
    expect(n).toEqual({
      version: 2,
      ethernets: {
        mgmt: {
          match: { macaddress: MAC },
          dhcp4: false,
          dhcp6: false,
          addresses: ["10.99.20.41/24"],
          routes: [{ to: "default", via: "10.99.20.1" }],
          nameservers: { addresses: ["10.99.10.2"] },
        },
      },
    })
    expect(n).not.toHaveProperty("vlans")
  })
  it("user-data VLAN by name bebas token", () => {
    expect(ubuntuUserData(ctx(NAMED, "ubuntu-24.04"))).not.toContain(TOKEN)
  })
})

describe("AC-7.8 Debian VLAN: tanpa paket tambahan (O10), perbedaan hanya di stanza", () => {
  const pkgsel = (ps: string) => ps.split("\n").filter((l) => l.startsWith("d-i pkgsel/"))
  it("pkgsel/include identik VLAN vs non-VLAN dan tidak memuat `vlan`", () => {
    const v = debianPreseed(ctx(V20, "debian-12"))
    const f = debianPreseed(ctx(FLAT, "debian-12"))
    expect(pkgsel(v)).toEqual(pkgsel(f))
    const inc = v.split("\n").find((l) => l.startsWith("d-i pkgsel/include "))!
    expect(inc.split(/\s+/)).not.toContain("vlan")
  })
  it("preseed VLAN vs non-VLAN hanya berbeda di baris late_command", () => {
    const v = debianPreseed(ctx(V20, "debian-12")).split("\n")
    const f = debianPreseed(ctx(FLAT, "debian-12")).split("\n")
    expect(v).toHaveLength(f.length)
    const diff = v.map((l, i) => (l === f[i] ? null : l)).filter((l) => l !== null) as string[]
    expect(diff).toHaveLength(1)
    expect(diff[0].startsWith("d-i preseed/late_command string ")).toBe(true)
  })
  it("stanza VLAN memakai id config (VLAN 300 → $IF.300)", () => {
    const t = debianInterfacesText(ctx({ ...V20, vlan: 300 }, "debian-12"))
    expect(t).toContain("auto $IF.300\niface $IF.300 inet static\n")
    expect(t).toContain("iface $IF inet manual\n")
  })
})

describe("AC-7.9 Rocky VLAN pelengkap", () => {
  const netLines = (ks: string) => ks.split("\n").filter((l) => l.startsWith("network "))
  it("VLAN 20 by MAC: tepat satu baris network static dengan --vlanid=20 --activate --onboot=yes", () => {
    const ks = rockyKickstart(ctx(V20, "rocky-9"))
    const lines = netLines(ks)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^network --device=52:54:00:99:00:31 --bootproto=static --ip=10\.99\.20\.41 /)
    for (const f of ["--vlanid=20", "--activate", "--onboot=yes", "--gateway=10.99.20.1", "--nameserver=10.99.10.2", "--netmask=255.255.255.0"])
      expect(lines[0].split(" ")).toContain(f)
    expect(ks).not.toContain(TOKEN)
  })
  it("iface by name → --device=<nama> + --vlanid", () => {
    const [line] = netLines(rockyKickstart(ctx(NAMED, "rocky-9")))
    expect(line).toMatch(/^network --device=enp1s0 --bootproto=static /)
    expect(line.split(" ")).toContain("--vlanid=20")
  })
  it("tanpa VLAN → tanpa --vlanid", () => {
    const [line] = netLines(rockyKickstart(ctx(FLAT, "rocky-9")))
    expect(line).not.toMatch(/--vlanid/)
    expect(line).toMatch(/--bootproto=static --ip=10\.99\.20\.41 /)
  })
})
