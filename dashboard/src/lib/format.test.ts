// AC-2.2: formatRelative (clock dikunci) + ipToNumber.
import { describe, expect, it } from "vitest"

import { formatDateTime, formatRelative, ipToNumber } from "./format"

const NOW = Date.parse("2026-11-05T10:00:00.000Z")
const ago = (ms: number) => new Date(NOW - ms).toISOString()
// Pembanding: keluaran ICU runtime dalam bentuk numerik ("N unit yang lalu") sesuai teks AC-2.2.
const rtf = new Intl.RelativeTimeFormat("id", { numeric: "always" })

describe("AC-2.2 formatRelative", () => {
  it("selisih < 45 dtk → 'baru saja'", () => {
    expect(formatRelative(ago(0), NOW)).toBe("baru saja")
    expect(formatRelative(ago(44_000), NOW)).toBe("baru saja")
    expect(formatRelative(new Date(NOW + 30_000).toISOString(), NOW)).toBe("baru saja")
  })
  it("2 menit → '2 menit yang lalu'", () => {
    const out = formatRelative(ago(2 * 60_000), NOW)
    expect(out).toBe(rtf.format(-2, "minute"))
    expect(out).toBe("2 menit yang lalu")
  })
  it("45 dtk dibulatkan ke menit", () => {
    expect(formatRelative(ago(50_000), NOW)).toBe(rtf.format(-1, "minute"))
  })
  it("3 jam → '3 jam yang lalu'", () => {
    const out = formatRelative(ago(3 * 3_600_000), NOW)
    expect(out).toBe(rtf.format(-3, "hour"))
    expect(out).toBe("3 jam yang lalu")
  })
  it("2 hari → '2 hari yang lalu'", () => {
    const out = formatRelative(ago(2 * 86_400_000), NOW)
    expect(out).toBe(rtf.format(-2, "day"))
    expect(out).toBe("2 hari yang lalu")
  })
  it("iter2 (CR-2-1): 1 hari → '1 hari yang lalu' (bukan 'kemarin'); 1 jam/1 menit numerik", () => {
    expect(formatRelative(ago(86_400_000), NOW)).toBe("1 hari yang lalu")
    expect(formatRelative(ago(3_600_000), NOW)).toBe("1 jam yang lalu")
    expect(formatRelative(ago(60_000), NOW)).toBe("1 menit yang lalu")
  })
  it("iter2: masa depan memakai numerik ('dalam 1 hari', bukan 'besok')", () => {
    expect(formatRelative(new Date(NOW + 86_400_000).toISOString(), NOW)).toBe(rtf.format(1, "day"))
    expect(formatRelative(new Date(NOW + 86_400_000).toISOString(), NOW)).not.toBe("besok")
  })
})

describe("AC-2.2 ipToNumber", () => {
  it("urutan numerik benar", () => {
    expect(ipToNumber("10.0.0.9")).toBeLessThan(ipToNumber("10.0.0.10"))
    expect(ipToNumber("10.10.10.2")).toBeLessThan(ipToNumber("10.10.10.100"))
    expect(ipToNumber("9.255.255.255")).toBeLessThan(ipToNumber("10.0.0.0"))
    expect(ipToNumber("10.0.0.1")).toBe(167772161)
  })
  it("null → -1", () => {
    expect(ipToNumber(null)).toBe(-1)
  })
})

describe("formatDateTime", () => {
  it("memformat ISO dengan locale id", () => {
    const iso = "2026-11-05T10:00:00.000Z"
    expect(formatDateTime(iso)).toBe(
      new Intl.DateTimeFormat("id", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso)),
    )
  })
})
