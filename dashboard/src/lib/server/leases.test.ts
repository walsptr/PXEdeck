// AC-4.10 (unit): parser lease dnsmasq + cache mtime; ipMatchesLease (R8: baca ulang sebelum menolak).
import { describe, expect, it } from "vitest"

import { utimesSync, writeFileSync } from "node:fs"
import path from "node:path"

import { tmpDir } from "@/test/db"
import { isolateEnv } from "@/test/env"

import * as leases from "./leases"
import { clearLeaseCache, currentLeases, ipMatchesLease, leaseMap, parseLeases, readLeaseFile } from "./leases"

isolateEnv()
const DIR = tmpDir("leases")
const NOW = 1_800_000_000

const FIXTURE = [
  `${NOW + 3600} 52:54:00:99:00:11 10.99.0.150 * 01:52:54:00:99:00:11`,
  `${NOW + 3600} 52:54:00:99:00:11 10.99.0.151 ubuntu-installer ff:00:99:00:11:00:01:00:01`,
  `0 52:54:00:99:00:12 10.99.0.160 node12 *`,
  `${NOW - 1} 52:54:00:99:00:13 10.99.0.170 * *`, // kedaluwarsa
  `${NOW} 52:54:00:99:00:14 10.99.0.171 * *`, // tepat habis
  `${NOW + 10} 52:54:00:99:00:15 10.99.0.300 * *`, // IP rusak
  `${NOW + 10} 06-52:54:00:99:00:16 10.99.0.172 * *`, // MAC non-ethernet (hwtype)
  `${NOW + 10} 52:54:00:99:00 10.99.0.173 * *`, // MAC pendek
  `abc 52:54:00:99:00:17 10.99.0.174 * *`, // expiry rusak
  `${NOW + 10} 52:54:00:99:00:18`, // kolom kurang
  `duid 00:01:00:01:2a:2b:2c:2d:52:54:00:99:00:11`,
  `${NOW + 10} 1234 fd00::1 * 00:01:00:01`, // IPv6
  `${NOW + 10} 52:54:00:99:00:19 10.99.0.175 bad;host *`, // hostname aneh → null
  "",
  `${NOW + 10} 52:54:00:99:00:1A 10.99.0.176 * *`, // huruf besar → dinormalisasi
].join("\n")

describe("AC-4.10 parseLeases", () => {
  it("baris valid ter-parse (expiry, MAC, IP, hostname '*'→null, client-id diabaikan)", () => {
    const ls = parseLeases(FIXTURE, NOW)
    expect(ls).toEqual([
      { mac: "52:54:00:99:00:11", ip: "10.99.0.150", expiry: NOW + 3600, hostname: null },
      { mac: "52:54:00:99:00:11", ip: "10.99.0.151", expiry: NOW + 3600, hostname: "ubuntu-installer" },
      { mac: "52:54:00:99:00:12", ip: "10.99.0.160", expiry: 0, hostname: "node12" },
      { mac: "52:54:00:99:00:19", ip: "10.99.0.175", expiry: NOW + 10, hostname: null },
      { mac: "52:54:00:99:00:1a", ip: "10.99.0.176", expiry: NOW + 10, hostname: null },
    ])
  })
  it("baris rusak, MAC non-ethernet, IPv6, lease kedaluwarsa diabaikan", () => {
    const macs = parseLeases(FIXTURE, NOW).map((l) => l.mac)
    for (const m of ["52:54:00:99:00:13", "52:54:00:99:00:14", "52:54:00:99:00:15", "52:54:00:99:00:16", "52:54:00:99:00:17", "52:54:00:99:00:18"])
      expect(macs).not.toContain(m)
    expect(parseLeases("", NOW)).toEqual([])
    expect(parseLeases("rusak total\n\n   \n", NOW)).toEqual([])
  })
  it("satu MAC banyak IP → semua IP (leaseMap)", () => {
    const m = leaseMap(parseLeases(FIXTURE, NOW))
    expect([...m.get("52:54:00:99:00:11")!]).toEqual(["10.99.0.150", "10.99.0.151"])
    expect([...m.get("52:54:00:99:00:12")!]).toEqual(["10.99.0.160"])
    expect(m.has("52:54:00:99:00:13")).toBe(false)
  })
})

describe("AC-4.10 readLeaseFile + cache mtime", () => {
  it("file tidak ada → [] tanpa error", () => {
    clearLeaseCache()
    expect(readLeaseFile(path.join(DIR, "tidak-ada.leases"), NOW)).toEqual([])
    expect(leases.leaseFileReads).toBe(0)
  })
  it("file dibaca ulang hanya bila mtime/ukuran berubah; force mengabaikan cache", () => {
    clearLeaseCache()
    const f = path.join(DIR, "cache.leases")
    writeFileSync(f, `${NOW + 100} 52:54:00:99:00:11 10.99.0.150 * *\n`)
    utimesSync(f, 1000, 1000)
    expect(readLeaseFile(f, NOW)).toHaveLength(1)
    expect(readLeaseFile(f, NOW)).toHaveLength(1)
    expect(readLeaseFile(f, NOW)).toHaveLength(1)
    expect(leases.leaseFileReads).toBe(1)
    // Isi berubah dengan mtime + ukuran sama → tetap cache (bukti tidak dibaca ulang).
    writeFileSync(f, `${NOW + 100} 52:54:00:99:00:12 10.99.0.150 * *\n`)
    utimesSync(f, 1000, 1000)
    expect(readLeaseFile(f, NOW)[0].mac).toBe("52:54:00:99:00:11")
    expect(leases.leaseFileReads).toBe(1)
    // mtime berubah → dibaca ulang.
    utimesSync(f, 2000, 2000)
    expect(readLeaseFile(f, NOW)[0].mac).toBe("52:54:00:99:00:12")
    expect(leases.leaseFileReads).toBe(2)
    // force → dibaca ulang walau mtime sama.
    readLeaseFile(f, NOW, true)
    expect(leases.leaseFileReads).toBe(3)
    // Lease kedaluwarsa disaring berdasarkan nowSec saat dibaca (cache menyimpan teks mentah).
    expect(readLeaseFile(f, NOW + 200)).toEqual([])
  })
  it("path direktori (tidak bisa dibaca sebagai file) → [] tanpa error", () => {
    clearLeaseCache()
    expect(readLeaseFile(DIR, NOW)).toEqual([])
  })
})

describe("currentLeases / ipMatchesLease", () => {
  it("PXE_DNSMASQ_LEASES kosong → null (dev, verifikasi IP nonaktif)", () => {
    expect(currentLeases()).toBeNull()
    expect(ipMatchesLease("52:54:00:99:00:11", "10.99.0.150")).toBeNull()
    expect(ipMatchesLease("52:54:00:99:00:11", null)).toBeNull()
  })
  it("lease dikonfigurasi: cocok/tidak cocok/IP null; lease baru ditulis → dibaca ulang sebelum menolak (R8)", () => {
    clearLeaseCache()
    const f = path.join(DIR, "match.leases")
    const exp = Math.floor(Date.now() / 1000) + 3600
    writeFileSync(f, `${exp} 52:54:00:99:00:11 10.99.0.150 * *\n`)
    utimesSync(f, 1000, 1000)
    process.env.PXE_DNSMASQ_LEASES = f
    expect(ipMatchesLease("52:54:00:99:00:11", "10.99.0.150")).toBe(true)
    expect(ipMatchesLease("52:54:00:99:00:11", "10.99.0.1")).toBe(false)
    expect(ipMatchesLease("52:54:00:99:00:11", null)).toBe(false)
    expect(ipMatchesLease("52:54:00:99:00:12", "10.99.0.150")).toBe(false)
    // Lease kedua ditulis dengan mtime + ukuran sama dengan cache → hanya force yang melihatnya.
    writeFileSync(f, `${exp} 52:54:00:99:00:11 10.99.0.151 * *\n`)
    utimesSync(f, 1000, 1000)
    expect(ipMatchesLease("52:54:00:99:00:11", "10.99.0.151")).toBe(true)
  })
})
