// M5-T11 (test-engineer): hook log installer dijalankan `sh` sungguhan (AC-5.19) dan cmdline
// evaluasi callback DITURUNKAN dari output installerScript() nyata (AC-5.20, CR-4-4).
//
// Cmdline kernel palsu = argumen baris `kernel` dari installerScript (bukan konstanta tulis-tangan),
// ditulis ke file sementara di dalam project; `/proc/cmdline` di perintah generator diarahkan ke
// file itu. `curl`/`wget` diganti stub di PATH yang mencatat argv + stdin (tanpa jaringan).
import { describe, expect, it } from "vitest"

import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import { installerScript } from "@/lib/server/boot-script"
import { containsSecret, evalCallbackUrl } from "@/test/cmdline"
import { TEST_TMP_ROOT } from "@/test/db"
import { SSH_ED25519 } from "@/test/fixtures"

import type { InstallContext } from "./context"
import { DEBIAN_LOG, debianLateScript, debianPreseed } from "./debian"
import { FIRSTBOOT_SCRIPT_TEXT } from "./firstboot"
import { ROCKY_ERROR_LOGS, ROCKY_LOG, rockyKickstart, rockyPostScript } from "./rocky"
import { callbackCmd, logCmd, type CmdlineMethod } from "./shell"
import { UBUNTU_ERROR_LOGS, UBUNTU_LOG, ubuntuAutoinstall, ubuntuUserData } from "./ubuntu"

const MAC = "52:54:00:99:00:11"
const OTHER_MAC = "52:54:00:99:00:12"
const TOKEN = "Te5t-token_only-for-unit-tests-0123456789ab" // 43 karakter base64url (dummy)
if (TOKEN.length !== 43) throw new Error("TOKEN 43")
const BASE = "http://10.99.0.2"
const HOSTNAME = "rahasia-host-uji"
const USERNAME = "penggunauji"
const FAKE_HASH = `$6$fixturesalt$${"Zy9".repeat(29).slice(0, 86)}`

const IMAGES: Record<CmdlineMethod, { kernel: string; initrd: string; repo: string }> = {
  autoinstall: { kernel: "ubuntu-24.04/casper/vmlinuz", initrd: "ubuntu-24.04/casper/initrd", repo: "ubuntu-24.04" },
  preseed: { kernel: "debian-netboot/linux", initrd: "debian-netboot/initrd.gz", repo: "debian-12" },
  kickstart: { kernel: "rocky-9/images/pxeboot/vmlinuz", initrd: "rocky-9/images/pxeboot/initrd.img", repo: "rocky-9" },
}

/** Script iPXE installer nyata untuk `method` (token & MAC di URL konfigurasi). */
function realScript(method: CmdlineMethod, mac = MAC, token = TOKEN): string {
  return installerScript({
    method,
    mediaUrl: `${BASE}/media`,
    mediaRoot: "/srv/pxe/media",
    serverIp: "10.99.0.2",
    configUrl: `${BASE}/boot/${mac}/${token}/`,
    source: IMAGES[method],
    extraArgs: "console=ttyS0,115200n8 console=tty0",
  })
}
/**
 * Cmdline kernel yang dilihat installer di /proc/cmdline = argumen baris `kernel <url> …` dari
 * script iPXE (iPXE meneruskan semua token setelah URL kernel apa adanya).
 */
function kcmdFromScript(script: string): string {
  const k = script.split("\n").find((l) => l.startsWith("kernel "))
  if (!k) throw new Error(`tanpa baris kernel:\n${script}`)
  return k.split(" ").slice(2).join(" ")
}
const kcmd = (method: CmdlineMethod, mac = MAC, token = TOKEN) => kcmdFromScript(realScript(method, mac, token))

function ctx(over: Partial<InstallContext> = {}): InstallContext {
  return {
    jobId: "job-0b6c3f0e-1d2a-4c6b-9f00-000000000011",
    mac: MAC,
    hostname: HOSTNAME,
    username: USERNAME,
    passwordHash: FAKE_HASH,
    sudo: true,
    disableSshPassword: true,
    network: { mode: "static", ip: "10.99.0.21", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2"], vlan: null, iface: { by: "mac" } },
    authorizedKeys: [SSH_ED25519.publicKey],
    storage: { partition: "lvm", disk: "/dev/vda" },
    timezone: "UTC",
    locale: "en_US.UTF-8",
    mediaUrl: `${BASE}/media`,
    imageRepo: "ubuntu-24.04",
    serverIp: "10.99.0.2",
    // Generator tidak boleh memakai URL ber-token ini (B-5); dipasang agar kebocoran terdeteksi.
    callbackUrl: `${BASE}/boot/${MAC}/${TOKEN}/status`,
    ...over,
  } as InstallContext
}

type Call = { prog: string; argv: string[]; stdin: string }

/**
 * Jalankan `cmd` dengan `sh -c` (cmdline palsu, stub curl/wget). `files` dipetakan: path asli di
 * perintah → isi file sementara. Mengembalikan request yang tercatat + exit code.
 */
function runSh(cmd: string, kernelCmdline: string, files: Record<string, string> = {}, env: Record<string, string> = {}): { calls: Call[]; code: number; stderr: string } {
  mkdirSync(TEST_TMP_ROOT, { recursive: true })
  const d = mkdtempSync(path.join(TEST_TMP_ROOT, "hooks-"))
  try {
    const bin = path.join(d, "bin")
    const rec = path.join(d, "rec")
    mkdirSync(bin)
    mkdirSync(rec)
    for (const prog of ["curl", "wget"]) {
      const f = path.join(bin, prog)
      writeFileSync(
        f,
        `#!/bin/sh\nn=$(ls "$REC" | wc -l)\nn=$((n / 3))\nprintf '%s' "${prog}" > "$REC/$n.prog"\n: > "$REC/$n.argv"\nfor a in "$@"; do printf '%s\\n' "$a" >> "$REC/$n.argv"; done\ncat > "$REC/$n.stdin"\nexit 0\n`,
      )
      chmodSync(f, 0o755)
    }
    const cmdlineFile = path.join(d, "cmdline")
    writeFileSync(cmdlineFile, `${kernelCmdline}\n`)
    let script = cmd.replaceAll("/proc/cmdline", cmdlineFile)
    for (const [orig, content] of Object.entries(files)) {
      const f = path.join(d, `f${Object.keys(files).indexOf(orig)}`)
      writeFileSync(f, content)
      script = script.replaceAll(orig, f)
    }
    const r = spawnSync("sh", ["-c", script], {
      encoding: "utf8",
      input: "",
      env: { PATH: `${bin}:/usr/bin:/bin`, REC: rec, ...env } as unknown as NodeJS.ProcessEnv,
      timeout: 20_000,
    })
    const n = readdirSync(rec).filter((f) => f.endsWith(".prog")).length
    const calls: Call[] = Array.from({ length: n }, (_, i) => ({
      prog: readFileSync(path.join(rec, `${i}.prog`), "utf8"),
      argv: readFileSync(path.join(rec, `${i}.argv`), "utf8").replace(/\n$/, "").split("\n"),
      stdin: existsSync(path.join(rec, `${i}.stdin`)) ? readFileSync(path.join(rec, `${i}.stdin`), "utf8") : "",
    }))
    return { calls, code: r.status ?? -1, stderr: r.stderr }
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}
const url = (c: Call) => c.argv.at(-1)
const LOG_URL = `${BASE}/boot/${MAC}/${TOKEN}/log`
const STATUS_URL = `${BASE}/boot/${MAC}/${TOKEN}/status`
const msgOf = (cmd: string) => /printf '%s\\n' '([^']*)'/.exec(cmd)?.[1] ?? null

// ---------------------------------------------------------------------------
describe("AC-5.20 CR-4-4: cmdline evaluasi callback diturunkan dari installerScript() nyata", () => {
  it.each(["autoinstall", "preseed", "kickstart"] as const)("%s: baris kernel → URL status <base>/boot/<mac>/<token>/status", (method) => {
    const script = realScript(method)
    const k = kcmdFromScript(script)
    expect(k).not.toMatch(/^https?:/) // URL kernel tidak ikut
    expect(evalCallbackUrl(callbackCmd(method, MAC, "configuring"), k)).toBe(STATUS_URL)
    expect(evalCallbackUrl(callbackCmd(method, MAC, "failed"), k)).toBe(STATUS_URL)
  })
  it.each([
    ["kickstart", "inst.ks=", "ks="],
    ["preseed", " url=", " preseed/url="],
    ["autoinstall", "ds=nocloud-net;s=", "ds=nocloud;s="],
  ] as const)("negatif %s: script dimutasi (%s → %s) → evaluasi gagal (kopling terdeteksi)", (method, from, to) => {
    const mutated = realScript(method).replace(from, to)
    expect(mutated).not.toBe(realScript(method))
    expect(evalCallbackUrl(callbackCmd(method, MAC, "configuring"), kcmdFromScript(mutated))).toBe("")
  })
  it("cmdline MAC lain / token 42 karakter → URL kosong", () => {
    expect(evalCallbackUrl(callbackCmd("autoinstall", MAC, "done"), kcmd("autoinstall", OTHER_MAC))).toBe("")
    expect(evalCallbackUrl(callbackCmd("kickstart", MAC, "done"), kcmd("kickstart", MAC, TOKEN.slice(0, 42)).replace(TOKEN.slice(0, 42), TOKEN.slice(0, 42)))).toBe("")
  })
})

describe("AC-5.19 hook log dijalankan sh terhadap cmdline palsu (stub curl)", () => {
  const ai = ubuntuAutoinstall(ctx())
  const late = ai["late-commands"] as string[]

  it("Ubuntu early-commands → POST <base>/log berisi penanda mulai", () => {
    expect(ai["early-commands"]).toHaveLength(1)
    const r = runSh(ai["early-commands"][0], kcmd("autoinstall"))
    expect(r.code).toBe(0)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]).toMatchObject({ prog: "curl", stdin: `${UBUNTU_LOG.start}\n` })
    expect(url(r.calls[0])).toBe(LOG_URL)
    expect(r.calls[0].argv).toEqual(expect.arrayContaining(["--data-binary", "@-", "Content-Type: text/plain"]))
  })
  it("Ubuntu late-commands: log 'late-commands mulai' SEBELUM callback configuring; penanda selesai di akhir", () => {
    const iLog = late.indexOf(logCmd("autoinstall", MAC, UBUNTU_LOG.late))
    const iCfg = late.findIndex((c) => c.includes("stage=configuring"))
    const iDone = late.indexOf(logCmd("autoinstall", MAC, UBUNTU_LOG.lateDone))
    expect(iLog).toBeGreaterThanOrEqual(0)
    expect(iLog).toBeLessThan(iCfg)
    expect(iCfg).toBeLessThan(iDone)
    const k = kcmd("autoinstall")
    const seq = [late[iLog], late[iCfg], late[iDone]].map((c) => runSh(c, k))
    expect(seq.map((r) => r.code)).toEqual([0, 0, 0])
    expect(seq.map((r) => r.calls.map(url))).toEqual([[LOG_URL], [STATUS_URL], [LOG_URL]])
    expect(seq[0].calls[0].stdin).toBe(`${UBUNTU_LOG.late}\n`)
    expect(seq[1].calls[0].argv).toEqual(expect.arrayContaining(["-X", "POST", "-d", "stage=configuring"]))
    expect(seq[2].calls[0].stdin).toBe(`${UBUNTU_LOG.lateDone}\n`)
  })
  it("Ubuntu error-commands: tail log (berurutan) lalu callback failed", () => {
    const err = ai["error-commands"] as string[]
    expect(err).toHaveLength(2)
    const files = Object.fromEntries(UBUNTU_ERROR_LOGS.map((f, i) => [f, `baris log ${i}\n${"x".repeat(300)}\n`]))
    const r = runSh(err.join("\n"), kcmd("autoinstall"), files)
    expect(r.code).toBe(0)
    expect(r.calls.map(url)).toEqual([...UBUNTU_ERROR_LOGS.map(() => LOG_URL), STATUS_URL])
    for (const [i, f] of UBUNTU_ERROR_LOGS.entries()) {
      const body = r.calls[i].stdin.split("\n")
      expect(body[0]).toMatch(/^ERROR installer gagal: /)
      expect(body[1]).toBe(`baris log ${i}`)
      expect(body[2].length).toBeLessThanOrEqual(240) // dipotong cut -c
      expect(f).toMatch(/^\/var\/log\//)
    }
    expect(r.calls.at(-1)!.argv).toEqual(expect.arrayContaining(["-d", "stage=failed"]))
  })
  it("Ubuntu error-commands tanpa file log → hanya callback failed, exit 0", () => {
    const r = runSh((ai["error-commands"] as string[]).join("\n"), kcmd("autoinstall"))
    expect(r.code).toBe(0)
    expect(r.calls.map(url)).toEqual([STATUS_URL])
  })
  it("Debian early_command + late (log sebelum configuring, penanda di akhir)", () => {
    const ps = debianPreseed(ctx({ imageRepo: "debian-12" }))
    const early = /^d-i preseed\/early_command string (.*)$/m.exec(ps)![1]
    const k = kcmd("preseed")
    const r0 = runSh(early, k)
    // M6 (BUG-M6-8): setelah log mulai, early_command mengunduh driver disk virtio dari media
    // (tanpa token) untuk insmod — panggilan berikutnya hanya ke path media itu.
    expect([url(r0.calls[0]), r0.calls[0].stdin]).toEqual([LOG_URL, `${DEBIAN_LOG.start}\n`])
    // (Di host test, /sys/module asli dipakai: modul yang sudah ada dilewati, lalu log "modul dimuat".)
    for (const c of r0.calls.slice(1)) {
      if (url(c) === LOG_URL) expect(c.stdin).toBe(`${DEBIAN_LOG.modules}\n`)
      else expect([c.prog, url(c)]).toEqual(["wget", expect.stringMatching(/^http:\/\/[^/]+\/media\/debian-netboot\/modules\/[^/]+\/virtio_(blk|scsi)\.ko$/)])
    }
    const lateLines = debianLateScript(ctx({ imageRepo: "debian-12" })).trimEnd().split("\n")
    const iLog = lateLines.indexOf(logCmd("preseed", MAC, DEBIAN_LOG.late))
    const iCfg = lateLines.findIndex((l) => l.includes("stage=configuring"))
    const iDone = lateLines.indexOf(logCmd("preseed", MAC, DEBIAN_LOG.lateDone))
    expect(iLog).toBeLessThan(iCfg)
    expect(iCfg).toBeLessThan(iDone)
    const rs = [lateLines[iLog], lateLines[iCfg], lateLines[iDone]].map((c) => runSh(c, k))
    expect(rs.map((r) => r.calls.map(url))).toEqual([[LOG_URL], [STATUS_URL], [LOG_URL]])
  })
  it("Rocky %pre, %post (log sebelum configuring + akhir), %onerror (tail lalu failed)", () => {
    const ks = rockyKickstart(ctx({ imageRepo: "rocky-9" })).split("\n")
    const k = kcmd("kickstart")
    const pre = ks[ks.indexOf("%pre --erroronfail") + 1] /* M6 BUG-M6-7: header %pre --erroronfail */
    expect(runSh(pre, k).calls.map((c) => [url(c), c.stdin])).toEqual([[LOG_URL, `${ROCKY_LOG.start}\n`]])
    const post = rockyPostScript(ctx({ imageRepo: "rocky-9" })).trimEnd().split("\n")
    const iLog = post.indexOf(logCmd("kickstart", MAC, ROCKY_LOG.post))
    const iCfg = post.findIndex((l) => l.includes("stage=configuring"))
    const iDone = post.indexOf(logCmd("kickstart", MAC, ROCKY_LOG.postDone))
    expect(iLog).toBeLessThan(iCfg)
    expect(iCfg).toBeLessThan(iDone)
    expect([post[iLog], post[iCfg], post[iDone]].map((c) => runSh(c, k).calls.map(url))).toEqual([[LOG_URL], [STATUS_URL], [LOG_URL]])
    const on = ks.indexOf("%onerror")
    const body = ks.slice(on + 1, ks.indexOf("%end", on))
    const files = Object.fromEntries(ROCKY_ERROR_LOGS.map((f) => [f, "anaconda gagal\n"]))
    const r = runSh(body.join("\n"), k, files)
    expect(r.code).toBe(0)
    expect(r.calls.map(url)).toEqual([...ROCKY_ERROR_LOGS.map(() => LOG_URL), STATUS_URL])
    expect(r.calls.at(-1)!.argv).toEqual(expect.arrayContaining(["-d", "stage=failed"]))
  })
  it("first-boot: log 'OS terpasang' ke <base>/log lalu stage=done ke <base>/status, file URL dihapus", () => {
    // Root palsu: /etc/pxe-callback/url → file sementara; systemctl/rm diarahkan ke stub aman.
    mkdirSync(TEST_TMP_ROOT, { recursive: true })
    const d = mkdtempSync(path.join(TEST_TMP_ROOT, "fb-"))
    try {
      mkdirSync(path.join(d, "etc/pxe-callback"), { recursive: true })
      writeFileSync(path.join(d, "etc/pxe-callback/url"), `${STATUS_URL}\n`)
      const script = FIRSTBOOT_SCRIPT_TEXT.replaceAll("/etc/pxe-callback", path.join(d, "etc/pxe-callback"))
        .replaceAll("/etc/systemd/system/", path.join(d, "sys") + "/")
        .replaceAll("/usr/local/sbin/", path.join(d, "sbin") + "/")
        .replace("systemctl disable", "true")
      const r = runSh(script, "", {}, {})
      expect(r.code).toBe(0)
      expect(r.calls.map(url)).toEqual([LOG_URL, STATUS_URL])
      expect(r.calls[0].stdin).toMatch(/^first-boot: OS terpasang boot dari disk: /)
      expect(r.calls[1].argv).toEqual(expect.arrayContaining(["-d", "stage=done"]))
      expect(existsSync(path.join(d, "etc/pxe-callback"))).toBe(false)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
  it.each([
    ["MAC lain", () => kcmd("autoinstall", OTHER_MAC)],
    ["token 42 karakter", () => kcmd("autoinstall", MAC, TOKEN.slice(0, 42))],
    ["token 44 karakter", () => kcmd("autoinstall", MAC, `${TOKEN}x`)],
    ["cmdline tanpa parameter", () => "ip=dhcp quiet"],
  ])("%s → tidak ada request, exit 0 (installer tidak gagal)", (_n, k) => {
    const cmds = [ai["early-commands"][0], ...late.filter((c) => c.includes("${b}log") || c.includes("stage=configuring")), ...(ai["error-commands"] as string[])]
    for (const c of cmds) {
      const r = runSh(c, k(), Object.fromEntries(UBUNTU_ERROR_LOGS.map((f) => [f, "x\n"])))
      expect(r.code, c).toBe(0)
      if (c.includes("${b}log")) {
        // Hook log dijaga `[ -n "$b" ]`: curl/wget tidak dipanggil sama sekali.
        expect(r.calls, c).toEqual([])
      } else {
        // callbackCmd (perilaku M4): curl dipanggil dengan URL kosong → tidak ada request ke server.
        expect(r.calls.map(url), c).toEqual(r.calls.map(() => ""))
      }
      expect(r.calls.some((x) => x.argv.some((a) => a.includes("/boot/"))), c).toBe(false)
    }
    const ks = rockyKickstart(ctx({ imageRepo: "rocky-9" })).split("\n")
    const r = runSh(ks[ks.indexOf("%pre --erroronfail") + 1] /* M6 BUG-M6-7: header %pre --erroronfail */, k().replace("ds=nocloud-net;s=", "inst.ks="))
    expect(r.calls).toEqual([])
  })
  it("curl gagal → fallback wget ke URL yang sama; keduanya gagal → tetap exit 0", () => {
    const c = logCmd("autoinstall", MAC, UBUNTU_LOG.start)
    // curl stub gagal: bungkus PATH dengan curl yang exit 7.
    const failingCurl = c.replace("| curl ", "| false_curl ")
    const r = runSh(`false_curl() { cat >/dev/null; return 7; }\n${failingCurl}`, kcmd("autoinstall"))
    expect(r.code).toBe(0)
    expect(r.calls.map((x) => [x.prog, url(x)])).toEqual([["wget", LOG_URL]])
    const r2 = runSh(`false_curl() { cat >/dev/null; return 7; }\nwget() { return 4; }\n${failingCurl}`, kcmd("autoinstall"))
    expect(r2.code).toBe(0)
  })
})

describe("AC-5.19 output generator: tanpa token / /log ber-token / nilai pengguna di pesan log", () => {
  const outputs: [string, string][] = [
    ["ubuntu user-data", ubuntuUserData(ctx())],
    ["debian preseed", debianPreseed(ctx({ imageRepo: "debian-12" }))],
    ["debian late", debianLateScript(ctx({ imageRepo: "debian-12" }))],
    ["rocky ks", rockyKickstart(ctx({ imageRepo: "rocky-9" }))],
    ["rocky post", rockyPostScript(ctx({ imageRepo: "rocky-9" }))],
    ["first-boot", FIRSTBOOT_SCRIPT_TEXT],
  ]
  it.each(outputs)("%s: tidak memuat token (teks maupun base64 bertingkat) dan tidak memuat '/log' ber-token", (_n, text) => {
    expect(containsSecret(text, TOKEN)).toBe(false)
    expect(containsSecret(text, `${TOKEN}/log`)).toBe(false)
    expect(containsSecret(text, `/boot/${MAC}/${TOKEN}`)).toBe(false)
  })
  it("setiap pesan logCmd di output adalah konstanta generator: tanpa hostname/username/hash", () => {
    const msgs: string[] = []
    const scan = (s: string, depth = 2) => {
      for (const m of s.matchAll(/printf '%s\\n' '([^']*)' \| curl/g)) msgs.push(m[1])
      if (depth > 0) for (const b of s.matchAll(/printf %s '([A-Za-z0-9+/=]{16,})' \| base64 -d/g)) scan(Buffer.from(b[1], "base64").toString("utf8"), depth - 1)
    }
    for (const [, t] of outputs) scan(t)
    // user-data YAML meng-escape kutip; pindai juga perintah autoinstall sebelum serialisasi.
    const ai = ubuntuAutoinstall(ctx())
    for (const c of [...ai["early-commands"], ...(ai["late-commands"] as string[]), ...(ai["error-commands"] as string[])]) scan(c)
    const consts = [...Object.values(UBUNTU_LOG), ...Object.values(DEBIAN_LOG), ...Object.values(ROCKY_LOG)]
    // Semua 7 konstanta berbeda (3 Ubuntu + 3 Debian + 3 Rocky; "konfigurasi target selesai" dipakai bersama) muncul.
    expect([...new Set(msgs)].sort()).toEqual([...new Set(consts)].sort())
    for (const m of msgs) {
      expect(consts).toContain(m)
      for (const v of [HOSTNAME, USERNAME, FAKE_HASH, "10.99.0.21"]) expect(m).not.toContain(v)
    }
    expect(msgOf(logCmd("preseed", MAC, DEBIAN_LOG.start))).toBe(DEBIAN_LOG.start)
  })
  it("logCmd menolak pesan dari nilai pengguna yang berbahaya (kutip/subshell)", () => {
    for (const bad of [`host'; id; '`, "$(id)", "`id`", "a\nb"]) expect(() => logCmd("autoinstall", MAC, bad)).toThrow()
  })
  it("sh -n: semua perintah hook valid secara sintaks", () => {
    const ai = ubuntuAutoinstall(ctx())
    for (const c of [...ai["early-commands"], ...(ai["late-commands"] as string[]), ...(ai["error-commands"] as string[])]) {
      expect(() => execFileSync("sh", ["-n", "-c", c])).not.toThrow()
    }
  })
})
