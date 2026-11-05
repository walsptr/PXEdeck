// M4-T9 unit: script iPXE (boot-script.ts), token (tokens.ts), IP sumber (request-ip.ts),
// helper respons /boot (boot-http.ts). Mendukung AC-4.13..4.16, AC-4.9 (TRUST_PROXY), AC-4.24.
import { describe, expect, it, vi } from "vitest"

import { isolateEnv } from "@/test/env"

import { logBootDenied, notFoundUniform, textResponse } from "./boot-http"
import {
  ENTRY_RETRIES,
  entryScript,
  installerScript,
  IPXE_EXIT_TO_NEXT,
  ipxeSafe,
  localBootScript,
  WAIT_MAX_ITERATIONS,
  waitScript,
  type InstallerScriptInput,
} from "./boot-script"
import { ipFromHeaders, requestIp } from "./request-ip"
import { hashToken, isTokenShape, newToken, TOKEN_RE } from "./tokens"

isolateEnv()

const BASE: Omit<InstallerScriptInput, "method" | "source"> = {
  mediaUrl: "http://10.99.0.2/media",
  mediaRoot: "/srv/pxe/media",
  serverIp: "10.99.0.2",
  configUrl: "http://10.99.0.2/boot/52:54:00:99:00:11/TOKEN_abcdefghijklmnopqrstuvwxyz0123456789ABCD/",
  extraArgs: "console=ttyS0,115200n8 console=tty0",
}
const SRC = {
  ubuntu: { kernel: "ubuntu-24.04/casper/vmlinuz", initrd: "ubuntu-24.04/casper/initrd", repo: "ubuntu-24.04" },
  debian: { kernel: "debian-netboot/linux", initrd: "debian-netboot/initrd.gz", repo: "debian-12" },
  rocky: { kernel: "rocky-9/images/pxeboot/vmlinuz", initrd: "rocky-9/images/pxeboot/initrd.img", repo: "rocky-9" },
}

describe("entryScript (AC-4.13)", () => {
  it("#!ipxe, chain ke ${base}/boot/${mac}.ipxe?platform=${platform}, retry terbatas lalu exit", () => {
    const s = entryScript("http://10.99.0.2")
    expect(s.startsWith("#!ipxe\n")).toBe(true)
    const chains = s.split("\n").filter((l) => l.startsWith("chain "))
    expect(chains).toHaveLength(ENTRY_RETRIES)
    for (const c of chains) expect(c).toContain("chain --replace --autofree http://10.99.0.2/boot/${mac}.ipxe?platform=${platform} || goto ")
    expect(s.match(/sleep 5/g)).toHaveLength(ENTRY_RETRIES - 1)
    expect(s.trimEnd().endsWith("\nexit 1")).toBe(true)
    expect(s).toMatchInlineSnapshot(`
      "#!ipxe
      :try1
      chain --replace --autofree http://10.99.0.2/boot/\${mac}.ipxe?platform=\${platform} || goto try2
      :try2
      sleep 5
      chain --replace --autofree http://10.99.0.2/boot/\${mac}.ipxe?platform=\${platform} || goto try3
      :try3
      sleep 5
      chain --replace --autofree http://10.99.0.2/boot/\${mac}.ipxe?platform=\${platform} || goto fail
      :fail
      echo PXE dashboard tidak dapat dihubungi, boot lokal
      exit 1
      "
    `)
  })
  it("base URL tidak aman ditolak", () => {
    expect(() => entryScript("http://x y")).toThrow(/tidak aman/)
    expect(() => entryScript("http://x/${a}")).toThrow(/tidak aman/)
  })
})

describe("localBootScript / waitScript (AC-4.14)", () => {
  it("boot lokal: EFI exit, BIOS sanboot drive 0x80, tanpa kernel", () => {
    const s = localBootScript()
    expect(s.startsWith("#!ipxe\n")).toBe(true)
    expect(s).toContain("iseq ${platform} efi && exit 1 ||")
    expect(s).toContain("sanboot --no-describe --drive 0x80 || exit 1")
    expect(s).not.toMatch(/\bkernel\b/)
    expect(s).toMatchInlineSnapshot(`
      "#!ipxe
      echo Tidak ada instalasi aktif: boot dari disk lokal
      iseq \${platform} efi && exit 1 ||
      sanboot --no-describe --drive 0x80 || exit 1
      "
    `)
  })
  it("B-4: setiap exit berstatus ≠ 0 (EFI_SUCCESS membuat BDS OVMF berhenti di menu boot, disk tak dicoba)", () => {
    expect(IPXE_EXIT_TO_NEXT).toBe("exit 1")
    const scripts = [entryScript("http://10.99.0.2"), localBootScript(), waitScript("http://10.99.0.2", "52:54:00:99:00:11", 0)]
    for (const sc of scripts) {
      const exits = sc.match(/\bexit\b(?: \S+)?/g) ?? []
      expect(exits.length, sc).toBeGreaterThan(0)
      for (const e of exits) expect(e, sc).toBe("exit 1")
    }
  })
  it("wait: sleep 30 lalu chain dengan wait=n+1; batas iterasi → boot lokal", () => {
    const s = waitScript("http://10.99.0.2", "52:54:00:99:00:11", 3)
    expect(s).toContain("sleep 30")
    // CR-4-5 (M5, AC-5.21): `--replace` seperti entry.ipxe.
    expect(s).toContain("chain --replace --autofree http://10.99.0.2/boot/52:54:00:99:00:11.ipxe?platform=${platform}&wait=4 || exit 1")
    expect(s).toContain(`(4/${WAIT_MAX_ITERATIONS})`)
    expect(waitScript("http://10.99.0.2", "52:54:00:99:00:11", WAIT_MAX_ITERATIONS)).toBe(localBootScript())
    expect(waitScript("http://10.99.0.2", "52:54:00:99:00:11", WAIT_MAX_ITERATIONS + 5)).toBe(localBootScript())
  })
})

describe("installerScript (AC-4.15, AC-4.16)", () => {
  it("Ubuntu: kernel HTTP + NFS root + nocloud, initrd=initrd, extra args, tanpa url=", () => {
    const s = installerScript({ ...BASE, method: "autoinstall", source: SRC.ubuntu })
    const [hdr, kernel, initrd, boot] = s.trimEnd().split("\n")
    expect(hdr).toBe("#!ipxe")
    expect(kernel).toBe(
      "kernel http://10.99.0.2/media/ubuntu-24.04/casper/vmlinuz initrd=initrd ip=dhcp netboot=nfs " +
        "nfsroot=10.99.0.2:/srv/pxe/media/ubuntu-24.04 autoinstall " +
        `ds=nocloud-net;s=${BASE.configUrl} cloud-config-url=/dev/null console=ttyS0,115200n8 console=tty0 ---`,
    )
    expect(initrd).toBe("initrd --name initrd http://10.99.0.2/media/ubuntu-24.04/casper/initrd")
    expect(boot).toBe("boot")
    // Tidak ada parameter kernel `url=` (ISO ke RAM, O6); `cloud-config-url=` adalah parameter lain.
    expect(kernel.split(" ").filter((a) => a.startsWith("url="))).toEqual([])
    expect(s).not.toMatch(/(^|\s)url=/m)
  })
  it("Debian: netboot + preseed/url", () => {
    const s = installerScript({ ...BASE, method: "preseed", source: SRC.debian })
    expect(s).toBe(
      [
        "#!ipxe",
        `kernel http://10.99.0.2/media/debian-netboot/linux initrd=initrd auto=true priority=critical url=${BASE.configUrl}preseed.cfg interface=auto netcfg/dhcp_timeout=60 console=ttyS0,115200n8 console=tty0 ---`,
        "initrd --name initrd http://10.99.0.2/media/debian-netboot/initrd.gz",
        "boot",
        "",
      ].join("\n"),
    )
  })
  it("Rocky: inst.stage2 NFS (DEC-020) + inst.ks + inst.cmdline (BUG-M6-5)", () => {
    const s = installerScript({ ...BASE, method: "kickstart", source: SRC.rocky, extraArgs: "" })
    expect(s).toBe(
      [
        "#!ipxe",
        `kernel http://10.99.0.2/media/rocky-9/images/pxeboot/vmlinuz initrd=initrd ip=dhcp inst.stage2=nfs:10.99.0.2:/srv/pxe/media/rocky-9 inst.ks=${BASE.configUrl}ks.cfg inst.cmdline`,
        "initrd --name initrd http://10.99.0.2/media/rocky-9/images/pxeboot/initrd.img",
        "boot",
        "",
      ].join("\n"),
    )
  })
  it("Windows (unattend) tidak pernah menghasilkan script installer", () => {
    expect(() => installerScript({ ...BASE, method: "unattend", source: SRC.ubuntu })).toThrow(/tidak bisa di-boot/)
  })
  it("nilai tidak aman (spasi, $, newline) ditolak di setiap komponen", () => {
    for (const bad of [
      { configUrl: "http://x/${evil}/" },
      { mediaUrl: "http://x/media\nshell" },
      { mediaRoot: "/srv pxe" },
      { serverIp: "10.99.0.2 kernel" },
      { extraArgs: "console=ttyS0 $x" },
      { source: { ...SRC.ubuntu, kernel: "a b" } },
      { source: { ...SRC.ubuntu, initrd: "a`b`" } },
      { source: { ...SRC.ubuntu, repo: "r\n" } },
    ] as Partial<InstallerScriptInput>[]) {
      expect(() => installerScript({ ...BASE, method: "autoinstall", source: SRC.ubuntu, ...bad }), JSON.stringify(bad)).toThrow(/tidak aman/)
    }
    expect(ipxeSafe("abc-1.2:/=@+%?&;,_", "x")).toBe("abc-1.2:/=@+%?&;,_")
  })
})

describe("tokens (AC-4.24)", () => {
  it("newToken: 43 karakter base64url, acak, hash = sha256 hex", () => {
    const a = newToken()
    const b = newToken()
    expect(a.token).toMatch(TOKEN_RE)
    expect(a.token).toHaveLength(43)
    expect(a.token).not.toBe(b.token)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.hash).toBe(hashToken(a.token))
    expect(a.hash).not.toContain(a.token)
    // Vektor sha256 standar.
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })
  it("isTokenShape", () => {
    expect(isTokenShape("A".repeat(43))).toBe(true)
    expect(isTokenShape("A".repeat(42))).toBe(false)
    expect(isTokenShape("A".repeat(44))).toBe(false)
    expect(isTokenShape(`${"A".repeat(42)}=`)).toBe(false)
    expect(isTokenShape(`${"A".repeat(42)}/`)).toBe(false)
  })
})

describe("request-ip (AC-4.9: PXE_TRUST_PROXY)", () => {
  const h = (v?: string) => new Headers(v === undefined ? {} : { "x-real-ip": v })
  it("trust=false → selalu null; trust=true → X-Real-IP IPv4 valid saja", () => {
    expect(ipFromHeaders(h("10.99.0.150"), false)).toBeNull()
    expect(ipFromHeaders(h("10.99.0.150"), true)).toBe("10.99.0.150")
    expect(ipFromHeaders(h(" 10.99.0.150 "), true)).toBe("10.99.0.150")
    expect(ipFromHeaders(h(), true)).toBeNull()
    expect(ipFromHeaders(h("10.99.0.150, 10.0.0.1"), true)).toBeNull()
    expect(ipFromHeaders(h("::1"), true)).toBeNull()
    expect(ipFromHeaders(h("999.1.1.1"), true)).toBeNull()
  })
  it("requestIp membaca PXE_TRUST_PROXY dari settings", () => {
    const req = new Request("http://localhost/boot/x", { headers: { "x-real-ip": "10.99.0.150" } })
    expect(requestIp(req)).toBeNull()
    process.env.PXE_TRUST_PROXY = "1"
    // DEC-013 (M5): trust proxy wajib file lease (fail-closed).
    process.env.PXE_DNSMASQ_LEASES = "/var/lib/misc/dnsmasq.leases"
    expect(requestIp(req)).toBe("10.99.0.150")
  })
})

describe("boot-http", () => {
  it("textResponse: text/plain + no-store; notFoundUniform identik", async () => {
    const r = textResponse("#!ipxe\n")
    expect(r.status).toBe(200)
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(r.headers.get("cache-control")).toBe("no-store")
    const a = notFoundUniform()
    const b = notFoundUniform()
    expect(a.status).toBe(404)
    expect(await a.text()).toBe("not found\n")
    expect(await b.text()).toBe("not found\n")
    expect(a.headers.get("cache-control")).toBe("no-store")
    expect(textResponse("<x/>", 200, "application/xml").headers.get("content-type")).toBe("application/xml")
  })
  it("logBootDenied: diam saat Vitest / PXE_LOG_BOOT=0; di luar test mencatat MAC + alasan (tanpa token)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    logBootDenied("file", "52:54:00:99:00:11", "ip")
    expect(warn).not.toHaveBeenCalled()
    vi.stubEnv("VITEST", "")
    try {
      logBootDenied("status", "52:54:00:99:00:11", "token-unknown")
      expect(warn).toHaveBeenCalledWith("[boot] tolak status mac=52:54:00:99:00:11 alasan=token-unknown")
      warn.mockClear()
      process.env.PXE_LOG_BOOT = "0"
      logBootDenied("file", "-", "mac-invalid")
      expect(warn).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
      warn.mockRestore()
    }
  })
})
