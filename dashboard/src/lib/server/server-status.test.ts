// AC-4.7 (unit): status DHCP/TFTP/HTTP dari pidfile dnsmasq + file TFTP + media root (probe palsu
// dan file sungguhan di direktori sementara). Route `/api/server-status` diuji di m4-api-routes.test.ts.
import { describe, expect, it } from "vitest"

import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { tmpDir } from "@/test/db"
import { isolateEnv } from "@/test/env"

import { computeServerStatus, dnsmasqState, getServerStatus, realProbe, type StatusProbe } from "./server-status"
import { settingsFromEnv } from "./settings"

isolateEnv()
const DIR = tmpDir("status")

const probe = (files: Record<string, string | true>, alive: number[] = [], unreadable: string[] = []): StatusProbe => ({
  readFile: (p) => {
    const v = files[p]
    if (typeof v !== "string") throw new Error("ENOENT")
    return v
  },
  exists: (p) => p in files,
  readable: (p) => !unreadable.includes(p),
  alive: (pid) => alive.includes(pid),
})

const S = settingsFromEnv({
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_DHCP_INTERFACE: "pxe0",
  PXE_DNSMASQ_PIDFILE: "/run/dnsmasq/dnsmasq.pid",
})
const TFTP = { "/srv/pxe/tftp/snponly.efi": true, "/srv/pxe/tftp/undionly.kpxe": true } as const
const NOW = new Date("2026-11-05T10:00:00.000Z")

const states = (r: ReturnType<typeof computeServerStatus>) => Object.fromEntries(r.services.map((s) => [s.name, s.state]))

describe("AC-4.7 dnsmasqState", () => {
  it("pidfile kosong → unknown; tidak terbaca/rusak/pid ≤ 1 → offline; pid hidup → online", () => {
    expect(dnsmasqState(null, probe({}))).toBe("unknown")
    expect(dnsmasqState("/p", probe({}))).toBe("offline")
    for (const raw of ["", "abc", "12 34", "-5", "1", "0", "12345678901"]) expect(dnsmasqState("/p", probe({ "/p": raw }, [1, 0])), raw).toBe("offline")
    expect(dnsmasqState("/p", probe({ "/p": "4242\n" }, [4242]))).toBe("online")
    expect(dnsmasqState("/p", probe({ "/p": "4242\n" }, []))).toBe("offline")
  })
})

describe("AC-4.7 computeServerStatus", () => {
  it("pidfile proses hidup + file TFTP ada + media terbaca → semua online", () => {
    const r = computeServerStatus(S, probe({ "/run/dnsmasq/dnsmasq.pid": "4242", ...TFTP, "/srv/pxe/media": true }, [4242]), NOW)
    expect(states(r)).toEqual({ DHCP: "online", TFTP: "online", HTTP: "online" })
    expect(r.checkedAt).toBe(NOW.toISOString())
    expect(r.services.every((s) => s.online)).toBe(true)
    expect(r.services.map((s) => s.detail)).toEqual([
      "dnsmasq · pxe0:67/udp",
      "dnsmasq · 10.99.0.2:69/udp",
      "http://10.99.0.2 · media /srv/pxe/media",
    ])
  })
  it("pidfile basi → DHCP & TFTP offline", () => {
    const r = computeServerStatus(S, probe({ "/run/dnsmasq/dnsmasq.pid": "4242", ...TFTP, "/srv/pxe/media": true }, []), NOW)
    expect(states(r)).toEqual({ DHCP: "offline", TFTP: "offline", HTTP: "online" })
    expect(r.services[0].online).toBe(false)
  })
  it("dnsmasq hidup tapi file TFTP hilang → TFTP offline + detail file", () => {
    const r = computeServerStatus(S, probe({ "/run/dnsmasq/dnsmasq.pid": "4242", "/srv/pxe/tftp/snponly.efi": true, "/srv/pxe/media": true }, [4242]), NOW)
    expect(states(r)).toMatchObject({ DHCP: "online", TFTP: "offline" })
    expect(r.services[1].detail).toBe("file hilang di /srv/pxe/tftp: undionly.kpxe")
  })
  it("env kosong (tanpa pidfile, media tidak ada) → unknown semua", () => {
    const r = computeServerStatus(settingsFromEnv({}), probe({}), NOW)
    expect(states(r)).toEqual({ DHCP: "unknown", TFTP: "unknown", HTTP: "unknown" })
    expect(r.services.every((s) => s.online === false)).toBe(true)
    expect(r.services[0].detail).toMatch(/pidfile tidak dikonfigurasi/)
    expect(r.services[2].detail).toBe("media /srv/pxe/media tidak ada")
  })
  it("media ada tapi tidak terbaca → HTTP offline", () => {
    const r = computeServerStatus(S, probe({ "/srv/pxe/media": true }, [], ["/srv/pxe/media"]), NOW)
    expect(states(r).HTTP).toBe("offline")
  })
})

describe("AC-4.7 realProbe + getServerStatus (file sungguhan)", () => {
  it("pidfile = pid proses test (hidup) + TFTP lengkap → online; pid mati → offline", () => {
    const tftp = path.join(DIR, "tftp")
    const media = path.join(DIR, "media")
    mkdirSync(tftp, { recursive: true })
    mkdirSync(media, { recursive: true })
    for (const f of ["snponly.efi", "undionly.kpxe"]) writeFileSync(path.join(tftp, f), "x")
    const pid = path.join(DIR, "dnsmasq.pid")
    writeFileSync(pid, `${process.pid}\n`)
    Object.assign(process.env, { PXE_DNSMASQ_PIDFILE: pid, PXE_TFTP_ROOT: tftp, PXE_MEDIA_ROOT: media })
    expect(states(getServerStatus())).toEqual({ DHCP: "online", TFTP: "online", HTTP: "online" })
    // PID sangat besar hampir pasti tidak ada (ESRCH) → offline.
    writeFileSync(pid, "999999999\n")
    expect(states(getServerStatus())).toMatchObject({ DHCP: "offline", TFTP: "offline" })
    // pid 1 (init, milik root) ditolak sebagai pid dnsmasq.
    writeFileSync(pid, "1\n")
    expect(states(getServerStatus()).DHCP).toBe("offline")
  })
  it("realProbe.readable / exists", () => {
    const f = path.join(DIR, "secret")
    writeFileSync(f, "x")
    chmodSync(f, 0o000)
    expect(realProbe.exists(f)).toBe(true)
    // Root bisa membaca apa pun; test berjalan tanpa sudo (uid ≠ 0).
    expect(realProbe.readable(f)).toBe(process.getuid?.() === 0)
    chmodSync(f, 0o600)
    expect(realProbe.readable(f)).toBe(true)
    expect(realProbe.exists(path.join(DIR, "tidak-ada"))).toBe(false)
    expect(realProbe.alive(process.pid)).toBe(true)
  })
})
