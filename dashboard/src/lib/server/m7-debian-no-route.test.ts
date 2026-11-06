// DEC-025 §1 (M7): DHCP VLAN PXE sengaja tanpa router (DEC-024 §3). d-i netcfg menanyakan
// "Continue without a default route?" (critical, sebelum preseed.cfg diambil) kecuali
// `netcfg/no_default_route=true` ada di cmdline kernel. Selalu dikirim: netcfg hanya membaca template
// ini bila DHCP tidak memberi gateway, sehingga topologi flat M6 (ada router) tidak berubah.
import { describe, expect, it } from "vitest"

import { isolateEnv } from "@/test/env"

import { installerScript, type InstallerScriptInput } from "./boot-script"
import type { InstallContext } from "./installers/context"
import { debianPreseed } from "./installers/debian"

isolateEnv()

const BASE: InstallerScriptInput = {
  method: "preseed",
  source: { kernel: "debian-netboot/linux", initrd: "debian-netboot/initrd.gz", repo: "debian-12" },
  mediaUrl: "http://10.99.0.2/media",
  mediaRoot: "/srv/pxe/media",
  serverIp: "10.99.0.2",
  pxeDns: "10.99.0.2",
  configUrl: "http://10.99.0.2/boot/52:54:00:99:00:43/TOKEN_abcdefghijklmnopqrstuvwxyz0123456789ABCD/",
  extraArgs: "console=ttyS0,115200n8",
}

function kernelArgs(script: string): string[] {
  const k = script.split("\n").find((l) => l.startsWith("kernel "))
  expect(k).toBeDefined()
  return k!.split(" ").slice(2)
}

describe("DEC-025 §1: Debian netcfg/no_default_route", () => {
  it("cmdline Debian memuat netcfg/no_default_route=true tepat sekali, SEBELUM `---`", () => {
    const args = kernelArgs(installerScript(BASE))
    expect(args.filter((a) => a.startsWith("netcfg/no_default_route"))).toEqual(["netcfg/no_default_route=true"])
    const sep = args.indexOf("---")
    expect(sep).toBe(args.length - 1)
    expect(args.indexOf("netcfg/no_default_route=true")).toBeLessThan(sep)
  })
  it("selalu dikirim, tanpa bergantung extraArgs (topologi flat maupun VLAN memakai script yang sama)", () => {
    for (const extraArgs of ["", "console=ttyS0,115200n8 console=tty0"]) {
      expect(kernelArgs(installerScript({ ...BASE, extraArgs }))).toContain("netcfg/no_default_route=true")
    }
  })
  it("tidak bocor ke metode lain (Ubuntu / Rocky)", () => {
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
    expect(ubuntu).not.toContain("no_default_route")
    expect(rocky).not.toContain("no_default_route")
  })
  it("preseed.cfg juga menjawab netcfg/no_default_route=true (re-run netcfg setelah preseed dimuat)", () => {
    const ctx: InstallContext = {
      jobId: "job-0b6c3f0e-1d2a-4c6b-9f00-000000000043",
      mac: "52:54:00:99:00:43",
      hostname: "m7-node43",
      username: "ops",
      passwordHash: `$6$fixturesalt$${"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789./".repeat(3).slice(0, 86)}`,
      sudo: true,
      disableSshPassword: true,
      network: { mode: "dhcp" },
      authorizedKeys: [],
      storage: { partition: "auto", disk: "" },
      timezone: "Asia/Jakarta",
      locale: "en_US.UTF-8",
      mediaUrl: "http://10.99.0.2/media",
      imageRepo: "debian-12",
      serverIp: "10.99.0.2",
      callbackUrl: "http://10.99.0.2/boot/52:54:00:99:00:43/FIXTURE-token-not-real_00000000000000000000/status",
    }
    const lines = debianPreseed(ctx).split("\n")
    expect(lines.filter((l) => l.includes("netcfg/no_default_route"))).toEqual(["d-i netcfg/no_default_route boolean true"])
  })
})
