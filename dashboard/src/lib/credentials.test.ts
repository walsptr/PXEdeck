// AC-3.3: credentials (username, password, generator, CSV, normalizeMac).
import { describe, expect, it } from "vitest"

import {
  generatePassword,
  neutralizeCsvCell,
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

// ---- Iterasi 2: SR-3-1 / CR-3-7 (formula injection CSV) ----

describe("iter2 SR-3-1 generatePassword: karakter pertama alfanumerik", () => {
  it("10.000 password: tidak ada yang diawali = + - @ (atau non-alfanumerik lain)", () => {
    const bad: string[] = []
    for (let i = 0; i < 10_000; i++) {
      const p = generatePassword(16)
      if (!/^[a-zA-Z0-9]/.test(p) || /^[=+\-@]/.test(p)) bad.push(p[0])
    }
    expect(bad).toEqual([])
  })
  it("karakter simbol tetap dipakai di posisi selain pertama", () => {
    const all = Array.from({ length: 500 }, () => generatePassword(32).slice(1)).join("")
    expect(all).toMatch(/[-_@#%+=]/)
  })
  it("panjang 1 → satu karakter alfanumerik; panjang 0 → string kosong", () => {
    for (let i = 0; i < 200; i++) expect(generatePassword(1)).toMatch(/^[a-zA-Z2-9]$/)
    expect(generatePassword(0)).toBe("")
  })
})

describe("iter2 SR-3-1 neutralizeCsvCell / toCsv", () => {
  it("sel berawalan = + - @ TAB CR diberi prefiks '", () => {
    for (const v of ["=1+2", "+cmd", "-abc", "@SUM(A1)", "\tx", "\rx"]) expect(neutralizeCsvCell(v), JSON.stringify(v)).toBe(`'${v}`)
  })
  it("sel lain tidak berubah (termasuk simbol di tengah dan string kosong)", () => {
    for (const v of ["abc=1", "a-b", "52:54:00:10:10:11", "", "'kutip", " =spasi"]) expect(neutralizeCsvCell(v)).toBe(v)
  })
  it("toCsv menetralkan sebelum quoting; sel biasa tetap round-trip", () => {
    const csv = toCsv([
      ["mac", "hostname", "username", "password"],
      ["52:54:00:00:00:01", "", "ops", "=HYPERLINK(\"http://x\",\"a\")"],
      ["52:54:00:00:00:02", "", "ops", "-2+3,4"],
      ["52:54:00:00:00:03", "", "ops", "aman-123"],
    ])
    const lines = csv.split("\r\n")
    expect(lines[1]).toBe(`52:54:00:00:00:01,,ops,"'=HYPERLINK(""http://x"",""a"")"`)
    expect(lines[2]).toBe(`52:54:00:00:00:02,,ops,"'-2+3,4"`)
    expect(lines[3]).toBe("52:54:00:00:00:03,,ops,aman-123")
    // Tidak ada sel hasil parse yang diawali karakter formula.
    for (const row of parseCsv(csv)) for (const cell of row) expect(cell).not.toMatch(/^[=+\-@\t\r]/)
  })
})
