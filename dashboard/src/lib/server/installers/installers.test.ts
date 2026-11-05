// M4-T9 unit generator (AC-4.18 Ubuntu, AC-4.19 Debian, AC-4.20 Rocky, AC-4.21 Windows,
// AC-4.22 injeksi) + helper (context, shell, xml, lines, firstboot). Golden file di __golden__/.
//
// Hash password fixture: string berformat SHA-512 crypt yang TIDAK diturunkan dari password apa
// pun (generator hanya memvalidasi format `$6$`), sehingga golden file tidak memuat hash password
// sungguhan. Token di URL callback juga dummy (bukan token yang pernah diterbitkan).
import { describe, expect, it } from "vitest"

import { JSDOM } from "jsdom"
import { parse as parseYaml, parseDocument } from "yaml"

import type { HostConfig, SshKey } from "@/lib/host-config"
import type { OsImageRecord } from "@/lib/server/db/repos/os-images"
import type { Host } from "@/lib/types"
import { containsSecret, evalCallbackUrl, runUrlFileCmd, urlExpr } from "@/test/cmdline"
import { DUMMY_PASSWORD, SSH_ECDSA, SSH_ED25519, SSH_ED25519_B, SSH_RSA } from "@/test/fixtures"

import {
  buildContext,
  fallbackHostname,
  InstallerInputError,
  prefixToNetmask,
  sanitizeKey,
  validateContext,
  type InstallContext,
} from "./context"
import { debianLateScript, debianPreseed } from "./debian"
import {
  authorizedKeysCmds,
  CALLBACK_URL_FILE,
  FIRSTBOOT_SCRIPT,
  FIRSTBOOT_UNIT,
  firstbootInstallCmds,
  sudoersText,
} from "./firstboot"
import { INSTALLER_FILES, installerFile } from "./index"
import { di, singleLine } from "./lines"
import { ROCKY_ERROR_LOGS, rockyKickstart, rockyPostScript } from "./rocky"
import { b64write, callbackCmd, callbackUrlCmd, CMDLINE_CONFIG_PARAM, logCmd, logTailCmd, shQuote } from "./shell"
import { BOOTORDER_SNIPPET, FORCE_REBOOT_GUARD, UBUNTU_ERROR_LOGS, UBUNTU_LOG, ubuntuAutoinstall, ubuntuMetaData, ubuntuUserData, ubuntuVendorData } from "./ubuntu"
import { windowsMac, windowsUnattend } from "./windows"
import { xmlEscape } from "./xml"

const FAKE_HASH = `$6$fixturesalt$${"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789./".repeat(3).slice(0, 86)}`
const TOKEN = "FIXTURE-token-not-real_00000000000000000000" // 43 karakter seperti token asli (32 byte base64url)
const CALLBACK = `http://10.99.0.2/boot/52:54:00:99:00:11/${TOKEN}/status`
const MAC = "52:54:00:99:00:11"
if (TOKEN.length !== 43) throw new Error("fixture TOKEN harus 43 karakter")
const CONFIG_PREFIX = CALLBACK.replace(/status$/, "")
/** Cmdline kernel installer seperti dibuat installerScript (boot-script.ts) untuk tiap metode. */
const KCMD = {
  autoinstall: `initrd=initrd ip=dhcp netboot=nfs nfsroot=10.99.0.2:/srv/pxe/media/ubuntu-24.04 autoinstall ds=nocloud-net;s=${CONFIG_PREFIX} cloud-config-url=/dev/null console=ttyS0,115200n8 ---`,
  preseed: `initrd=initrd auto=true priority=critical url=${CONFIG_PREFIX}preseed.cfg interface=auto netcfg/dhcp_timeout=60`,
  kickstart: `initrd=initrd ip=dhcp inst.stage2=nfs:10.99.0.2:/srv/pxe/media/rocky-9 inst.ks=${CONFIG_PREFIX}ks.cfg inst.cmdline`,
} as const
/** Perintah firstboot penulis file URL callback. */
const urlFileCmd = (cmds: string[]) => {
  const c = cmds.filter((l) => l.includes(`/etc/pxe-callback/url`) && urlExpr(l) !== null)
  expect(c).toHaveLength(1)
  return c[0]
}

function ctx(over: Partial<InstallContext> = {}): InstallContext {
  return {
    jobId: "job-0b6c3f0e-1d2a-4c6b-9f00-000000000011",
    mac: MAC,
    hostname: "m4-node11",
    username: "ops",
    passwordHash: FAKE_HASH,
    sudo: true,
    disableSshPassword: true,
    network: { mode: "static", ip: "10.99.0.21", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2"], vlan: null, iface: { by: "mac" } },
    authorizedKeys: [SSH_ED25519.publicKey, SSH_ED25519_B.publicKey],
    storage: { partition: "lvm", disk: "/dev/vda" },
    timezone: "Asia/Jakarta",
    locale: "en_US.UTF-8",
    mediaUrl: "http://10.99.0.2/media",
    imageRepo: "ubuntu-24.04",
    serverIp: "10.99.0.2",
    callbackUrl: CALLBACK,
    ...over,
  }
}
const DHCP = { mode: "dhcp" } as const

/** Semua `printf %s '<b64>' | base64 -d > path && chmod mode path` → {path: {mode, content}}. */
function b64Files(text: string): Record<string, { mode: string; content: string }> {
  const out: Record<string, { mode: string; content: string }> = {}
  for (const m of text.matchAll(/printf %s '([A-Za-z0-9+/=]*)' \| base64 -d > (\S+) && chmod (\d+) (\S+)/g)) {
    expect(m[4]).toBe(m[2])
    out[m[2]] = { mode: m[3], content: Buffer.from(m[1], "base64").toString("utf8") }
  }
  return out
}

/** Payload `echo <b64> | base64 -d > …` (late_command Debian / %post Rocky). */
function echoPayload(text: string): string {
  const m = /echo ([A-Za-z0-9+/=]+) \| base64 -d >/.exec(text)
  expect(m).not.toBeNull()
  return Buffer.from(m![1], "base64").toString("utf8")
}

function xmlDoc(xml: string): Document {
  const doc = new JSDOM("").window.DOMParser
  const d = new doc().parseFromString(xml, "application/xml")
  expect(d.getElementsByTagName("parsererror")).toHaveLength(0)
  return d
}
const texts = (d: Document, tag: string) => Array.from(d.getElementsByTagName(tag)).map((e) => e.textContent)

/** Decode `powershell … -EncodedCommand <b64 utf16le>`. */
/** Isi -EncodedCommand (UTF-16LE); perintah polos (`logoff`, M6) dikembalikan apa adanya. */
const psDecode = (cmd: string) => {
  const m = /-EncodedCommand (\S+)/.exec(cmd)
  return m ? Buffer.from(m[1], "base64").toString("utf16le") : cmd
}

describe("AC-4.18 Ubuntu autoinstall", () => {
  const ud = ubuntuUserData(ctx())
  const doc = parseYaml(ud.replace(/^#cloud-config\n/, "")) as { autoinstall: Record<string, unknown> }
  const ai = doc.autoinstall as ReturnType<typeof ubuntuAutoinstall>

  it("#cloud-config + YAML valid, version 1, identity apa adanya (hash tersimpan)", () => {
    expect(ud.startsWith("#cloud-config\n")).toBe(true)
    expect(Object.keys(doc)).toEqual(["autoinstall"])
    expect(ai.version).toBe(1)
    expect(ai.identity).toEqual({ hostname: "m4-node11", username: "ops", password: FAKE_HASH })
  })
  it("network statis match MAC: addresses, route default, nameservers", () => {
    expect(ai.network).toEqual({
      version: 2,
      ethernets: {
        mgmt: {
          match: { macaddress: MAC },
          dhcp4: false,
          dhcp6: false,
          addresses: ["10.99.0.21/24"],
          routes: [{ to: "default", via: "10.99.0.1" }],
          nameservers: { addresses: ["10.99.0.2"] },
        },
      },
    })
  })
  it("mode DHCP → dhcp4: true match MAC", () => {
    expect(ubuntuAutoinstall(ctx({ network: DHCP })).network).toEqual({ version: 2, ethernets: { mgmt: { match: { macaddress: MAC }, dhcp4: true } } })
  })
  it("VLAN + iface by name", () => {
    const n = ubuntuAutoinstall(ctx({ network: { mode: "static", ip: "10.99.0.21", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2", "1.1.1.1"], vlan: 20, iface: { by: "name", name: "eno1" } } })).network
    expect(n).toEqual({
      version: 2,
      ethernets: { mgmt: { match: { name: "eno1" }, dhcp4: false, dhcp6: false } },
      vlans: { "mgmt.20": { id: 20, link: "mgmt", dhcp4: false, dhcp6: false, addresses: ["10.99.0.21/24"], routes: [{ to: "default", via: "10.99.0.1" }], nameservers: { addresses: ["10.99.0.2", "1.1.1.1"] } } },
    })
  })
  it("ssh: authorized-keys = key persis, allow-pw = kebalikan disableSshPassword", () => {
    expect(ai.ssh).toEqual({ "install-server": true, "allow-pw": false, "authorized-keys": [SSH_ED25519.publicKey, SSH_ED25519_B.publicKey] })
    expect(ubuntuAutoinstall(ctx({ disableSshPassword: false })).ssh["allow-pw"]).toBe(true)
  })
  it("sudo=true → sudoers 0440 NOPASSWD; sudo=false → tidak ada", () => {
    const files = b64Files(ai["late-commands"].join("\n"))
    expect(files["/target/etc/sudoers.d/90-ops"]).toEqual({ mode: "440", content: "ops ALL=(ALL) NOPASSWD:ALL\n" })
    const noSudo = ubuntuAutoinstall(ctx({ sudo: false }))["late-commands"].join("\n")
    expect(noSudo).not.toContain("sudoers")
  })
  it("disableSshPassword → drop-in sshd PasswordAuthentication no; false → tidak ada", () => {
    const files = b64Files(ai["late-commands"].join("\n"))
    expect(files["/target/etc/ssh/sshd_config.d/60-pxe-no-password.conf"].content).toMatch(/^PasswordAuthentication no$/m)
    expect(ubuntuAutoinstall(ctx({ disableSshPassword: false }))["late-commands"].join("\n")).not.toContain("sshd_config.d")
  })
  it("storage lvm/direct + match.path bila disk diisi", () => {
    expect(ai.storage).toEqual({ layout: { name: "lvm", "sizing-policy": "all", match: { path: "/dev/vda" } } })
    expect(ubuntuAutoinstall(ctx({ storage: { partition: "auto", disk: "" } })).storage).toEqual({ layout: { name: "direct" } })
  })
  it("timezone/locale, apt offline, refresh-installer off, shutdown reboot", () => {
    expect(ai).toMatchObject({
      timezone: "Asia/Jakarta",
      locale: "en_US.UTF-8",
      apt: { geoip: false, fallback: "offline-install" },
      "refresh-installer": { update: false },
      shutdown: "reboot",
    })
    expect(ai).not.toHaveProperty("packages")
  })
  it("late-commands: callback configuring, unit first-boot done, BootOrder UEFI, guard pxe-force-reboot", () => {
    const late = ai["late-commands"]
    // M5 (DEC-014 §4, plan §2.5): log "late-commands mulai" SEBELUM callback configuring.
    expect(late[0]).toBe(logCmd("autoinstall", MAC, UBUNTU_LOG.late))
    expect(late[1]).toBe(callbackCmd("autoinstall", MAC, "configuring"))
    expect(late[1]).toContain(`-d stage=configuring "$u"`)
    expect(evalCallbackUrl(late[1], KCMD.autoinstall)).toBe(CALLBACK)
    const files = b64Files(late.join("\n"))
    expect(files[`/target${CALLBACK_URL_FILE}`]).toBeUndefined()
    expect(runUrlFileCmd(urlFileCmd(late), "/target", KCMD.autoinstall)).toEqual({ mode: "600", content: `${CALLBACK}\n` })
    expect(files[`/target${FIRSTBOOT_SCRIPT}`].content).toContain("-d stage=done")
    expect(files[`/target/etc/systemd/system/${FIRSTBOOT_UNIT}`].content).toContain(`ExecStart=${FIRSTBOOT_SCRIPT}`)
    expect(late.some((l) => l.includes(`multi-user.target.wants/${FIRSTBOOT_UNIT}`))).toBe(true)
    expect(late).toContain(BOOTORDER_SNIPPET)
    expect(BOOTORDER_SNIPPET).toContain("efibootmgr -o")
    expect(late.at(-1)).toBe(FORCE_REBOOT_GUARD)
    expect(FORCE_REBOOT_GUARD).toContain("--unit=pxe-force-reboot")
  })
  it("error-commands: callback failed", () => {
    // M5 (plan §2.5): tail log installer lalu callback failed (urutan itu).
    expect(ai["error-commands"]).toEqual([logTailCmd("autoinstall", MAC, UBUNTU_ERROR_LOGS), callbackCmd("autoinstall", MAC, "failed")])
    expect(evalCallbackUrl(ai["error-commands"][1], KCMD.autoinstall)).toBe(CALLBACK)
  })
  it("meta-data: instance-id = jobId + local-hostname; vendor-data kosong", () => {
    expect(parseYaml(ubuntuMetaData(ctx()))).toEqual({ "instance-id": ctx().jobId, "local-hostname": "m4-node11" })
    expect(ubuntuVendorData()).toBe("#cloud-config\n{}\n")
    expect(parseYaml(ubuntuVendorData())).toEqual({})
  })
  it("golden file", async () => {
    await expect(ud).toMatchFileSnapshot("../../../test/golden/installers/ubuntu-user-data.yaml")
    await expect(ubuntuMetaData(ctx())).toMatchFileSnapshot("../../../test/golden/installers/ubuntu-meta-data.yaml")
    await expect(ubuntuUserData(ctx({ network: DHCP, sudo: false, disableSshPassword: false, storage: { partition: "auto", disk: "" } }))).toMatchFileSnapshot("../../../test/golden/installers/ubuntu-user-data-dhcp.yaml")
  })
})

describe("AC-4.19 Debian preseed", () => {
  const c = ctx({ imageRepo: "debian-12" })
  const ps = debianPreseed(c)
  const lines = ps.trimEnd().split("\n")
  const late = echoPayload(lines.find((l) => l.startsWith("d-i preseed/late_command "))!)

  it("setiap baris cocok ^(#.*|d-i \\S+ \\S+( .*)?|)$", () => {
    for (const l of lines) expect(l).toMatch(/^(#.*|d-i \S+ \S+( .*)?|)$/)
  })
  it("hash, root-login false, hostname, mirror lokal, pkgsel", () => {
    expect(lines).toContain(`d-i passwd/user-password-crypted password ${FAKE_HASH}`)
    expect(lines).toContain("d-i passwd/root-login boolean false")
    expect(lines).toContain("d-i passwd/username string ops")
    expect(lines).toContain("d-i netcfg/get_hostname string m4-node11")
    expect(lines).toContain("d-i mirror/http/hostname string 10.99.0.2")
    expect(lines).toContain("d-i mirror/http/directory string /media/debian-12")
    expect(lines).toContain("d-i pkgsel/include string openssh-server curl sudo")
    expect(lines).toContain("d-i partman-auto/method string lvm")
    expect(lines).toContain("d-i partman-auto/disk string /dev/vda")
    expect(lines).toContain("d-i grub-installer/bootdev string /dev/vda")
    expect(lines.at(-1)).toBe("d-i finish-install/reboot_in_progress note")
  })
  it("late_command (didekode): authorized_keys 0600 milik user, sudoers, sshd drop-in, interface via MAC, first-boot, callback", () => {
    // M5 (plan §2.5): baris [2] = log late_command mulai; callback configuring di [3].
    expect(late.split("\n")[3]).toBe(callbackCmd("preseed", MAC, "configuring"))
    expect(evalCallbackUrl(late.split("\n")[3], KCMD.preseed)).toBe(CALLBACK)
    const files = b64Files(late)
    expect(files["/home/ops/.ssh/authorized_keys"]).toEqual({ mode: "600", content: `${SSH_ED25519.publicKey}\n${SSH_ED25519_B.publicKey}\n` })
    expect(late).toContain("chown -R 'ops': /home/ops/.ssh")
    expect(files["/etc/sudoers.d/90-ops"]).toEqual({ mode: "440", content: sudoersText("ops") })
    expect(files["/etc/ssh/sshd_config.d/60-pxe-no-password.conf"].content).toMatch(/^PasswordAuthentication no$/m)
    expect(late).toContain(`= '${MAC}' ] && IF=$(basename "$d")`)
    const ifaces = /printf %s '([A-Za-z0-9+/=]+)' \| base64 -d \| sed/.exec(late)!
    expect(Buffer.from(ifaces[1], "base64").toString()).toBe(
      "auto $IF\niface $IF inet static\n    address 10.99.0.21/24\n    netmask 255.255.255.0\n    gateway 10.99.0.1\n    dns-nameservers 10.99.0.2\n",
    )
    expect(files[CALLBACK_URL_FILE]).toBeUndefined()
    expect(runUrlFileCmd(urlFileCmd(late.split("\n")), "", KCMD.preseed)).toEqual({ mode: "600", content: `${CALLBACK}\n` })
    expect(files[FIRSTBOOT_SCRIPT].content).toContain("stage=done")
    expect(late).toBe(debianLateScript(c))
  })
  it("variasi: DHCP, sudo=false, password SSH diizinkan, iface by name + VLAN, partisi regular", () => {
    const l2 = debianLateScript(ctx({ network: DHCP, sudo: false, disableSshPassword: false }))
    expect(l2).not.toContain("sudoers")
    expect(l2).not.toContain("sshd_config.d")
    expect(Buffer.from(/printf %s '([A-Za-z0-9+/=]+)' \| base64 -d \| sed/.exec(l2)![1], "base64").toString()).toBe("auto $IF\niface $IF inet dhcp\n")
    const l3 = debianLateScript(ctx({ network: { mode: "static", ip: "10.99.0.21", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2"], vlan: 7, iface: { by: "name", name: "eno1" } } }))
    expect(l3).toContain("IF='eno1'")
    expect(Buffer.from(/printf %s '([A-Za-z0-9+/=]+)' \| base64 -d \| sed/.exec(l3)![1], "base64").toString()).toMatch(/^auto \$IF\niface \$IF inet manual\nauto \$IF\.7\niface \$IF\.7 inet static/)
    const p = debianPreseed(ctx({ storage: { partition: "auto", disk: "" } }))
    expect(p).toContain("d-i partman-auto/method string regular")
    expect(p).not.toContain("partman-auto/disk")
    expect(p).toContain("d-i grub-installer/bootdev string default")
  })
  it("golden file", async () => {
    await expect(ps).toMatchFileSnapshot("../../../test/golden/installers/debian-preseed.cfg")
    await expect(late).toMatchFileSnapshot("../../../test/golden/installers/debian-late.sh")
  })
})

describe("AC-4.20 Rocky kickstart", () => {
  const c = ctx({ imageRepo: "rocky-9" })
  const ks = rockyKickstart(c)
  const lines = ks.trimEnd().split("\n")

  it("cmdline (BUG-M6-5), url, rootpw --lock, user --iscrypted + wheel, sshkey per key, network statis, reboot", () => {
    expect(lines).toContain("cmdline")
    expect(lines).not.toContain("text")
    expect(lines).toContain("url --url=http://10.99.0.2/media/rocky-9")
    expect(lines).toContain("rootpw --lock")
    expect(lines).toContain(`user --name=ops --password=${FAKE_HASH} --iscrypted --groups=wheel`)
    expect(lines.filter((l) => l.startsWith("sshkey "))).toEqual([
      `sshkey --username=ops "${SSH_ED25519.publicKey}"`,
      `sshkey --username=ops "${SSH_ED25519_B.publicKey}"`,
    ])
    expect(lines).toContain(
      `network --device=${MAC} --bootproto=static --ip=10.99.0.21 --netmask=255.255.255.0 --gateway=10.99.0.1 --nameserver=10.99.0.2 --hostname=m4-node11 --activate --onboot=yes`,
    )
    expect(lines).toContain("clearpart --all --initlabel --drives=vda")
    expect(lines).toContain("autopart --type=lvm")
    expect(lines).toContain("reboot")
  })
  it("sudo=false → tanpa wheel; DHCP; partisi plain tanpa disk", () => {
    const k = rockyKickstart(ctx({ sudo: false, network: DHCP, storage: { partition: "auto", disk: "" } }))
    expect(k).toContain("user --name=ops --password=")
    expect(k).not.toContain("--groups=wheel")
    expect(k).toContain(`network --device=${MAC} --bootproto=dhcp --hostname=m4-node11 --activate --onboot=yes`)
    expect(k).toContain("autopart --type=plain")
    expect(k).toContain("clearpart --all --initlabel\n")
    expect(k).not.toContain("ignoredisk")
  })
  it("section %…/%end seimbang; %post (didekode) + %onerror callback failed", () => {
    const opens = lines.filter((l) => /^%(?!end$)/.test(l))
    const ends = lines.filter((l) => l === "%end")
    // M5 (plan §2.5): + %pre (log mulai).
    expect(opens.map((l) => l.split(" ")[0])).toEqual(["%pre", "%packages", "%post", "%onerror"])
    expect(ends).toHaveLength(opens.length)
    const onerr = lines.indexOf("%onerror")
    // M5: %onerror = tail log anaconda lalu callback failed.
    expect(lines[onerr + 1]).toBe(logTailCmd("kickstart", MAC, ROCKY_ERROR_LOGS))
    expect(lines[onerr + 2]).toBe(callbackCmd("kickstart", MAC, "failed"))
    expect(evalCallbackUrl(lines[onerr + 2], KCMD.kickstart)).toBe(CALLBACK)
    const post = echoPayload(lines[lines.indexOf("%post --log=/root/pxe-post.log") + 1])
    expect(post).toBe(rockyPostScript(c))
    expect(post).toContain(callbackCmd("kickstart", MAC, "configuring"))
    // M5: baris [1] = log post mulai; callback configuring di [2].
    expect(evalCallbackUrl(post.split("\n")[2], KCMD.kickstart)).toBe(CALLBACK)
    const files = b64Files(post)
    expect(files["/home/ops/.ssh/authorized_keys"].mode).toBe("600")
    expect(files["/etc/sudoers.d/90-ops"].content).toBe(sudoersText("ops"))
    expect(files["/etc/ssh/sshd_config.d/60-pxe-no-password.conf"].content).toContain("PasswordAuthentication no")
    expect(files[CALLBACK_URL_FILE]).toBeUndefined()
    expect(runUrlFileCmd(urlFileCmd(post.split("\n")), "", KCMD.kickstart)).toEqual({ mode: "600", content: `${CALLBACK}\n` })
    expect(post).toContain("restorecon")
  })
  it("VLAN + iface by name", () => {
    const k = rockyKickstart(ctx({ network: { mode: "static", ip: "10.99.0.21", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2", "10.99.0.1"], vlan: 30, iface: { by: "name", name: "eno1" } } }))
    expect(k).toContain("network --device=eno1 --bootproto=static --ip=10.99.0.21 --netmask=255.255.255.0 --gateway=10.99.0.1 --nameserver=10.99.0.2,10.99.0.1 --vlanid=30 --hostname=m4-node11")
    expect(rockyPostScript(ctx({ sudo: false, disableSshPassword: false }))).not.toMatch(/sudoers|sshd_config/)
  })
  it("golden file", async () => {
    await expect(ks).toMatchFileSnapshot("../../../test/golden/installers/rocky-ks.cfg")
  })
})

describe("AC-4.21 Windows unattend.xml", () => {
  const xml = windowsUnattend(ctx({ hostname: "m4-node11" }))
  const d = xmlDoc(xml)

  it("well-formed, 3 pass, ComputerName = hostname", () => {
    expect(Array.from(d.getElementsByTagName("settings")).map((s) => s.getAttribute("pass"))).toEqual(["windowsPE", "specialize", "oobeSystem"])
    expect(texts(d, "ComputerName")).toEqual(["m4-node11"])
  })
  it("hostname > 15 karakter → error", () => {
    expect(() => windowsUnattend(ctx({ hostname: "m4-node11-sangat-panjang" }))).toThrow(InstallerInputError)
    expect(() => windowsUnattend(ctx({ hostname: "a".repeat(16) }))).toThrow(/15 karakter/)
    expect(() => windowsUnattend(ctx({ hostname: "a".repeat(15) }))).not.toThrow()
  })
  it("Identifier = MAC 52-54-00-… uppercase, IP/prefix, gateway, DNS", () => {
    expect(windowsMac("52:54:00:99:00:aa")).toBe("52-54-00-99-00-AA")
    const ids = texts(d, "Identifier")
    expect(ids.filter((i) => i === "52-54-00-99-00-11")).toHaveLength(2) // TCPIP + DNS client
    const ip = Array.from(d.getElementsByTagName("IpAddress")).map((e) => e.textContent)
    expect(ip).toEqual(["10.99.0.21/24", "10.99.0.2"])
    expect(texts(d, "NextHopAddress")).toEqual(["10.99.0.1"])
    expect(texts(d, "Prefix")).toEqual(["0.0.0.0/0"])
  })
  it("DHCP → tanpa komponen TCPIP/DNS", () => {
    const x = xmlDoc(windowsUnattend(ctx({ network: DHCP })))
    const comps = Array.from(x.getElementsByTagName("component")).map((c) => c.getAttribute("name"))
    expect(comps).not.toContain("Microsoft-Windows-TCPIP")
    expect(comps).not.toContain("Microsoft-Windows-DNS-Client")
  })
  it("FirstLogonCommands: OpenSSH + administrators_authorized_keys berisi key + PasswordAuthentication no", () => {
    const cmds = texts(d, "CommandLine").map((c) => psDecode(c!))
    expect(cmds[0]).toContain("Add-WindowsCapability -Online -Name OpenSSH.Server")
    expect(cmds[1]).toContain("administrators_authorized_keys")
    const keysB64 = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(cmds[1])![1]
    expect(Buffer.from(keysB64, "base64").toString()).toBe(`${SSH_ED25519.publicKey}\n${SSH_ED25519_B.publicKey}\n`)
    expect(cmds[2]).toContain("PasswordAuthentication no")
    // M6 (CR-4-7/SR-4-3): tanpa callback ber-token; empat langkah terakhir = pembersihan.
    expect(cmds.slice(-4)).toEqual([
      expect.stringContaining("Remove-Item -Path 'C:\\Windows\\Panther\\unattend*.xml'"),
      expect.stringContaining("AutoAdminLogon -Value '0'"),
      expect.stringContaining("Set-LocalUser -Name 'pxeadmin'"),
      "logoff",
    ])
    expect(cmds.join("\n")).not.toContain(CALLBACK)
    const noDisable = texts(xmlDoc(windowsUnattend(ctx({ disableSshPassword: false }))), "CommandLine").map((c) => psDecode(c!))
    expect(noDisable.some((c) => c.includes("PasswordAuthentication no"))).toBe(false)
  })
  it("tidak ada hash $6$ maupun password/username dari config; password akun acak per render", () => {
    expect(xml).not.toContain("$6$")
    expect(xml).not.toContain(FAKE_HASH)
    expect(xml).not.toContain(DUMMY_PASSWORD)
    const pw1 = texts(d, "Value")
    const pw2 = texts(xmlDoc(windowsUnattend(ctx())), "Value")
    expect(pw1[0]).toHaveLength(35)
    expect(pw1[0]).not.toBe(pw2[0])
  })
  it("golden file (password acak disamarkan)", async () => {
    await expect(xml.replace(/<Value>[^<]+<\/Value>/g, "<Value>RANDOM</Value>")).toMatchFileSnapshot("../../../test/golden/installers/windows-unattend.xml")
  })
})

// ---- AC-4.22 injeksi ----
const DANGEROUS = ["\n", "\r", "'", '"', "$(reboot)", "`reboot`", "; reboot", ": #", "%post", "]]>", "<!--", "&", "\0"]

type Gen = { name: string; render: (c: InstallContext) => string; structure: (out: string) => unknown }
const GENS: Gen[] = [
  {
    name: "ubuntu",
    render: ubuntuUserData,
    structure: (o) => {
      const doc = parseDocument(o.replace(/^#cloud-config\n/, ""))
      expect(doc.errors).toEqual([])
      const ai = (doc.toJS() as { autoinstall: Record<string, unknown[]> }).autoinstall
      return { keys: Object.keys(ai), late: ai["late-commands"].length, err: ai["error-commands"].length }
    },
  },
  { name: "debian", render: debianPreseed, structure: (o) => ({ lines: o.split("\n").length, di: o.split("\n").filter((l) => l.startsWith("d-i ")).length }) },
  {
    name: "rocky",
    render: rockyKickstart,
    structure: (o) => ({ lines: o.split("\n").length, sections: o.split("\n").filter((l) => l.startsWith("%")).length }),
  },
  {
    name: "windows",
    render: windowsUnattend,
    structure: (o) => ({ elements: xmlDoc(o).getElementsByTagName("*").length }),
  },
]

/** Nilai field dibaca balik dari output yang sudah di-parse. */
function readBack(gen: string, out: string, field: "hostname" | "username" | "disk"): string | null {
  if (gen === "ubuntu") {
    const ai = (parseYaml(out.replace(/^#cloud-config\n/, "")) as { autoinstall: ReturnType<typeof ubuntuAutoinstall> }).autoinstall
    if (field === "hostname") return ai.identity.hostname
    if (field === "username") return ai.identity.username
    return (ai.storage.layout as { match?: { path: string } }).match?.path ?? null
  }
  if (gen === "windows") return field === "hostname" ? texts(xmlDoc(out), "ComputerName")[0] : null
  return null
}

describe("AC-4.22 injeksi: tolak atau nilai persis dengan struktur tetap", () => {
  const BASE = ctx({ hostname: "node11", imageRepo: "ubuntu-24.04" })
  for (const g of GENS) {
    const baseline = g.structure(g.render(BASE))
    for (const field of ["hostname", "username", "disk"] as const) {
      for (const bad of DANGEROUS) {
        const value = field === "disk" ? `/dev/vda${bad}` : field === "hostname" ? `n1${bad}` : `ops${bad}`
        it(`${g.name}: ${field} = ${JSON.stringify(value)}`, () => {
          const c = { ...BASE, ...(field === "disk" ? { storage: { partition: "lvm" as const, disk: value } } : { [field]: value }) }
          let out: string
          try {
            out = g.render(c)
          } catch (e) {
            expect(e).toBeInstanceOf(Error)
            return
          }
          // Lolos validasi → struktur sama dan nilai ter-parse persis.
          expect(g.structure(out)).toEqual(baseline)
          const back = readBack(g.name, out, field)
          if (back !== null) expect(back).toBe(value)
        })
      }
    }
    for (const bad of DANGEROUS.filter((b) => b !== "\0")) {
      it(`${g.name}: komentar key ${JSON.stringify(bad)} disanitasi (buildContext) → struktur tetap`, () => {
        const raw = `${SSH_ED25519.publicKey.split(" ").slice(0, 2).join(" ")} evil${bad}x`
        let key: string
        try {
          key = sanitizeKey(raw)
        } catch (e) {
          expect(e).toBeInstanceOf(InstallerInputError)
          return
        }
        expect(key.split(" ")[2]).toMatch(/^[A-Za-z0-9@._+-]+$/)
        const out = g.render({ ...BASE, authorizedKeys: [key, SSH_ED25519_B.publicKey] })
        expect(g.structure(out)).toEqual(baseline)
      })
    }
  }

  it("key tanpa normalisasi / berisi baris baru ditolak validateContext", () => {
    expect(() => validateContext(ctx({ authorizedKeys: [`${SSH_ED25519.publicKey}\nssh-rsa AAAA x`] }))).toThrow(InstallerInputError)
    expect(() => validateContext(ctx({ authorizedKeys: [`${SSH_ED25519.publicKey} a'b`] }))).toThrow(/belum dinormalisasi/)
    expect(() => sanitizeKey("ssh-ed25519 !!!! x")).toThrow(InstallerInputError)
    expect(() => validateContext(ctx({ authorizedKeys: Array(101).fill(SSH_ED25519.publicKey) }))).toThrow(/Terlalu banyak/)
  })

  it("hash bukan $6$ ditolak keempat generator; password plaintext test tidak pernah muncul", () => {
    for (const bad of [DUMMY_PASSWORD, "$1$abc$def", "$5$salt$" + "a".repeat(43), `${FAKE_HASH}\n`, `${FAKE_HASH}'`, ""]) {
      for (const g of GENS) expect(() => g.render(ctx({ passwordHash: bad })), `${g.name} ${JSON.stringify(bad)}`).toThrow(/\$6\$/)
    }
    for (const g of GENS) expect(g.render(ctx({ hostname: "node11" }))).not.toContain(DUMMY_PASSWORD)
  })

  it("field lain berbahaya ditolak: IP/gateway/DNS/VLAN/iface/timezone/locale/URL/MAC/jobId", () => {
    const st = (n: Partial<Extract<InstallContext["network"], { mode: "static" }>>) => ({ network: { ...(ctx().network as Extract<InstallContext["network"], { mode: "static" }>), ...n } })
    const bads: Partial<InstallContext>[] = [
      st({ ip: "10.99.0.21\n" }),
      st({ ip: "10.99.0.256" }),
      st({ prefix: 33 }),
      st({ prefix: 24.5 }),
      st({ gateway: "10.99.0.1;reboot" }),
      st({ dns: [] }),
      st({ dns: ["127.0.0.1"] }),
      st({ dns: ["10.99.0.2", "1.1.1.1", "8.8.8.8", "9.9.9.9", "8.8.4.4"] }),
      st({ vlan: 0 }),
      st({ vlan: 4095 }),
      st({ iface: { by: "name", name: "eth0;reboot" } }),
      { network: { mode: "bogus" } as unknown as InstallContext["network"] },
      { timezone: "Asia/Jakarta\nx" },
      { timezone: "../../etc/passwd" },
      { locale: "en_US.UTF-8'" },
      { mediaUrl: "http://10.99.0.2/media'; reboot" },
      { imageRepo: "../etc" },
      { imageRepo: "a b" },
      { serverIp: "10.99.0.2 x" },
      { callbackUrl: "http://10.99.0.2/x'/status" },
      { callbackUrl: "http://10.99.0.2/boot/x" },
      { mac: "52-54-00-99-00-11" },
      { jobId: "job;rm" },
      { username: "root" },
      { username: " ops" },
      { storage: { partition: "zfs" as never, disk: "" } },
    ]
    for (const b of bads) for (const g of GENS) expect(() => g.render(ctx({ hostname: "node11", ...b })), `${g.name} ${JSON.stringify(b)}`).toThrow(InstallerInputError)
  })
})

describe("buildContext / helper", () => {
  const host: Host = {
    id: "525400990011",
    mac: MAC,
    hostname: "m4-node11",
    currentIp: "10.99.0.150",
    mgmtIp: "10.99.0.21",
    vendor: "QEMU/KVM",
    firmware: "uefi",
    osInstalled: null,
    osAssigned: "ubuntu-24.04",
    status: "booting",
    statusSince: "2026-11-05T10:00:00.000Z",
    lastSeen: "2026-11-05T10:00:00.000Z",
  }
  const config: HostConfig = {
    os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    username: "ops",
    passwordHash: FAKE_HASH,
    sudo: true,
    disableSshPassword: false,
    network: ctx().network as HostConfig["network"],
    sshKeyIds: ["key-1"],
    extraKeys: [`${SSH_RSA.publicKey.split(" ").slice(0, 2).join(" ")} rsa comment with spaces`, SSH_ECDSA.publicKey],
    sshUser: null,
    updatedAt: null,
  }
  const image = { source: { kernel: "k", initrd: "i", repo: "ubuntu-24.04" } } as OsImageRecord
  const lib: SshKey[] = [{ id: "key-1", name: "a", type: "ssh-ed25519", publicKey: SSH_ED25519.publicKey, fingerprint: SSH_ED25519.fingerprint, comment: SSH_ED25519.comment, createdAt: "" }]
  const input = { host, config, jobId: "job-1", image, libraryKeys: lib, mediaUrl: "http://10.99.0.2/media", serverIp: "10.99.0.2", callbackUrl: CALLBACK }

  it("key library + extraKeys (komentar disanitasi, duplikat disatukan), hostname fallback", () => {
    const c = buildContext({ ...input, config: { ...config, extraKeys: [...config.extraKeys, SSH_ED25519.publicKey] } })
    expect(c.authorizedKeys).toEqual([
      SSH_ED25519.publicKey,
      `${SSH_RSA.publicKey.split(" ").slice(0, 2).join(" ")} rsa_comment_with_spaces`,
      SSH_ECDSA.publicKey,
    ])
    expect(c).toMatchObject({ hostname: "m4-node11", imageRepo: "ubuntu-24.04", storage: { partition: "lvm", disk: "" }, timezone: "UTC" })
    expect(buildContext({ ...input, host: { ...host, hostname: null } }).hostname).toBe("node-525400990011")
    expect(fallbackHostname(MAC)).toBe("node-525400990011")
    expect(buildContext({ ...input, config: { ...config, network: { mode: "dhcp" } } }).network).toEqual({ mode: "dhcp" })
    expect(sanitizeKey(`${SSH_ED25519.publicKey.split(" ").slice(0, 2).join(" ")}`)).toBe(SSH_ED25519.publicKey.split(" ").slice(0, 2).join(" "))
  })
  it("tanpa OS / credentials / user SSH berbeda / partisi custom → InstallerInputError", () => {
    expect(() => buildContext({ ...input, config: { ...config, os: null } })).toThrow(/OS belum dipilih/)
    expect(() => buildContext({ ...input, config: { ...config, passwordHash: null } })).toThrow(/Credentials/)
    expect(() => buildContext({ ...input, config: { ...config, username: null } })).toThrow(/Credentials/)
    expect(() => buildContext({ ...input, config: { ...config, sshUser: "other" } })).toThrow(/User target SSH/)
    expect(() => buildContext({ ...input, config: { ...config, os: { ...config.os!, partition: "custom" } } })).toThrow(/custom/)
    expect(buildContext({ ...input, config: { ...config, sshUser: "ops" } }).username).toBe("ops")
  })
  it("prefixToNetmask", () => {
    expect([0, 8, 16, 24, 25, 30, 32].map(prefixToNetmask)).toEqual(["0.0.0.0", "255.0.0.0", "255.255.0.0", "255.255.255.0", "255.255.255.128", "255.255.255.252", "255.255.255.255"])
  })
  it("shQuote / b64write / callbackCmd", () => {
    expect(shQuote("a'b")).toBe(`'a'\\''b'`)
    expect(() => shQuote("a\0")).toThrow(/NUL/)
    expect(b64write("/etc/x", "0644", "hi")).toBe("printf %s 'aGk=' | base64 -d > /etc/x && chmod 0644 /etc/x")
    expect(() => b64write("/etc/../x", "644", "")).toThrow(/Path tidak aman/)
    expect(() => b64write("/etc/x y", "644", "")).toThrow(/Path tidak aman/)
    expect(() => b64write("/etc/x", "999", "")).toThrow(/Mode/)
    expect(() => callbackCmd("autoinstall", MAC, "done;reboot")).toThrow(/stage/)
    expect(() => callbackCmd("unattend" as "preseed", MAC, "done")).toThrow(/metode/)
    expect(() => callbackCmd("toString" as "preseed", MAC, "done")).toThrow(/metode/)
    expect(() => callbackUrlCmd("preseed", "52:54:00:99:00:1G")).toThrow(/MAC/)
    expect(() => callbackUrlCmd("preseed", "52-54-00-99-00-11")).toThrow(/MAC/)
    expect(() => callbackUrlCmd("preseed", MAC, "/proc/cmdline;id")).toThrow(/Path/)
    expect(callbackCmd("preseed", MAC, "done")).toMatch(/^u=\$\(.*\); curl .* -d stage=done "\$u" >\/dev\/null 2>&1 \|\| wget .*--post-data=stage=done "\$u" \|\| true$/)
  })
  it("xmlEscape / singleLine / di / firstboot", () => {
    expect(xmlEscape(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;")
    expect(xmlEscape("a\tb\nc\r")).toBe("a\tb\nc\r")
    expect(() => xmlEscape("a\x01")).toThrow(/kontrol/)
    expect(() => singleLine("a\nb", "x")).toThrow(/baris baru/)
    expect(() => singleLine("a\0", "x")).toThrow(/baris baru/)
    expect(di("a/b", "boolean", true)).toBe("d-i a/b boolean true")
    expect(di("a/b", "note")).toBe("d-i a/b note")
    expect(() => di("a b", "string", "x")).toThrow(/kunci preseed/)
    expect(() => di("a/b", "String", "x")).toThrow(/kunci preseed/)
    expect(() => firstbootInstallCmds("/tar get", "autoinstall", MAC)).toThrow(/root/)
    expect(firstbootInstallCmds("", "preseed", MAC)[0]).toContain("mkdir -p /etc/pxe-callback")
    expect(authorizedKeysCmds("/target", "ops", ["k"])[2]).toBe("chroot /target chown -R 'ops': /home/ops/.ssh")
  })
  it("installerFile: hanya file yang dikenal per metode; Windows tidak dilayani", () => {
    expect(installerFile("autoinstall", "user-data")?.primary).toBe(true)
    expect(installerFile("autoinstall", "meta-data")?.primary).toBe(false)
    expect(installerFile("autoinstall", "vendor-data")!.render(ctx())).toBe("#cloud-config\n{}\n")
    expect(installerFile("autoinstall", "network-config")).toBeNull()
    expect(installerFile("autoinstall", "preseed.cfg")).toBeNull()
    expect(installerFile("autoinstall", "constructor")).toBeNull()
    expect(installerFile("autoinstall", "__proto__")).toBeNull()
    expect(installerFile("preseed", "preseed.cfg")?.primary).toBe(true)
    expect(installerFile("kickstart", "ks.cfg")?.primary).toBe(true)
    expect(installerFile("kickstart", "user-data")).toBeNull()
    expect(Object.keys(INSTALLER_FILES.unattend)).toEqual([])
    expect(installerFile("unattend", "unattend.xml")).toBeNull()
  })
})

describe("B-5 token callback tidak pernah tertulis di konfigurasi installer", () => {
  it("Ubuntu/Debian/Rocky: token tidak muncul plaintext maupun di payload base64 (bertingkat)", () => {
    const outputs = {
      "ubuntu user-data": ubuntuUserData(ctx()),
      "ubuntu user-data dhcp": ubuntuUserData(ctx({ network: DHCP, sudo: false, disableSshPassword: false })),
      "ubuntu meta-data": ubuntuMetaData(ctx()),
      "debian preseed": debianPreseed(ctx({ imageRepo: "debian-12" })),
      "debian late": debianLateScript(ctx({ imageRepo: "debian-12" })),
      "rocky ks": rockyKickstart(ctx({ imageRepo: "rocky-9" })),
      "rocky post": rockyPostScript(ctx({ imageRepo: "rocky-9" })),
    }
    for (const [name, text] of Object.entries(outputs)) {
      expect(containsSecret(text, TOKEN), name).toBe(false)
      expect(text, name).not.toContain("/status'")
    }
    // M6 (CR-4-7/SR-4-3): Windows tidak lagi menyisipkan URL ber-token. Kontrol positif pemindai
    // kini sintetis: URL di -EncodedCommand UTF-16LE (bentuk generator M4) tetap terdeteksi.
    expect(containsSecret(windowsUnattend(ctx()), TOKEN)).toBe(false)
    const synthetic = `powershell -EncodedCommand ${Buffer.from(`Invoke-WebRequest -Uri '${CALLBACK}'`, "utf16le").toString("base64")}`
    expect(containsSecret(`<CommandLine>${synthetic}</CommandLine>`, TOKEN)).toBe(true)
    expect(containsSecret(b64write("/x", "600", Buffer.from(`a ${CALLBACK}`).toString("base64")), TOKEN)).toBe(true)
  })
  it("parameter cmdline per metode selaras dengan installerScript; URL diturunkan hanya untuk MAC & token valid", () => {
    expect(CMDLINE_CONFIG_PARAM).toEqual({ autoinstall: "ds=nocloud-net;s=", preseed: "url=", kickstart: "inst.ks=" })
    for (const m of ["autoinstall", "preseed", "kickstart"] as const) {
      const cmd = callbackCmd(m, MAC, "done")
      expect(evalCallbackUrl(cmd, KCMD[m])).toBe(CALLBACK)
      // Hanya argumen sendiri yang cocok (bukan substring argumen lain).
      expect(evalCallbackUrl(cmd, `x${KCMD[m].split(" ").find((a) => a.startsWith(CMDLINE_CONFIG_PARAM[m]))}`)).toBe("")
      // MAC lain, token bukan 43 karakter, tanpa argumen → kosong (callback tidak dikirim).
      expect(evalCallbackUrl(cmd, KCMD[m].replace(`/boot/${MAC}/`, "/boot/52:54:00:99:00:12/"))).toBe("")
      expect(evalCallbackUrl(cmd, KCMD[m].replace(`/${TOKEN}/`, `/${TOKEN}x/`))).toBe("")
      expect(evalCallbackUrl(cmd, KCMD[m].replace(`/${TOKEN}/`, `/${TOKEN.slice(1)}/`))).toBe("")
      expect(evalCallbackUrl(cmd, "initrd=initrd quiet")).toBe("")
      // https + base URL ber-path tetap didukung.
      expect(evalCallbackUrl(cmd, KCMD[m].replaceAll("http://10.99.0.2/", "https://pxe.lab/x/"))).toBe(CALLBACK.replace("http://10.99.0.2/", "https://pxe.lab/x/"))
    }
    expect(evalCallbackUrl(callbackCmd("kickstart", MAC, "done"), KCMD.kickstart.replace("inst.ks=", "instXks="))).toBe("")
  })
  it("URL tidak ditemukan → file URL tidak ditulis (unit first-boot tidak aktif, ConditionPathExists)", () => {
    expect(runUrlFileCmd(firstbootInstallCmds("", "preseed", MAC)[1], "", "initrd=initrd")).toBeNull()
  })
})
