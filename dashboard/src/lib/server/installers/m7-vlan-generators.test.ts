// M7-T2 (backend-dev) — generator dengan VLAN (topologi trunk, PXE native; DEC-024 §6, plan §2.5d).
//  - AC-7.9 Rocky: baris `network … --vlanid`, %post membuat parent/native tanpa IPv4 (dijalankan
//    `sh` di fixture direktori NetworkManager/ifcfg/sysfs palsu), tanpa VLAN → %post M6 identik.
//  - AC-7.8 Debian: stanza ifupdown `interfaces.d/mgmt` (parent inet manual + $IF.<id> static),
//    substitusi `$IF` dijalankan sungguhan; batas late_command.
//  - AC-7.7 Ubuntu: netplan parent tanpa alamat + vlans."mgmt.<id>"; golden VLAN.
// Hash/token fixture dummy (lihat installers.test.ts).
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { tmpDir } from "@/test/db"
import { SSH_ED25519 } from "@/test/fixtures"

import type { InstallContext, InstallNetwork } from "./context"
import { DEBIAN_LATE_COMMAND_MAX_BYTES, debianInterfacesText, debianLateScript, debianPreseed } from "./debian"
import { firstbootInstallCmds } from "./firstboot"
import {
  ROCKY_NATIVE_PROFILE,
  ROCKY_NET_PATHS,
  rockyKickstart,
  rockyNativeNoIpv4Lines,
  rockyPostScript,
  type RockyNetPaths,
} from "./rocky"
import { ubuntuAutoinstall, ubuntuUserData } from "./ubuntu"

const FAKE_HASH = `$6$fixturesalt$${"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789./".repeat(3).slice(0, 86)}`
const TOKEN = "FIXTURE-token-not-real_00000000000000000000"
const MAC = "52:54:00:99:00:41"
const OTHER_MAC = "52:54:00:99:00:99"

const VLAN20: InstallNetwork = {
  mode: "static",
  ip: "10.99.20.41",
  prefix: 24,
  gateway: "10.99.20.1",
  dns: ["10.99.10.2"],
  vlan: 20,
  iface: { by: "mac" },
}

function ctx(over: Partial<InstallContext> = {}): InstallContext {
  return {
    jobId: "job-0b6c3f0e-1d2a-4c6b-9f00-000000000041",
    mac: MAC,
    hostname: "m7-node41",
    username: "ops",
    passwordHash: FAKE_HASH,
    sudo: true,
    disableSshPassword: true,
    network: VLAN20,
    authorizedKeys: [SSH_ED25519.publicKey],
    storage: { partition: "lvm", disk: "/dev/vda" },
    timezone: "Asia/Jakarta",
    locale: "en_US.UTF-8",
    mediaUrl: "http://10.99.10.2/media",
    imageRepo: "rocky-9",
    serverIp: "10.99.10.2",
    callbackUrl: `http://10.99.10.2/boot/${MAC}/${TOKEN}/status`,
    ...over,
  }
}

// ---------------------------------------------------------------------------------------------
// Rocky
// ---------------------------------------------------------------------------------------------

/** Keyfile NetworkManager seperti yang ditulis anaconda (profil boot ip=dhcp → DHCP autoconnect). */
const KF = {
  parentByName: (uuid = "11111111-1111-4111-8111-111111111111") =>
    `[connection]\nid=enp1s0\nuuid=${uuid}\ntype=ethernet\nautoconnect=false\ninterface-name=enp1s0\n\n[ethernet]\n\n[ipv4]\nmethod=auto\ndhcp-timeout=60\n\n[ipv6]\naddr-gen-mode=eui64\nmethod=auto\n\n[proxy]\n`,
  parentByMac: `[connection]\nid=Wired connection 1\nuuid=22222222-2222-4222-8222-222222222222\ntype=ethernet\n\n[ethernet]\nmac-address=${MAC.toUpperCase()}\n\n[ipv4]\nmethod=auto\n`,
  vlan: (parent: string) =>
    `[connection]\nid=enp1s0.20\nuuid=33333333-3333-4333-8333-333333333333\ntype=vlan\ninterface-name=enp1s0.20\n\n[vlan]\nflags=1\nid=20\nparent=${parent}\n\n[ipv4]\naddress1=10.99.20.41/24,10.99.20.1\ndns=10.99.10.2;\nmethod=manual\n\n[ipv6]\nmethod=auto\n`,
  other: `[connection]\nid=enp2s0\nuuid=44444444-4444-4444-8444-444444444444\ntype=ethernet\ninterface-name=enp2s0\n\n[ipv4]\nmethod=auto\n`,
  otherMac: `[connection]\nid=other-mac\nuuid=55555555-5555-4555-8555-555555555555\ntype=ethernet\n\n[ethernet]\nmac-address=${OTHER_MAC}\n\n[ipv4]\nmethod=auto\n`,
}

type Fixture = { paths: RockyNetPaths; nm: (f: string) => string; ifcfg: (f: string) => string }

/** Root palsu: NM keyfile, ifcfg, sysfs (enp1s0 = MAC host, enp2s0 = NIC lain), file UUID. */
function fixture(files: Record<string, string>, ifcfg: Record<string, string> = {}): Fixture {
  const root = tmpDir("m7-rocky-nm")
  const paths: RockyNetPaths = {
    nmDir: path.join(root, "etc/NetworkManager/system-connections"),
    ifcfgDir: path.join(root, "etc/sysconfig/network-scripts"),
    sysNet: path.join(root, "sys/class/net"),
    uuidFile: path.join(root, "proc-uuid"),
  }
  for (const d of [paths.nmDir, paths.ifcfgDir]) mkdirSync(d, { recursive: true })
  for (const [nic, mac] of [["lo", "00:00:00:00:00:00"], ["enp1s0", MAC], ["enp2s0", OTHER_MAC]]) {
    mkdirSync(path.join(paths.sysNet, nic), { recursive: true })
    writeFileSync(path.join(paths.sysNet, nic, "address"), `${mac}\n`)
  }
  writeFileSync(paths.uuidFile, "99999999-9999-4999-8999-999999999999\n")
  for (const [f, c] of Object.entries(files)) {
    writeFileSync(path.join(paths.nmDir, f), c)
    chmodSync(path.join(paths.nmDir, f), 0o600)
  }
  for (const [f, c] of Object.entries(ifcfg)) writeFileSync(path.join(paths.ifcfgDir, f), c)
  return {
    paths,
    nm: (f) => readFileSync(path.join(paths.nmDir, f), "utf8"),
    ifcfg: (f) => readFileSync(path.join(paths.ifcfgDir, f), "utf8"),
  }
}

function runLines(lines: string[]): void {
  execFileSync("sh", ["-s"], { input: `${lines.join("\n")}\n`, encoding: "utf8" })
}

/** Keyfile INI → {section: {key: value}}. */
function ini(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  let sec = ""
  for (const l of text.split("\n")) {
    const s = /^\[(.+)\]$/.exec(l)
    if (s) {
      sec = s[1]
      out[sec] ??= {}
    } else if (l.includes("=")) {
      const i = l.indexOf("=")
      out[sec][l.slice(0, i)] = l.slice(i + 1)
    }
  }
  return out
}

describe("AC-7.9 Rocky kickstart VLAN", () => {
  it("baris network statis --vlanid (MAC host) dan kickstart bebas token", () => {
    const ks = rockyKickstart(ctx())
    expect(ks.split("\n")).toContain(
      `network --device=${MAC} --bootproto=static --ip=10.99.20.41 --netmask=255.255.255.0 --gateway=10.99.20.1 --nameserver=10.99.10.2 --vlanid=20 --hostname=m7-node41 --activate --onboot=yes`,
    )
    // Hanya satu baris network (tidak ada profil DHCP tambahan untuk native).
    expect(ks.split("\n").filter((l) => l.startsWith("network "))).toHaveLength(1)
    expect(ks).not.toContain(TOKEN)
  })
  it("%post memuat langkah native tanpa IPv4 (vlan ≠ null) sebelum firstboot + restorecon", () => {
    const c = ctx()
    const post = rockyPostScript(c)
    const native = rockyNativeNoIpv4Lines(c).join("\n")
    expect(native).toContain(ROCKY_NET_PATHS.nmDir)
    const iNative = post.indexOf(native)
    expect(iNative).toBeGreaterThan(0)
    expect(post.indexOf(firstbootInstallCmds("", "kickstart", MAC)[0])).toBeGreaterThan(iNative)
    expect(post.indexOf("restorecon -R /etc")).toBeGreaterThan(iNative)
    expect(post).not.toContain(TOKEN)
  })
  it("tanpa VLAN / DHCP → tanpa langkah native (%post M6 identik)", () => {
    for (const network of [{ ...VLAN20, vlan: null }, { mode: "dhcp" } as const]) {
      const c = ctx({ network })
      expect(rockyNativeNoIpv4Lines(c)).toEqual([])
      expect(rockyPostScript(c)).not.toMatch(/NetworkManager|nmconnection|ifcfg/)
    }
  })
  it("golden kickstart VLAN", async () => {
    await expect(rockyKickstart(ctx())).toMatchFileSnapshot("../../../test/golden/installers/rocky-ks-vlan.cfg")
  })
})

describe("AC-7.9 Rocky %post native tanpa IPv4 (fixture NetworkManager, sh)", () => {
  it("profil anaconda parent (interface-name & mac-address) dihapus; pxe-native dibuat; VLAN & NIC lain utuh", () => {
    const fx = fixture(
      {
        "enp1s0.nmconnection": KF.parentByName(),
        "Wired connection 1.nmconnection": KF.parentByMac,
        "enp1s0.20.nmconnection": KF.vlan("enp1s0"),
        "enp2s0.nmconnection": KF.other,
        "other-mac.nmconnection": KF.otherMac,
      },
      {
        "ifcfg-enp1s0": `DEVICE=enp1s0\nBOOTPROTO=dhcp\nONBOOT=yes\n`,
        "ifcfg-mac": `HWADDR="${MAC.toUpperCase()}"\nBOOTPROTO=dhcp\n`,
        "ifcfg-enp1s0.20": `DEVICE=enp1s0.20\nVLAN=yes\nPHYSDEV=enp1s0\n`,
        "ifcfg-enp2s0": `DEVICE=enp2s0\nBOOTPROTO=dhcp\n`,
      },
    )
    runLines(rockyNativeNoIpv4Lines(ctx(), fx.paths))
    expect(readdirSync(fx.paths.nmDir).sort()).toEqual(
      ["enp1s0.20.nmconnection", "enp2s0.nmconnection", "other-mac.nmconnection", `${ROCKY_NATIVE_PROFILE}.nmconnection`].sort(),
    )
    expect(fx.nm("enp1s0.20.nmconnection")).toBe(KF.vlan("enp1s0"))
    expect(fx.nm("enp2s0.nmconnection")).toBe(KF.other)
    expect(fx.nm("other-mac.nmconnection")).toBe(KF.otherMac)
    const p = ini(fx.nm(`${ROCKY_NATIVE_PROFILE}.nmconnection`))
    expect(p).toEqual({
      connection: { id: "pxe-native", uuid: "99999999-9999-4999-8999-999999999999", type: "ethernet", autoconnect: "true" },
      ethernet: { "mac-address": MAC },
      ipv4: { method: "disabled" },
      ipv6: { method: "disabled" },
    })
    expect(statSync(path.join(fx.paths.nmDir, `${ROCKY_NATIVE_PROFILE}.nmconnection`)).mode & 0o777).toBe(0o600)
    expect(readdirSync(fx.paths.ifcfgDir).sort()).toEqual(["ifcfg-enp1s0.20", "ifcfg-enp2s0"])
  })

  it("profil parent yang UUID-nya dirujuk vlan.parent ditulis ulang di tempat (IPv4/IPv6 disabled, autoconnect)", () => {
    const uuid = "11111111-1111-4111-8111-111111111111"
    const fx = fixture({
      "enp1s0.nmconnection": KF.parentByName(uuid),
      "Wired connection 1.nmconnection": KF.parentByMac,
      "enp1s0.20.nmconnection": KF.vlan(uuid),
    })
    runLines(rockyNativeNoIpv4Lines(ctx(), fx.paths))
    expect(readdirSync(fx.paths.nmDir).sort()).toEqual(["enp1s0.20.nmconnection", "enp1s0.nmconnection"])
    expect(fx.nm("enp1s0.20.nmconnection")).toBe(KF.vlan(uuid))
    const p = ini(fx.nm("enp1s0.nmconnection"))
    expect(p.connection).toEqual({ id: "enp1s0", uuid, type: "ethernet", autoconnect: "true", "interface-name": "enp1s0" })
    expect(p.ipv4).toEqual({ method: "disabled" })
    expect(p.ipv6).toEqual({ method: "disabled" })
    expect(p.proxy).toEqual({})
    expect(statSync(path.join(fx.paths.nmDir, "enp1s0.nmconnection")).mode & 0o777).toBe(0o600)
  })

  it("profil dirujuk tanpa section [ipv4]/[ipv6] → section ditambahkan", () => {
    const uuid = "66666666-6666-4666-8666-666666666666"
    const fx = fixture({
      "p.nmconnection": `[connection]\nid=p\nuuid=${uuid}\ntype=ethernet\ninterface-name=enp1s0\n`,
      "v.nmconnection": KF.vlan(uuid),
    })
    runLines(rockyNativeNoIpv4Lines(ctx(), fx.paths))
    const p = ini(fx.nm("p.nmconnection"))
    expect(p.ipv4).toEqual({ method: "disabled" })
    expect(p.ipv6).toEqual({ method: "disabled" })
    expect(p.connection.autoconnect).toBe("true")
  })

  it("direktori NM kosong (tanpa profil anaconda) → pxe-native tetap dibuat", () => {
    const fx = fixture({})
    runLines(rockyNativeNoIpv4Lines(ctx(), fx.paths))
    expect(readdirSync(fx.paths.nmDir)).toEqual([`${ROCKY_NATIVE_PROFILE}.nmconnection`])
    expect(ini(fx.nm(`${ROCKY_NATIVE_PROFILE}.nmconnection`)).ipv4).toEqual({ method: "disabled" })
  })

  it("iface by name: parent = nama (bukan MAC); profil ber-MAC host tidak disentuh", () => {
    const fx = fixture({
      "eno1.nmconnection": KF.parentByName().replaceAll("enp1s0", "eno1"),
      "Wired connection 1.nmconnection": KF.parentByMac,
      "eno1.20.nmconnection": KF.vlan("eno1"),
    })
    const c = ctx({ network: { ...VLAN20, iface: { by: "name", name: "eno1" } } })
    expect(rockyKickstart(c)).toContain("network --device=eno1 --bootproto=static --ip=10.99.20.41")
    runLines(rockyNativeNoIpv4Lines(c, fx.paths))
    expect(readdirSync(fx.paths.nmDir).sort()).toEqual(
      ["Wired connection 1.nmconnection", "eno1.20.nmconnection", `${ROCKY_NATIVE_PROFILE}.nmconnection`].sort(),
    )
    expect(ini(fx.nm(`${ROCKY_NATIVE_PROFILE}.nmconnection`))).toEqual({
      connection: { id: "pxe-native", uuid: "99999999-9999-4999-8999-999999999999", type: "ethernet", autoconnect: "true", "interface-name": "eno1" },
      ipv4: { method: "disabled" },
      ipv6: { method: "disabled" },
    })
  })
})

// ---------------------------------------------------------------------------------------------
// Debian
// ---------------------------------------------------------------------------------------------

describe("AC-7.8 Debian ifupdown VLAN", () => {
  const c = ctx({ imageRepo: "debian-12" })

  it("interfaces.d/mgmt: parent inet manual + $IF.20 static (address/netmask/gateway/dns)", () => {
    expect(debianInterfacesText(c)).toBe(
      [
        "auto $IF",
        "iface $IF inet manual",
        "auto $IF.20",
        "iface $IF.20 inet static",
        "    address 10.99.20.41/24",
        "    netmask 255.255.255.0",
        "    gateway 10.99.20.1",
        "    dns-nameservers 10.99.10.2",
        "",
      ].join("\n"),
    )
    // Tanpa VLAN: hanya $IF static (M6).
    expect(debianInterfacesText(ctx({ network: { ...VLAN20, vlan: null } }))).toMatch(/^auto \$IF\niface \$IF inet static\n/)
  })

  it("late script: lookup $IF dari MAC + substitusi sungguhan menghasilkan enp1s0 / enp1s0.20", () => {
    const late = debianLateScript(c)
    expect(late).toContain(`[ "$(cat "$d/address" 2>/dev/null)" = '${MAC}' ] && IF=$(basename "$d")`)
    const line = late.split("\n").find((l) => l.includes("/etc/network/interfaces.d/mgmt"))!
    const out = path.join(tmpDir("m7-deb-if"), "mgmt")
    execFileSync("sh", ["-s"], { input: `IF=enp1s0\n${line.replace("/etc/network/interfaces.d/mgmt", out)}\n` })
    const text = readFileSync(out, "utf8")
    expect(text).toBe(debianInterfacesText(c).replaceAll("$IF", "enp1s0"))
    expect(text).toContain("auto enp1s0\niface enp1s0 inet manual\nauto enp1s0.20\niface enp1s0.20 inet static\n")
    expect(text).not.toMatch(/inet dhcp/)
  })

  it("preseed VLAN: late_command < batas, bebas token; golden late script VLAN", async () => {
    const ps = debianPreseed(c)
    const late = ps.split("\n").find((l) => l.startsWith("d-i preseed/late_command string "))!
    expect(Buffer.byteLength(late)).toBeLessThan(DEBIAN_LATE_COMMAND_MAX_BYTES)
    expect(ps).not.toContain(TOKEN)
    await expect(debianLateScript(c)).toMatchFileSnapshot("../../../test/golden/installers/debian-late-vlan.sh")
  })
})

// ---------------------------------------------------------------------------------------------
// Ubuntu
// ---------------------------------------------------------------------------------------------

describe("AC-7.7 Ubuntu netplan VLAN", () => {
  const c = ctx({ imageRepo: "ubuntu-24.04" })
  it("ethernets.mgmt tanpa alamat + vlans.mgmt.20 dengan alamat/route/DNS", () => {
    expect(ubuntuAutoinstall(c).network).toEqual({
      version: 2,
      ethernets: { mgmt: { match: { macaddress: MAC }, dhcp4: false, dhcp6: false } },
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
  it("golden user-data VLAN, bebas token", async () => {
    const ud = ubuntuUserData(c)
    expect(ud).not.toContain(TOKEN)
    await expect(ud).toMatchFileSnapshot("../../../test/golden/installers/ubuntu-user-data-vlan.yaml")
  })
})
