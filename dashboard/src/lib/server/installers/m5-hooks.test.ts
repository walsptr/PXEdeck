// M5-T5 (backend-dev, dasar): callbackBaseCmd/logCmd/logTailCmd + hook generator (plan §2.5) dan
// CR-4-5. Test menyeluruh AC-5.19–5.21 (sh terhadap cmdline palsu + curl stub, KCMD dari
// installerScript) = M5-T11 (test-engineer).
import { describe, expect, it } from "vitest"

import { localBootScript, waitScript, entryScript } from "@/lib/server/boot-script"

import { DEBIAN_LOG, debianLateScript, debianPreseed } from "./debian"
import { FIRSTBOOT_SCRIPT_TEXT } from "./firstboot"
import { ROCKY_LOG, rockyKickstart, rockyPostScript } from "./rocky"
import { callbackBaseCmd, logCmd, logTailCmd } from "./shell"
import { UBUNTU_LOG, ubuntuAutoinstall } from "./ubuntu"
import type { InstallContext } from "./context"

const MAC = "52:54:00:99:00:11"
const ctx: InstallContext = {
  jobId: "job-x",
  mac: MAC,
  hostname: "secret-host-name",
  username: "secretuser",
  passwordHash: `$6$salt$${"a".repeat(86)}`,
  sudo: true,
  disableSshPassword: true,
  network: { mode: "dhcp" },
  authorizedKeys: [],
  storage: { partition: "lvm", disk: "" },
  timezone: "UTC",
  locale: "en_US.UTF-8",
  mediaUrl: "http://10.99.0.2/media",
  imageRepo: "rocky-9",
  serverIp: "10.99.0.2",
  callbackUrl: "http://10.99.0.2/boot/x/status",
} as InstallContext

describe("helper log", () => {
  it("callbackBaseCmd memakai pola MAC + 43 karakter, tanpa 'status'", () => {
    const c = callbackBaseCmd("kickstart", MAC)
    expect(c).toMatch(/^b=\$\(tr ' ' '\\n' < \/proc\/cmdline \| sed -n '.*\/boot\/52:54:00:99:00:11\/\[A-Za-z0-9_-\]\\\{43\\\}\/.*' \| head -n 1\)$/)
    expect(c).not.toContain("status")
    expect(() => callbackBaseCmd("unattend" as "preseed", MAC)).toThrow(/metode/)
    expect(() => callbackBaseCmd("preseed", "52-54-00-99-00-11")).toThrow(/MAC/)
    expect(() => callbackBaseCmd("preseed", MAC, "/x;id")).toThrow(/Path/)
  })
  it("logCmd hanya menerima pesan konstan aman; logTailCmd menolak path tak aman", () => {
    expect(logCmd("preseed", MAC, "installer: x")).toContain(`"\${b}log"`)
    for (const bad of ["a'b", "a$(id)", "", "x\ny", "a;b"]) expect(() => logCmd("preseed", MAC, bad), bad).toThrow(/pesan/)
    expect(() => logTailCmd("preseed", MAC, ["/tmp/a b"])).toThrow(/Path/)
    expect(() => logTailCmd("preseed", MAC, ["/tmp/../etc/shadow"])).toThrow(/Path/)
  })
})

describe("hook generator", () => {
  it("Ubuntu: early, late (log sebelum configuring), error (tail lalu failed)", () => {
    const ai = ubuntuAutoinstall(ctx)
    expect(ai["early-commands"]).toEqual([logCmd("autoinstall", MAC, UBUNTU_LOG.start)])
    expect(ai["late-commands"][0]).toBe(logCmd("autoinstall", MAC, UBUNTU_LOG.late))
    expect(ai["late-commands"][1]).toContain("stage=configuring")
    expect(ai["late-commands"]).toContain(logCmd("autoinstall", MAC, UBUNTU_LOG.lateDone))
    expect(ai["error-commands"][0]).toContain("ERROR installer gagal")
    expect(ai["error-commands"][1]).toContain("stage=failed")
  })
  it("Debian early_command + late; Rocky %pre/%post/%onerror", () => {
    expect(debianPreseed(ctx)).toContain(`d-i preseed/early_command string ${logCmd("preseed", MAC, DEBIAN_LOG.start)}`)
    const late = debianLateScript(ctx).trimEnd().split("\n")
    expect(late[2]).toBe(logCmd("preseed", MAC, DEBIAN_LOG.late))
    expect(late.at(-1)).toBe(logCmd("preseed", MAC, DEBIAN_LOG.lateDone))
    const ks = rockyKickstart(ctx).split("\n")
    expect(ks[ks.indexOf("%pre") + 1]).toBe(logCmd("kickstart", MAC, ROCKY_LOG.start))
    const post = rockyPostScript(ctx).trimEnd().split("\n")
    expect(post[1]).toBe(logCmd("kickstart", MAC, ROCKY_LOG.post))
    expect(post.at(-1)).toBe(logCmd("kickstart", MAC, ROCKY_LOG.postDone))
  })
  it("pesan log tidak memuat nilai pengguna", () => {
    for (const m of [...Object.values(UBUNTU_LOG), ...Object.values(DEBIAN_LOG), ...Object.values(ROCKY_LOG)]) {
      expect(m).not.toContain("secret")
    }
  })
  it("first-boot: log via base URL file (tanpa status) sebelum done", () => {
    expect(FIRSTBOOT_SCRIPT_TEXT).toContain("base=${url%status}")
    expect(FIRSTBOOT_SCRIPT_TEXT.indexOf('"${base}log"')).toBeLessThan(FIRSTBOOT_SCRIPT_TEXT.indexOf("-d stage=done"))
  })
})

describe("CR-4-5", () => {
  it("waitScript chain --replace --autofree; semua exit = exit 1", () => {
    expect(waitScript("http://10.99.0.2", MAC, 0)).toContain("chain --replace --autofree ")
    for (const s of [entryScript("http://10.99.0.2"), localBootScript(), waitScript("http://10.99.0.2", MAC, 3)]) {
      for (const m of s.matchAll(/\bexit\b\s*(\S*)/g)) expect(m[1]).toBe("1")
    }
  })
})
