// M6-T6 (backend-dev): pengerasan generator.
//   AC-6.28 SR-4-6   baris `kernel` preseed diakhiri ` ---`; `url=…/preseed.cfg` sebelum `---`;
//                    Ubuntu tidak berubah; Rocky tanpa `---`.
//   AC-6.29 CR-4-7 / SR-4-3 (DEC-017 §8): `windowsUnattend()` tanpa URL `/boot/` / token dalam bentuk
//                    apa pun (teks, -EncodedCommand UTF-16LE, base64 bertingkat); FirstLogonCommands
//                    diakhiri pembersihan berurutan; Windows tetap tidak dilayani (422 / tidak bootable).
import { describe, expect, it } from "vitest"

import { JSDOM } from "jsdom"

import { applyConfig } from "@/lib/server/config-service"
import { installerScript, type InstallerScriptInput } from "@/lib/server/boot-script"
import { getActiveJob } from "@/lib/server/db/repos/jobs"
import { decideBoot } from "@/lib/server/discovery"
import { installHosts } from "@/lib/server/install-service"
import { newOsImagePayload } from "@/lib/server/library-service"
import { containsSecret } from "@/test/cmdline"
import { makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD, SSH_ECDSA, SSH_ED25519, SSH_ED25519_B, SSH_RSA } from "@/test/fixtures"

import type { InstallContext } from "./context"
import { INSTALLER_FILES, installerFile } from "./index"
import { cleanupCommands, WINDOWS_UNATTEND_PATHS, windowsUnattend } from "./windows"

const MAC = "52:54:00:99:00:11"
const TOKEN = "FIXTURE-token-not-real_00000000000000000000"
if (TOKEN.length !== 43) throw new Error("TOKEN 43")
const CALLBACK = `http://10.99.0.2/boot/${MAC}/${TOKEN}/status`
const FAKE_HASH = `$6$fixturesalt$${"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789./".repeat(3).slice(0, 86)}`
const DHCP = { mode: "dhcp" } as const

function ctx(over: Partial<InstallContext> = {}): InstallContext {
  return {
    jobId: "job-0b6c3f0e-1d2a-4c6b-9f00-000000000011",
    mac: MAC,
    hostname: "m6-node11",
    username: "ops",
    passwordHash: FAKE_HASH,
    sudo: true,
    disableSshPassword: true,
    network: { mode: "static", ip: "10.99.0.21", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2", "1.1.1.1"], vlan: null, iface: { by: "mac" } },
    authorizedKeys: [SSH_ED25519.publicKey, SSH_ED25519_B.publicKey],
    storage: { partition: "lvm", disk: "/dev/vda" },
    timezone: "Asia/Jakarta",
    locale: "en_US.UTF-8",
    mediaUrl: "http://10.99.0.2/media",
    imageRepo: "windows-2022",
    serverIp: "10.99.0.2",
    callbackUrl: CALLBACK,
    ...over,
  }
}

// ---------------------------------------------------------------------------
describe("AC-6.28 SR-4-6 preseed ` ---`", () => {
  const BASE: Omit<InstallerScriptInput, "method" | "source"> = {
    mediaUrl: "http://10.99.0.2/media",
    mediaRoot: "/srv/pxe/media",
    serverIp: "10.99.0.2",
    pxeDns: "10.99.0.2",
    configUrl: `http://10.99.0.2/boot/${MAC}/${TOKEN}/`,
    extraArgs: "console=ttyS0,115200n8 console=tty0",
  }
  const kernelLine = (s: string) => s.split("\n").find((l) => l.startsWith("kernel "))!
  const SRC = {
    preseed: { kernel: "debian-netboot/linux", initrd: "debian-netboot/initrd.gz", repo: "debian-12" },
    autoinstall: { kernel: "ubuntu-24.04/casper/vmlinuz", initrd: "ubuntu-24.04/casper/initrd", repo: "ubuntu-24.04" },
    kickstart: { kernel: "rocky-9/images/pxeboot/vmlinuz", initrd: "rocky-9/images/pxeboot/initrd.img", repo: "rocky-9" },
  }

  it.each(["", "console=ttyS0,115200n8 console=tty0", "quiet"])("preseed (extraArgs %j): diakhiri ` ---`, semua parameter (termasuk url=) sebelum `---`", (extra) => {
    const k = kernelLine(installerScript({ ...BASE, extraArgs: extra, method: "preseed", source: SRC.preseed }))
    expect(k.endsWith(" ---")).toBe(true)
    const args = k.split(" ")
    expect(args.filter((a) => a === "---")).toHaveLength(1)
    const sep = args.indexOf("---")
    expect(sep).toBe(args.length - 1)
    for (const p of [`url=${BASE.configUrl}preseed.cfg`, "auto=true", "priority=critical"]) {
      const i = args.indexOf(p)
      expect(i, p).toBeGreaterThan(0)
      expect(i, p).toBeLessThan(sep)
    }
    // Tidak ada parameter apa pun setelah `---` (d-i hanya menyalin parameter setelah `---` ke
    // bootloader target) → token tidak pernah tertulis ke GRUB terpasang.
    expect(args.slice(sep + 1)).toEqual([])
  })
  it("Ubuntu tetap (diakhiri ` ---` seperti M4); Rocky tanpa `---`", () => {
    const u = kernelLine(installerScript({ ...BASE, method: "autoinstall", source: SRC.autoinstall }))
    expect(u.endsWith("console=ttyS0,115200n8 console=tty0 ---")).toBe(true)
    expect(u.split(" ").filter((a) => a === "---")).toHaveLength(1)
    const r = kernelLine(installerScript({ ...BASE, method: "kickstart", source: SRC.kickstart }))
    expect(r.split(" ")).not.toContain("---")
    // M6 BUG-M6-7: Rocky menaruh console serial terakhir (/dev/console = ttyS0).
    expect(r.endsWith("inst.cmdline console=tty0 console=ttyS0,115200n8")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
function xmlDoc(xml: string): Document {
  const d = new (new JSDOM("").window.DOMParser)().parseFromString(xml, "application/xml")
  expect(d.getElementsByTagName("parsererror")).toHaveLength(0)
  return d
}
const texts = (d: Document, tag: string) => Array.from(d.getElementsByTagName(tag)).map((e) => e.textContent ?? "")
const psDecode = (cmd: string) => {
  const m = /-EncodedCommand (\S+)/.exec(cmd)
  return m ? Buffer.from(m[1], "base64").toString("utf16le") : cmd
}

/** Semua lapisan teks yang bisa diturunkan dari `s`: teks asli + dekode -EncodedCommand + base64 bertingkat. */
function layers(s: string, depth = 3): string[] {
  const out = [s]
  if (depth === 0) return out
  for (const m of s.matchAll(/[A-Za-z0-9+/]{16,}={0,2}/g)) {
    for (let off = 0; off < 4; off++) {
      const t = m[0].slice(off).replace(/=+$/, "")
      const buf = Buffer.from(t.slice(0, t.length - (t.length % 4)), "base64")
      for (const dec of [buf.toString("utf8"), buf.toString("utf16le")]) {
        // Hanya hasil dekode yang berupa teks (bukan derau biner) yang diperiksa lebih lanjut.
        const printable = dec.replace(/[^\x20-\x7e\n\t]/g, "").length
        if (dec.length > 0 && printable / dec.length > 0.95) out.push(...layers(dec, depth - 1))
      }
    }
  }
  return out
}

/** Hilangkan base64 blob (sudah diperiksa terpisah lewat `layers`) dan isi public key yang sah. */
const stripAllowed = (s: string, keys: string[]) => {
  let t = s
  // Isi base64 public key (bagian ke-2) — dekode lapisan bisa memotong 1–2 byte terakhir baris key.
  for (const k of keys) t = t.replaceAll(k.split(" ")[1], "<pubkey>")
  return t.replace(/-EncodedCommand \S+/g, "-EncodedCommand <b64>").replace(/FromBase64String\('[^']*'\)/g, "FromBase64String(<b64>)")
}

describe("AC-6.29 CR-4-7 / SR-4-3 Windows unattend tanpa token/URL", () => {
  const KEYSETS = [
    [SSH_ED25519.publicKey, SSH_ED25519_B.publicKey],
    [SSH_RSA.publicKey],
    [SSH_ECDSA.publicKey, SSH_ED25519.publicKey],
  ]
  const contexts: [string, InstallContext][] = [
    ["static + disable password", ctx()],
    ["dhcp", ctx({ network: DHCP })],
    ["password SSH aktif", ctx({ disableSshPassword: false, authorizedKeys: KEYSETS[1] })],
    ["https base ber-path", ctx({ callbackUrl: `https://pxe.lab/x/boot/${MAC}/${TOKEN}/status`, authorizedKeys: KEYSETS[2] })],
    ["token lain", ctx({ callbackUrl: `http://10.99.0.2/boot/${MAC}/${"Z".repeat(43)}/status` })],
  ]

  it.each(contexts)("%s: tidak memuat /boot/, token, maupun pola 43 karakter (semua lapisan dekode)", (_n, c) => {
    const xml = windowsUnattend(c)
    const tok = /\/boot\/[^/]+\/([^/]+)\//.exec(c.callbackUrl)![1]
    expect(containsSecret(xml, tok)).toBe(false)
    expect(containsSecret(xml, "/boot/")).toBe(false)
    expect(containsSecret(xml, "stage=")).toBe(false)
    const all = layers(xml)
    // Lapisan dekode benar-benar ada (EncodedCommand + key base64) — pemindai tidak kosong.
    expect(all.some((l) => l.includes("Set-LocalUser"))).toBe(true)
    for (const k of c.authorizedKeys) expect(all.some((l) => l.includes(k.split(" ")[1]))).toBe(true)
    for (const l of all) {
      expect(l).not.toContain("/boot/")
      expect(l).not.toContain(tok)
      expect(l).not.toContain("Invoke-WebRequest")
      expect(l).not.toContain(c.callbackUrl)
      expect(stripAllowed(l, c.authorizedKeys)).not.toMatch(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/)
    }
  })

  it("kontrol positif sintetis: pemindai yang sama menemukan URL ber-token di -EncodedCommand", () => {
    const enc = Buffer.from(`Invoke-WebRequest -Uri '${CALLBACK}'`, "utf16le").toString("base64")
    const fake = `<CommandLine>powershell -EncodedCommand ${enc}</CommandLine>`
    expect(containsSecret(fake, TOKEN)).toBe(true)
    expect(layers(fake).some((l) => l.includes("/boot/") && l.includes(TOKEN))).toBe(true)
    const nested = `<x>${Buffer.from(`echo ${Buffer.from(CALLBACK).toString("base64")}`).toString("base64")}</x>`
    expect(layers(nested).some((l) => l.includes(TOKEN))).toBe(true)
    expect(stripAllowed(`a ${TOKEN} b`, [])).toMatch(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/)
  })

  it("FirstLogonCommands diakhiri berurutan: hapus Panther/Sysprep → AutoLogon off → acak password → logoff", () => {
    for (const [, c] of contexts) {
      const d = xmlDoc(windowsUnattend(c))
      const cmds = texts(d, "CommandLine")
      const orders = texts(d, "Order").map(Number)
      expect(orders).toEqual(cmds.map((_, i) => i + 1))
      expect(cmds.slice(-4)).toEqual(cleanupCommands())
      const [rm, autologon, rand, logoff] = cmds.slice(-4).map(psDecode)
      for (const p of WINDOWS_UNATTEND_PATHS) expect(rm).toContain(`'${p}'`)
      expect(rm).toMatch(/^Remove-Item -Path .* -Force -ErrorAction SilentlyContinue$/)
      expect(WINDOWS_UNATTEND_PATHS).toEqual([
        "C:\\Windows\\Panther\\unattend*.xml",
        "C:\\Windows\\Panther\\Unattend\\unattend*.xml",
        "C:\\Windows\\System32\\Sysprep\\unattend.xml",
      ])
      expect(autologon).toContain("\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'")
      expect(autologon).toContain("Set-ItemProperty -Path $k -Name AutoAdminLogon -Value '0'")
      expect(autologon).toContain("Remove-ItemProperty -Path $k -Name DefaultPassword")
      expect(rand).toContain("[Security.Cryptography.RandomNumberGenerator]::Create()")
      expect(rand).toContain("Set-LocalUser -Name 'pxeadmin' -Password $s")
      // Password baru tidak pernah dicetak / ditulis ke file / di-log.
      expect(rand).not.toMatch(/Write-(Host|Output)|Out-File|Set-Content|Add-Content|echo|Transcript/i)
      expect(logoff).toBe("logoff")
      // OpenSSH + key terpasang SEBELUM password diacak & logoff.
      const iKeys = cmds.findIndex((x) => psDecode(x).includes("administrators_authorized_keys"))
      const iSshd = cmds.findIndex((x) => psDecode(x).includes("Start-Service sshd"))
      expect(iKeys).toBeGreaterThanOrEqual(0)
      expect(iSshd).toBeGreaterThan(iKeys)
      expect(iSshd).toBeLessThan(cmds.length - 4)
    }
  })

  it("password AutoLogon sementara = password akun; LogonCount 1; password tidak dari config", () => {
    const xml = windowsUnattend(ctx())
    const d = xmlDoc(xml)
    const values = texts(d, "Value")
    expect(values).toHaveLength(2)
    expect(values[0]).toBe(values[1])
    expect(texts(d, "LogonCount")).toEqual(["1"])
    expect(xml).not.toContain(DUMMY_PASSWORD)
    expect(xml).not.toContain("$6$")
    // Password sementara tidak ikut ke perintah mana pun (tidak di-log oleh FirstLogonCommands).
    for (const l of layers(xml)) if (l !== xml) expect(l).not.toContain(values[0])
  })

  it("Windows tetap tidak dilayani: INSTALLER_FILES.unattend kosong; unattend bootable ditolak validasi", () => {
    expect(INSTALLER_FILES.unattend).toEqual({})
    expect(installerFile("unattend", "unattend.xml")).toBeNull()
    expect(installerFile("unattend", "autounattend.xml")).toBeNull()
    const base = { id: "win-x", name: "Windows", version: "2022", arch: "amd64", method: "unattend", source: { kernel: "w/k", initrd: "w/i", repo: "w" } }
    const bad = newOsImagePayload.safeParse({ ...base, bootable: true })
    expect(bad.success).toBe(false)
    expect(bad.error!.issues.map((i) => i.path.join("."))).toContain("bootable")
    expect(newOsImagePayload.safeParse({ ...base, bootable: false }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe("AC-6.29 regresi: install host dengan OS Windows gagal (route → 422)", () => {
  const MEDIA = makeMediaRoot(tmpDir("m6t6-media"))
  withDb("empty", {
    PXE_MGMT_CIDR: "10.99.0.0/24",
    PXE_MGMT_GATEWAY: "10.99.0.1",
    PXE_MGMT_DNS: "10.99.0.2",
    PXE_SERVER_IP: "10.99.0.2",
    PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
    PXE_MEDIA_ROOT: MEDIA,
    PXE_INSECURE_NO_LEASE_CHECK: "1",
  })
  it("installHosts: windows-2022 → failed 'hanya generator', tanpa job", async () => {
    decideBoot({ mac: MAC, platform: "efi", ip: "10.99.0.150", wait: 0, now: new Date("2026-11-06T10:00:00Z") })
    const id = MAC.replaceAll(":", "")
    const r = await applyConfig([id], {
      os: { osImageId: "windows-2022", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
      credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
    })
    expect(r.ok).toBe(true)
    const res = installHosts([id], new Date("2026-11-06T10:00:01Z"))
    expect(res.started).toEqual([])
    expect(res.failed).toEqual([{ hostId: id, message: expect.stringMatching(/hanya generator/) }])
    expect(getActiveJob(id)).toBeNull()
  })
})
