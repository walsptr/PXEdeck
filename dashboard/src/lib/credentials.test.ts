// AC-3.3: credentials (username, password, generator, CSV, normalizeMac).
import { describe, expect, it } from "vitest"

import {
  generatePassword,
  normalizeMac,
  parseCsv,
  toCsv,
  validatePassword,
  validateUsername,
} from "./credentials"

describe("AC-3.3 validateUsername", () => {
  it("menerima username Linux valid", () => {
    for (const ok of ["ubuntu", "_svc", "ops-1", "a".repeat(32)]) expect(validateUsername(ok), ok).toBeNull()
  })
  it("menolak kosong, huruf besar, diawali angka, > 32, root", () => {
    expect(validateUsername("")).toBe("Username wajib diisi")
    expect(validateUsername("Ubuntu")).toMatch(/Huruf kecil/)
    expect(validateUsername("1admin")).toMatch(/Huruf kecil/)
    expect(validateUsername("a".repeat(33))).toMatch(/maks 32/)
    expect(validateUsername("root")).toBe('"root" adalah user sistem')
    expect(validateUsername("nobody")).toMatch(/user sistem/)
  })
})

describe("AC-3.3 validatePassword", () => {
  it("menolak < 8, > 128, newline", () => {
    expect(validatePassword("1234567")).toBe("Minimal 8 karakter")
    expect(validatePassword("x".repeat(129))).toBe("Maksimal 128 karakter")
    expect(validatePassword("abcdefgh\nij")).toBe("Tidak boleh berisi baris baru")
    expect(validatePassword("abcdefgh\rij")).toBe("Tidak boleh berisi baris baru")
  })
  it("menerima 8 dan 128 karakter", () => {
    expect(validatePassword("12345678")).toBeNull()
    expect(validatePassword("x".repeat(128))).toBeNull()
  })
})

describe("AC-3.3 generatePassword", () => {
  it("panjang n, alfabet tanpa karakter ambigu/kutip", () => {
    for (const n of [12, 16, 32, 64]) {
      const p = generatePassword(n)
      expect(p).toHaveLength(n)
      expect(p).not.toMatch(/[0OlI1'"`]/)
      expect(p).toMatch(/^[a-zA-Z2-9\-_@#%+=]+$/)
    }
    expect(generatePassword()).toHaveLength(16)
  })
  it("100 panggilan → 100 nilai unik", () => {
    expect(new Set(Array.from({ length: 100 }, () => generatePassword(16))).size).toBe(100)
  })
})

describe("AC-3.3 parseCsv/toCsv", () => {
  it("round-trip field berkoma, berkutip, dan CRLF", () => {
    const rows = [
      ["mac", "username", "password"],
      ["52:54:00:00:00:01", "ops", 'pa,ss"word'],
      ["52:54:00:00:00:02", "dev", "multi\r\nline"],
    ]
    const csv = toCsv(rows)
    expect(csv).toContain('"pa,ss""word"')
    expect(csv.split("\r\n")[0]).toBe("mac,username,password")
    expect(parseCsv(csv)).toEqual(rows)
  })
  it("LF/CRLF campuran, baris kosong diabaikan, baris terakhir tanpa newline", () => {
    expect(parseCsv("a,b\r\n\r\nc,d\n\ne,f")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ])
    expect(parseCsv("a,\n")).toEqual([["a", ""]])
    expect(parseCsv("")).toEqual([])
  })
})

describe("AC-3.3 normalizeMac", () => {
  it("menerima berbagai format → aa:bb:…", () => {
    expect(normalizeMac("AA-BB-CC-DD-EE-FF")).toBe("aa:bb:cc:dd:ee:ff")
    expect(normalizeMac("aabb.ccdd.eeff")).toBe("aa:bb:cc:dd:ee:ff")
    expect(normalizeMac("aabbccddeeff")).toBe("aa:bb:cc:dd:ee:ff")
    expect(normalizeMac(" aa:bb:cc:dd:ee:ff ")).toBe("aa:bb:cc:dd:ee:ff")
  })
  it("menolak panjang salah/karakter non-hex", () => {
    expect(normalizeMac("aa:bb:cc:dd:ee")).toBeNull()
    expect(normalizeMac("aa:bb:cc:dd:ee:ff:00")).toBeNull()
    expect(normalizeMac("gg:bb:cc:dd:ee:ff")).toBeNull()
    expect(normalizeMac("")).toBeNull()
  })
})
