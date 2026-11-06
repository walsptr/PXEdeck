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

// ---------------------------------------------------------------------------
// BUG-M6-6 / BUG-M6-7: pemilihan & validasi disk saat runtime, dijalankan `sh` dengan stub
// (list-devices/lsblk/debconf-set/curl/wget) dan root palsu. Seam test: `[ -b` → `[ -e` (tidak bisa
// membuat block device tanpa root), `/sys/block/`, `/dev/`, `/tmp/pxe-disk.ks` → direktori sementara.
const KCMD_URL = `url=http://10.99.0.2/boot/${MAC}/${TOKEN}/preseed.cfg`
const KCMD_KS = `inst.ks=http://10.99.0.2/boot/${MAC}/${TOKEN}/ks.cfg`
type RunResult = { code: number; calls: string[]; debconf: string[]; include: string | null; d: string }

function runDisk(script: (d: string) => string, opts: { kcmd: string; disks: { name: string; removable: boolean }[]; lsblk?: string }): RunResult {
  mkdirSync(TEST_TMP_ROOT, { recursive: true })
  const d = mkdtempSync(path.join(TEST_TMP_ROOT, "disk-"))
  try {
    for (const sub of ["bin", "dev", "sys/block", "tmp"]) mkdirSync(path.join(d, sub), { recursive: true })
    for (const k of opts.disks) {
      writeFileSync(path.join(d, "dev", k.name), "")
      mkdirSync(path.join(d, "sys/block", k.name))
      writeFileSync(path.join(d, "sys/block", k.name, "removable"), k.removable ? "1\n" : "0\n")
    }
    const rec = path.join(d, "rec.txt")
    const stub = (name: string, body: string) => {
      writeFileSync(path.join(d, "bin", name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    }
    stub("curl", `i=$(cat | tr '\\n' ' '); printf 'curl %s | %s\\n' "$*" "$i" >> ${rec}; exit 0`)
    stub("wget", `printf 'wget %s\\n' "$*" >> ${rec}; exit 0`)
    stub("debconf-set", `printf 'debconf %s %s\\n' "$1" "$2" >> ${rec}`)
    stub("list-devices", `[ "$1" = disk ] && for x in ${opts.disks.map((k) => `${d}/dev/${k.name}`).join(" ")}; do echo "$x"; done; true`)
    writeFileSync(path.join(d, "lsblk.out"), opts.lsblk ?? "")
    stub("lsblk", `cat ${path.join(d, "lsblk.out")}`)
    writeFileSync(path.join(d, "cmdline"), `initrd=initrd ${opts.kcmd} console=ttyS0\n`)
    const sh = script(d).replaceAll("/proc/cmdline", path.join(d, "cmdline"))
    const r = spawnSync("sh", ["-c", sh], { encoding: "utf8", env: { PATH: `${d}/bin:/usr/bin:/bin` } as unknown as NodeJS.ProcessEnv, timeout: 20_000 })
    const lines = (() => {
      try {
        return readFileSync(rec, "utf8").trimEnd().split("\n")
      } catch {
        return []
      }
    })()
    const inc = path.join(d, "tmp/pxe-disk.ks")
    let include: string | null = null
    try {
      include = readFileSync(inc, "utf8")
    } catch {
      include = null
    }
    return { code: r.status ?? -1, calls: lines.filter((l) => !l.startsWith("debconf ")), debconf: lines.filter((l) => l.startsWith("debconf ")), include, d }
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

describe("BUG-M6-6 Debian partman/early_command memilih/memvalidasi disk", () => {
  const cmd = (disk: string) => {
    const p = debianPreseed(ctx({ storage: { partition: "lvm", disk } }))
    const l = p.split("\n").find((x) => x.startsWith("d-i partman/early_command string "))!
    return l.slice("d-i partman/early_command string ".length)
  }
  const seam = (c: string) => (d: string) =>
    c.replaceAll("[ -b ", "[ -e ").replaceAll("/sys/block/", `${d}/sys/block/`).replace(/^d='\/dev\//, `d='${d}/dev/`)
  it("preseed: partman/early_command ada, partman-auto/disk tidak statis, konfirmasi partman lengkap", () => {
    for (const disk of ["", "/dev/vda"]) {
      const p = debianPreseed(ctx({ storage: { partition: "lvm", disk } }))
      expect(p).toContain("d-i partman/early_command string ")
      expect(p).not.toMatch(/^d-i partman-auto\/disk /m)
      for (const k of [
        "partman-partitioning/confirm_write_new_label",
        "partman/choose_partition",
        "partman/confirm",
        "partman/confirm_nooverwrite",
        "partman-efi/non_efi_system",
        "partman-lvm/confirm",
        "partman-lvm/confirm_nooverwrite",
        "partman-lvm/device_remove_lvm",
        "partman-auto-lvm/guided_size",
        "partman-auto/choose_recipe",
        "partman-partitioning/choose_label",
      ])
        expect(diValue(p, k), k).not.toBeNull()
    }
  })
  it("otomatis: disk pertama non-removable → debconf-set partman-auto/disk + grub bootdev, log", () => {
    const r = runDisk(seam(cmd("")), { kcmd: KCMD_URL, disks: [{ name: "sda", removable: true }, { name: "vda", removable: false }, { name: "vdb", removable: false }] })
    expect(r.code).toBe(0)
    expect(r.debconf).toEqual([`debconf partman-auto/disk ${r.d}/dev/vda`, `debconf grub-installer/bootdev ${r.d}/dev/vda`])
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]).toContain(`http://10.99.0.2/boot/${MAC}/${TOKEN}/log`)
    expect(r.calls.join("\n")).not.toContain("stage=failed")
  })
  it("eksplisit ada → dipakai apa adanya", () => {
    const r = runDisk(seam(cmd("/dev/vdb")), { kcmd: KCMD_URL, disks: [{ name: "vda", removable: false }, { name: "vdb", removable: false }] })
    expect(r.code).toBe(0)
    expect(r.debconf).toEqual([`debconf partman-auto/disk ${r.d}/dev/vdb`, `debconf grub-installer/bootdev ${r.d}/dev/vdb`])
  })
  it.each([
    ["eksplisit tidak ada (/dev/vdz)", "/dev/vdz", [{ name: "vda", removable: false }]],
    ["otomatis tanpa disk non-removable", "", [{ name: "sda", removable: true }]],
  ])("%s → log ERROR + stage=failed, exit 1, tanpa debconf-set", (_n, disk, disks) => {
    const r = runDisk(seam(cmd(disk)), { kcmd: KCMD_URL, disks })
    expect(r.code).toBe(1)
    expect(r.debconf).toEqual([])
    expect(r.calls.some((c) => c.includes("ERROR installer gagal: disk target tidak ditemukan"))).toBe(true)
    expect(r.calls.at(-1)).toContain("stage=failed")
    expect(r.calls.at(-1)).toContain(`http://10.99.0.2/boot/${MAC}/${TOKEN}/status`)
  })
})

describe("BUG-M6-7 Rocky %pre memilih/memvalidasi disk", () => {
  const preBody = (disk: string) => {
    const ks = rockyKickstart(ctx({ imageRepo: "rocky-9", storage: { partition: "lvm", disk } })).split("\n")
    const i = ks.indexOf("%pre --erroronfail")
    expect(i).toBeGreaterThan(-1)
    return { ks, body: ks.slice(i + 1, ks.indexOf("%end", i)).join("\n") }
  }
  const seam = (c: string) => (d: string) =>
    c
      .replaceAll("[ -b ", "[ -e ")
      .replaceAll("p=/dev/$n", `p=${d}/dev/$n`)
      .replaceAll("${p#/dev/}", "${p##*/dev/}")
      .replaceAll("/tmp/pxe-disk.ks", `${d}/tmp/pxe-disk.ks`)
      .replace(/^p='\/dev\//m, `p='${d}/dev/`)
  const LSBLK = "zram0 disk 0\nsr0 rom 1\nsda disk 1\nvda disk 0\nvdb disk 0\n"
  it("kickstart: otomatis → %include, eksplisit → ignoredisk/clearpart statis; tanpa clearpart semua disk", () => {
    const auto = preBody("").ks
    expect(auto).toContain("%include /tmp/pxe-disk.ks")
    expect(auto.filter((l) => /^(clearpart|ignoredisk)\b/.test(l))).toEqual([])
    const exp = preBody("/dev/vda").ks
    expect(exp).not.toContain("%include /tmp/pxe-disk.ks")
    expect(exp).toEqual(expect.arrayContaining(["ignoredisk --only-use=vda", "clearpart --all --initlabel --drives=vda"]))
  })
  it("otomatis: disk pertama non-removable selain zram → include untuk disk itu saja", () => {
    const r = runDisk(seam(preBody("").body), { kcmd: KCMD_KS, disks: [{ name: "vda", removable: false }], lsblk: LSBLK })
    expect(r.code).toBe(0)
    expect(r.include).toBe("ignoredisk --only-use=vda\nclearpart --all --initlabel --drives=vda\n")
    expect(r.calls.join("\n")).not.toContain("stage=failed")
    expect(r.calls).toHaveLength(2) // log mulai + log disk dipilih
  })
  it("eksplisit ada → lanjut tanpa include", () => {
    const r = runDisk(seam(preBody("/dev/vda").body), { kcmd: KCMD_KS, disks: [{ name: "vda", removable: false }] })
    expect(r.code).toBe(0)
    expect(r.include).toBeNull()
    expect(r.calls.join("\n")).not.toContain("stage=failed")
  })
  it.each([
    ["eksplisit tidak ada (/dev/vdz)", "/dev/vdz", LSBLK],
    ["otomatis tanpa disk", "", "zram0 disk 0\nsr0 rom 1\n"],
  ])("%s → log ERROR + stage=failed, exit 1 (%pre --erroronfail menghentikan anaconda)", (_n, disk, lsblk) => {
    const r = runDisk(seam(preBody(disk).body), { kcmd: KCMD_KS, disks: [{ name: "vda", removable: false }], lsblk })
    expect(r.code).toBe(1)
    expect(r.include).toBeNull()
    expect(r.calls.some((c) => c.includes("ERROR installer gagal: disk target tidak ditemukan"))).toBe(true)
    expect(r.calls.at(-1)).toContain("stage=failed")
    expect(r.calls.at(-1)).toContain(`http://10.99.0.2/boot/${MAC}/${TOKEN}/status`)
  })
  it("kernel Rocky: console serial terakhir (/dev/console = ttyS0); urutan lain tetap", () => {
    const k = installerScript({ ...BASE, extraArgs: "console=ttyS0,115200n8 console=tty0 quiet", method: "kickstart", source: ROCKY_SRC })
      .split("\n")
      .find((l) => l.startsWith("kernel "))!
    expect(k.endsWith("inst.cmdline console=tty0 quiet console=ttyS0,115200n8")).toBe(true)
    const deb = installerScript({ ...BASE, extraArgs: "console=ttyS0,115200n8 console=tty0", method: "preseed", source: { kernel: "d/linux", initrd: "d/initrd.gz", repo: "debian-12" } })
    expect(deb).toContain("console=ttyS0,115200n8 console=tty0 ---")
  })
})
