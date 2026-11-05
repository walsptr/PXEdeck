// M6 perbaikan temuan smoke KVM dini (`.agent/runs/m6/bugs.md`):
//   BUG-M6-3  preseed Debian macet "[!!] Select your location" → language+country+locale dipreseed
//             bersama; prompt pra-instalasi lain dipreseed; hostname target ditulis di late script.
//   BUG-M6-4  DEC-020: stage2 Rocky lewat NFS (`inst.stage2=nfs:`), bukan install.img lewat HTTP ke
//             RAM; path = ekspor NFS read-only 10.99.0.0/24 di `infra/server/exports`.
//   BUG-M6-5  kickstart tanpa `repo --name=AppStream` (ISO minimal hanya `Minimal/`), mode
//             non-interaktif (`cmdline` + `inst.cmdline`) agar kegagalan memicu %onerror.
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { LOCALES } from "@/lib/host-config"
import { installerScript, type InstallerScriptInput } from "@/lib/server/boot-script"
import { TEST_TMP_ROOT } from "@/test/db"
import { SSH_ED25519 } from "@/test/fixtures"

import type { InstallContext } from "./context"
import { debianLateScript, debianPreseed, localeLines } from "./debian"
import { rockyKickstart } from "./rocky"

const MAC = "52:54:00:99:00:41"
const TOKEN = "FIXTURE-token-not-real_00000000000000000000"
const FAKE_HASH = `$6$fixturesalt$${"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789./".repeat(3).slice(0, 86)}`
const REPO_ROOT = path.resolve(__dirname, "../../../../..")

function ctx(over: Partial<InstallContext> = {}): InstallContext {
  return {
    jobId: "job-0b6c3f0e-1d2a-4c6b-9f00-000000000041",
    mac: MAC,
    hostname: "m6-node41",
    username: "ops",
    passwordHash: FAKE_HASH,
    sudo: true,
    disableSshPassword: true,
    network: { mode: "dhcp" },
    authorizedKeys: [SSH_ED25519.publicKey],
    storage: { partition: "lvm", disk: "" },
    timezone: "UTC",
    locale: "en_US.UTF-8",
    mediaUrl: "http://10.99.0.2/media",
    imageRepo: "debian-12",
    serverIp: "10.99.0.2",
    callbackUrl: `http://10.99.0.2/boot/${MAC}/${TOKEN}/status`,
    ...over,
  } as InstallContext
}
/** Nilai `d-i <key> <type> <value>` (null bila tidak ada). */
function diValue(preseed: string, key: string): { type: string; value: string } | null {
  const l = preseed.split("\n").find((x) => x.startsWith(`d-i ${key} `))
  if (!l) return null
  const [, , type, ...rest] = l.split(" ")
  return { type, value: rest.join(" ") }
}

// ---------------------------------------------------------------------------
describe("BUG-M6-3 preseed Debian tanpa prompt interaktif", () => {
  it.each(LOCALES.map((l) => [l]))("locale %s → language en, country dari locale, locale + supported-locales", (locale) => {
    const p = debianPreseed(ctx({ locale }))
    const [, lang, country] = /^([a-z]+)_([A-Z]+)\./.exec(locale)!
    expect(diValue(p, "debian-installer/language")).toEqual({ type: "string", value: "en" })
    expect(diValue(p, "debian-installer/country")).toEqual({ type: "string", value: country })
    expect(diValue(p, "debian-installer/locale")).toEqual({ type: "string", value: `${lang}_${country}.UTF-8` })
    expect(diValue(p, "localechooser/supported-locales")).toEqual({ type: "multiselect", value: locale })
  })
  it("localeLines menolak locale tak valid", () => {
    expect(() => localeLines("en_US")).toThrow(/locale/)
    expect(() => localeLines("EN_us.UTF-8")).toThrow(/locale/)
  })
  it("semua pertanyaan d-i yang muncul pada instalasi netboot + mirror DVD lokal dipreseed", () => {
    const p = debianPreseed(ctx())
    // Pertanyaan berprioritas critical/high yang ditanyakan d-i bila tidak dipreseed (localechooser,
    // keyboard, hw-detect, netcfg, mirror, user-setup, clock, partman, tasksel, popcon, grub, finish).
    const required = [
      "debian-installer/language",
      "debian-installer/country",
      "debian-installer/locale",
      "keyboard-configuration/xkb-keymap",
      "hw-detect/load_firmware",
      "netcfg/choose_interface",
      "netcfg/get_hostname",
      "netcfg/get_domain",
      "mirror/country",
      "mirror/protocol",
      "mirror/http/hostname",
      "mirror/http/directory",
      "mirror/http/proxy",
      "mirror/suite",
      "apt-setup/services-select",
      "apt-setup/cdrom/set-first",
      "passwd/root-login",
      "passwd/user-fullname",
      "passwd/username",
      "passwd/user-password-crypted",
      "clock-setup/utc",
      "time/zone",
      "partman-auto/method",
      "partman-auto/choose_recipe",
      "partman/confirm",
      "partman/confirm_nooverwrite",
      "partman-partitioning/confirm_write_new_label",
      "partman-lvm/confirm",
      "tasksel/first",
      "popularity-contest/popularity-contest",
      "grub-installer/bootdev",
      "finish-install/reboot_in_progress",
    ]
    for (const k of required) expect(diValue(p, k), k).not.toBeNull()
    expect(diValue(p, "mirror/http/hostname")!.value).toBe("10.99.0.2")
    expect(diValue(p, "mirror/http/directory")!.value).toBe("/media/debian-12")
    expect(diValue(p, "hw-detect/load_firmware")!.value).toBe("false")
  })
  it("late script menulis hostname target (preseed jaringan dimuat setelah netcfg)", () => {
    const script = debianLateScript(ctx())
    const lines = script.split("\n").filter((l) => l.includes("/etc/hostname") || l.includes("/etc/hosts"))
    expect(lines).toHaveLength(2)
    mkdirSync(TEST_TMP_ROOT, { recursive: true })
    const d = mkdtempSync(path.join(TEST_TMP_ROOT, "deb-host-"))
    try {
      mkdirSync(path.join(d, "etc"))
      const hosts = path.join(d, "etc/hosts")
      writeFileSync(hosts, "127.0.0.1\tlocalhost\n127.0.1.1\tdebian\n::1\tlocalhost\n")
      const sh = lines.join("\n").replaceAll("/etc/", `${d}/etc/`)
      const r = spawnSync("sh", ["-c", sh], { encoding: "utf8" })
      expect(r.status, r.stderr).toBe(0)
      expect(readFileSync(path.join(d, "etc/hostname"), "utf8")).toBe("m6-node41\n")
      expect(readFileSync(hosts, "utf8")).toBe("127.0.0.1\tlocalhost\n::1\tlocalhost\n127.0.1.1\tm6-node41\n")
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
const BASE: Omit<InstallerScriptInput, "method" | "source"> = {
  mediaUrl: "http://10.99.0.2/media",
  mediaRoot: "/srv/pxe/media",
  serverIp: "10.99.0.2",
  configUrl: `http://10.99.0.2/boot/${MAC}/${TOKEN}/`,
  extraArgs: "console=ttyS0,115200n8",
}
const ROCKY_SRC = { kernel: "rocky-9/images/pxeboot/vmlinuz", initrd: "rocky-9/images/pxeboot/initrd.img", repo: "rocky-9" }
const rockyKernel = () => installerScript({ ...BASE, method: "kickstart", source: ROCKY_SRC }).split("\n").find((l) => l.startsWith("kernel "))!

describe("BUG-M6-4 / DEC-020 stage2 Rocky lewat NFS", () => {
  it("kernel: inst.stage2=nfs:<server>:<media root>/<repo>; install.img tidak lewat HTTP", () => {
    const args = rockyKernel().split(" ")
    expect(args).toContain("inst.stage2=nfs:10.99.0.2:/srv/pxe/media/rocky-9")
    expect(args.filter((a) => a.startsWith("inst.repo=") || a.startsWith("inst.stage2=http"))).toEqual([])
    expect(args).toContain(`inst.ks=http://10.99.0.2/boot/${MAC}/${TOKEN}/ks.cfg`)
    // Kernel/initrd tetap HTTP (iPXE); hanya stage2 yang NFS.
    expect(args[1]).toBe("http://10.99.0.2/media/rocky-9/images/pxeboot/vmlinuz")
  })
  it("path NFS diekspor read-only hanya untuk 10.99.0.0/24 di infra/server/exports", () => {
    const nfsPath = /inst\.stage2=nfs:10\.99\.0\.2:(\S+)/.exec(rockyKernel())![1]
    const exportsTxt = readFileSync(path.join(REPO_ROOT, "infra/server/exports"), "utf8")
    const line = exportsTxt.split("\n").find((l) => l.split(/\s+/)[0] === nfsPath)
    expect(line, `ekspor ${nfsPath}`).toBeDefined()
    expect(line).toMatch(/^\S+ 10\.99\.0\.0\/24\((?=[^)]*\bro\b)(?![^)]*\brw\b)[^)]*\)$/)
    const env = readFileSync(path.join(REPO_ROOT, "infra/server/dashboard.env"), "utf8")
    expect(env).toMatch(/^PXE_MEDIA_ROOT=\/srv\/pxe\/media$/m)
    expect(env).toMatch(/^PXE_SERVER_IP=10\.99\.0\.2$/m)
  })
  it("nilai server/media root tidak aman tetap ditolak", () => {
    expect(() => installerScript({ ...BASE, serverIp: "10.99.0.2 x", method: "kickstart", source: ROCKY_SRC })).toThrow(/tidak aman/)
    expect(() => installerScript({ ...BASE, mediaRoot: "/srv pxe", method: "kickstart", source: ROCKY_SRC })).toThrow(/tidak aman/)
  })
})

// ---------------------------------------------------------------------------
/** Isi repo `Minimal/` ISO Rocky 9.8 minimal (diperiksa dengan bsdtar atas .agent/media, bugs.md BUG-M6-5). */
const MINIMAL_GROUPS = ["minimal-environment", "core", "base"]
const MINIMAL_PACKAGES = ["curl", "openssh-server", "sudo"]

describe("BUG-M6-5 kickstart sesuai media minimal + non-interaktif", () => {
  const ks = rockyKickstart(ctx({ imageRepo: "rocky-9" }))
  const lines = ks.split("\n")
  it("satu sumber `url` root media; tanpa `repo` BaseOS/AppStream", () => {
    expect(lines.filter((l) => l.startsWith("url "))).toEqual(["url --url=http://10.99.0.2/media/rocky-9"])
    expect(lines.filter((l) => /^repo\b/.test(l))).toEqual([])
    expect(ks).not.toMatch(/AppStream|BaseOS/)
  })
  it("%packages hanya grup/paket yang ada di repo Minimal", () => {
    const pk = lines.slice(lines.indexOf("%packages") + 1, lines.indexOf("%end", lines.indexOf("%packages")))
    expect(pk.length).toBeGreaterThan(0)
    for (const p of pk) {
      if (p.startsWith("@^") || p.startsWith("@")) expect(MINIMAL_GROUPS, p).toContain(p.replace(/^@\^?/, ""))
      else expect(MINIMAL_PACKAGES, p).toContain(p)
    }
    expect(pk).toEqual(expect.arrayContaining(["openssh-server", "curl", "sudo"]))
  })
  it("mode cmdline (kickstart + kernel) agar kegagalan → %onerror, bukan menunggu UI", () => {
    expect(lines).toContain("cmdline")
    expect(lines.filter((l) => /^(text|graphical)\b/.test(l))).toEqual([])
    const args = rockyKernel().split(" ")
    expect(args).toContain("inst.cmdline")
    expect(args.filter((a) => a === "inst.text" || a === "inst.graphical")).toEqual([])
    const on = lines.indexOf("%onerror")
    expect(on).toBeGreaterThan(-1)
    const body = lines.slice(on + 1, lines.indexOf("%end", on)).join("\n")
    expect(body).toContain("stage=failed")
  })
})
