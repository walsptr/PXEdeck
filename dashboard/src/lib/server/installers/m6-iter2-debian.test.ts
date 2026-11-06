// M6 iterasi 2 (gate-iter1 R4, DEC-022 §2–§3) — generator Debian:
//   SR-6-1 / CR-6-3  DEC-021 fail-closed: `[trusted=yes]`, `allow_unauthenticated true`, hook 50mirror
//                    dan pembersihan `00AllowUnauthenticated` hanya untuk media server PXE lokal
//                    (host PXE_MEDIA_URL = PXE_SERVER_IP); media lain → InstallerInputError.
//   SR-6-6           pembersihan `trusted=yes` sebelum unit firstboot dipasang.
//   CR-6-1           batas aman `preseed/late_command` (DEBIAN_LATE_COMMAND_MAX_BYTES) dan konfigurasi
//                    maksimum yang diizinkan validasi (AUTHORIZED_KEYS_MAX_BYTES) tetap di bawahnya.
import { describe, expect, it } from "vitest"

import { AUTHORIZED_KEYS_MAX_BYTES, authorizedKeysBytes } from "@/lib/host-config"
import { SSH_ED25519 } from "@/test/fixtures"
import { synthKey, synthKeysTotal } from "@/test/synth-keys"

import { InstallerInputError, isLocalMedia, sanitizeKey, type InstallContext } from "./context"
import { DEBIAN_LATE_COMMAND_MAX_BYTES, DEBIAN_UNTRUST_CMD, debianLateScript, debianPreseed } from "./debian"

const MAC = "52:54:00:99:00:51"
const TOKEN = "FIXTURE-token-not-real_00000000000000000000"
const FAKE_HASH = `$6$fixturesalt$${"AbCdEfGhIjKlMnOpQrStUvWxYz0123456789./".repeat(3).slice(0, 86)}`
/** Linux `MAX_ARG_STRLEN` (32 halaman × 4096). */
const MAX_ARG_STRLEN = 131_072

function ctx(over: Partial<InstallContext> = {}): InstallContext {
  return {
    jobId: "job-0b6c3f0e-1d2a-4c6b-9f00-000000000051",
    mac: MAC,
    hostname: "m6-node51",
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
  }
}
const lateLine = (p: string) => p.split("\n").find((l) => l.startsWith("d-i preseed/late_command "))!

describe("DEC-022 §2 isLocalMedia (host media = PXE_SERVER_IP)", () => {
  it.each([
    ["http://10.99.0.2/media", "10.99.0.2", true],
    ["http://10.99.0.2:8080/media", "10.99.0.2", true],
    ["https://10.99.0.2/x/y", "10.99.0.2", true],
    ["http://10.99.0.20/media", "10.99.0.2", false],
    ["http://10.99.0.3/media", "10.99.0.2", false],
    ["http://deb.debian.org/debian", "10.99.0.2", false],
    ["http://pxe.lab.example/media", "10.99.0.2", false],
    ["http://10.99.0.2.evil.example/media", "10.99.0.2", false],
    ["http://user@10.99.0.3/media", "10.99.0.2", false],
    ["bukan url", "10.99.0.2", false],
    ["http://10.99.0.2/media", "bukan-ip", false],
  ])("%s vs %s → %s", (url, ip, want) => {
    expect(isLocalMedia(url, ip)).toBe(want)
  })
})

describe("SR-6-1 / CR-6-3 DEC-021 fail-closed di generator Debian", () => {
  it("media lokal: trusted=yes, allow_unauthenticated, hook 50mirror, dan pembersihan ada", () => {
    const p = debianPreseed(ctx())
    expect(p).toContain("d-i apt-setup/local0/repository string [trusted=yes by-hash=no] http://10.99.0.2/media/debian-12 bookworm main")
    expect(p).toContain("d-i debian-installer/allow_unauthenticated boolean true")
    expect(p).toContain("chmod a-x /usr/lib/apt-setup/generators/50mirror")
    expect(debianLateScript(ctx())).toContain(DEBIAN_UNTRUST_CMD)
  })
  it.each([
    "http://deb.debian.org/debian",
    "http://10.99.0.3/media",
    "http://pxe.lab.example/media",
    "http://10.99.0.20/media",
  ])("media eksternal %s → InstallerInputError, tidak ada preseed (tanpa trusted=yes / allow_unauthenticated)", (mediaUrl) => {
    let out: string | null = null
    let err: unknown = null
    try {
      out = debianPreseed(ctx({ mediaUrl }))
    } catch (e) {
      err = e
    }
    expect(out).toBeNull()
    expect(err).toBeInstanceOf(InstallerInputError)
    expect((err as Error).message).toMatch(/bukan server PXE lokal \(10\.99\.0\.2\)/)
    expect((err as Error).message).toMatch(/DEC-021/)
    expect(() => debianLateScript(ctx({ mediaUrl }))).toThrow(InstallerInputError)
  })
  it("serverIp berbeda dari host media yang sama → ditolak (aturan memakai PXE_SERVER_IP, bukan host media saja)", () => {
    expect(() => debianPreseed(ctx({ serverIp: "10.99.0.5", callbackUrl: `http://10.99.0.5/boot/${MAC}/${TOKEN}/status` }))).toThrow(
      /bukan server PXE lokal \(10\.99\.0\.5\)/,
    )
  })
})

describe("SR-6-6 pembersihan trusted=yes sebelum firstboot", () => {
  it("baris DEBIAN_UNTRUST_CMD mendahului semua perintah firstboot (pxe-callback) di late script", () => {
    const lines = debianLateScript(ctx()).split("\n")
    const untrust = lines.indexOf(DEBIAN_UNTRUST_CMD)
    expect(untrust).toBeGreaterThan(0)
    const firstboot = lines.findIndex((l) => /pxe-callback/.test(l))
    expect(firstboot).toBeGreaterThan(untrust)
  })
})

describe("CR-6-1 batas late_command Debian", () => {
  it("konstanta: batas generator < MAX_ARG_STRLEN; batas authorized_keys 32 KiB", () => {
    expect(DEBIAN_LATE_COMMAND_MAX_BYTES).toBe(100_000)
    expect(DEBIAN_LATE_COMMAND_MAX_BYTES).toBeLessThan(MAX_ARG_STRLEN)
    expect(AUTHORIZED_KEYS_MAX_BYTES).toBe(32_768)
  })
  it("konfigurasi maksimum yang diizinkan (authorized_keys tepat 32 KiB, semua opsi terpanjang) → late_command ≤ batas", () => {
    const keys = synthKeysTotal(AUTHORIZED_KEYS_MAX_BYTES).map(sanitizeKey)
    expect(authorizedKeysBytes(keys)).toBe(AUTHORIZED_KEYS_MAX_BYTES)
    const max = ctx({
      hostname: `h${"a".repeat(61)}z`,
      username: "u".repeat(32),
      sudo: true,
      disableSshPassword: true,
      network: {
        mode: "static",
        ip: "223.255.255.254",
        prefix: 24,
        gateway: "223.255.255.253",
        dns: ["223.255.255.251", "223.255.255.252", "223.255.255.250", "223.255.255.249"],
        vlan: 4094,
        iface: { by: "name", name: "a".repeat(15) },
      },
      authorizedKeys: keys,
      storage: { partition: "lvm", disk: `/dev/${"d".repeat(100)}` },
      timezone: "America/Argentina/Buenos_Aires",
    })
    const line = lateLine(debianPreseed(max))
    const bytes = Buffer.byteLength(line)
    expect(bytes).toBeLessThanOrEqual(DEBIAN_LATE_COMMAND_MAX_BYTES)
    expect(bytes).toBeGreaterThan(50_000) // uji tidak hampa: kunci 32 KiB benar-benar masuk
  })
  it("authorized_keys jauh di atas batas config (mis. config lama 64 KiB) → InstallerInputError, bukan preseed > batas", () => {
    const keys = synthKeysTotal(64 * 1024).map(sanitizeKey)
    expect(() => debianPreseed(ctx({ authorizedKeys: keys }))).toThrow(InstallerInputError)
    expect(() => debianPreseed(ctx({ authorizedKeys: keys }))).toThrow(/late_command \d+ byte melebihi batas aman 100000 byte/)
  })
  it("tepat di sekitar ambang generator: ≤ batas lolos, > batas ditolak", () => {
    // Cari jumlah byte key terbesar yang masih lolos (bisection), lalu buktikan +1 key kecil ditolak.
    const render = (n: number) => {
      try {
        return Buffer.byteLength(lateLine(debianPreseed(ctx({ authorizedKeys: synthKeysTotal(n).map(sanitizeKey) }))))
      } catch (e) {
        if (e instanceof InstallerInputError) return null
        throw e
      }
    }
    let lo = 32_768
    let hi = 64 * 1024
    expect(render(lo)).not.toBeNull()
    expect(render(hi)).toBeNull()
    while (hi - lo > 64) {
      const mid = (lo + hi) >> 1
      if (render(mid) === null) hi = mid
      else lo = mid
    }
    expect(render(lo)!).toBeLessThanOrEqual(DEBIAN_LATE_COMMAND_MAX_BYTES)
    expect(render(hi)).toBeNull()
  })
  it("synthKey menghasilkan key valid dengan panjang tepat", () => {
    const k = synthKey(7, 500)
    expect(k).toHaveLength(500)
    expect(sanitizeKey(k)).toBe(k)
  })
})
