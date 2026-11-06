// DEC-026 §1 (M7): DHCP VLAN PXE tanpa router → script udhcpc d-i (`sh -e`) berhenti di
// `ip route add default via ""` sebelum menulis /etc/resolv.conf → netcfg menanyakan
// `netcfg/get_nameservers` (critical) sebelum preseed.cfg diambil. Cmdline Debian kini menjawabnya
// dengan DNS jaringan PXE (literal IPv4 dari Settings). Bukti: .agent/runs/m7/kvm/smoke/run3-debian-fix/.
import { describe, expect, it } from "vitest"

import { isolateEnv } from "@/test/env"

import { installerScript, type InstallerScriptInput } from "./boot-script"

isolateEnv()

// pxeDns sengaja ≠ serverIp agar terbukti sumber nilainya `pxeDns`, bukan PXE_SERVER_IP.
const BASE: InstallerScriptInput = {
  method: "preseed",
  source: { kernel: "debian-netboot/linux", initrd: "debian-netboot/initrd.gz", repo: "debian-12" },
  mediaUrl: "http://10.99.10.2/media",
  mediaRoot: "/srv/pxe/media",
  serverIp: "10.99.10.2",
  pxeDns: "10.99.10.53",
  configUrl: "http://10.99.10.2/boot/52:54:00:99:00:43/TOKEN_abcdefghijklmnopqrstuvwxyz0123456789ABCD/",
  extraArgs: "console=ttyS0,115200n8 console=tty0",
}

function kernelArgs(script: string): string[] {
  const k = script.split("\n").find((l) => l.startsWith("kernel "))
  expect(k).toBeDefined()
  return k!.split(" ").slice(2)
}

describe("DEC-026 §1: Debian netcfg/get_nameservers di cmdline", () => {
  it("dikirim tepat sekali dengan nilai pxeDns, SEBELUM `---`", () => {
    const args = kernelArgs(installerScript(BASE))
    expect(args.filter((a) => a.startsWith("netcfg/get_nameservers"))).toEqual(["netcfg/get_nameservers=10.99.10.53"])
    const sep = args.indexOf("---")
    expect(sep).toBe(args.length - 1)
    expect(args.indexOf("netcfg/get_nameservers=10.99.10.53")).toBeLessThan(sep)
    expect(args).not.toContain("netcfg/get_nameservers=10.99.10.2")
  })
  it("netcfg/no_default_route=true (DEC-025) tetap ada; jawaban netcfg lain tidak ditambah", () => {
    const netcfg = kernelArgs(installerScript(BASE)).filter((a) => a.startsWith("netcfg/"))
    expect(netcfg).toEqual([
      "netcfg/dhcp_timeout=60",
      "netcfg/no_default_route=true",
      "netcfg/get_nameservers=10.99.10.53",
    ])
  })
  it("selalu dikirim, tanpa bergantung extraArgs", () => {
    for (const extraArgs of ["", "console=ttyS0,115200n8"]) {
      expect(kernelArgs(installerScript({ ...BASE, extraArgs }))).toContain("netcfg/get_nameservers=10.99.10.53")
    }
  })
  it.each([
    ["kosong", ""],
    ["hostname", "dns.example"],
    ["oktet > 255", "10.99.10.256"],
    ["daftar dipisah koma", "10.99.10.53,1.1.1.1"],
    ["daftar dipisah spasi", "10.99.10.53 1.1.1.1"],
    ["spasi di depan", " 10.99.10.53"],
    ["IPv6", "fd00::53"],
    ["injeksi argumen", "10.99.10.53;priority=low"],
  ])("pxeDns tidak valid (%s) → ditolak, bukan disisipkan", (_n, pxeDns) => {
    expect(() => installerScript({ ...BASE, pxeDns })).toThrow(/DNS PXE/)
  })
  it("tidak bocor ke Ubuntu / Rocky", () => {
    const ubuntu = installerScript({
      ...BASE,
      method: "autoinstall",
      source: { kernel: "ubuntu-24.04/casper/vmlinuz", initrd: "ubuntu-24.04/casper/initrd", repo: "ubuntu-24.04" },
    })
    const rocky = installerScript({
      ...BASE,
      method: "kickstart",
      source: { kernel: "rocky-9/images/pxeboot/vmlinuz", initrd: "rocky-9/images/pxeboot/initrd.img", repo: "rocky-9" },
    })
    expect(ubuntu).not.toContain("get_nameservers")
    expect(rocky).not.toContain("get_nameservers")
    expect(ubuntu).not.toContain("10.99.10.53")
    expect(rocky).not.toContain("10.99.10.53")
  })
})
