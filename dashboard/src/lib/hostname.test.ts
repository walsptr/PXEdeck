// AC-3.2: validateHostname + renderHostnames.
import { describe, expect, it } from "vitest"

import { renderHostnames, validateHostname, type TemplateHost } from "./hostname"

describe("AC-3.2 validateHostname", () => {
  it("menerima node-01 dan 63 karakter", () => {
    expect(validateHostname("node-01")).toBeNull()
    expect(validateHostname("a")).toBeNull()
    expect(validateHostname("a".repeat(63))).toBeNull()
  })
  it("menolak kosong, > 63, huruf besar, -a, a-, a_b", () => {
    expect(validateHostname("")).toBe("Hostname wajib diisi")
    expect(validateHostname("   ")).toBe("Hostname wajib diisi")
    expect(validateHostname("a".repeat(64))).toBe("Maksimal 63 karakter")
    expect(validateHostname("Node01")).toBe("Gunakan huruf kecil")
    for (const bad of ["-a", "a-", "a_b", "a.b"]) expect(validateHostname(bad), bad).toMatch(/Hanya a–z/)
  })
})

const H: TemplateHost[] = [
  { id: "h1", mac: "14:18:77:4a:2c:01", ip: "10.10.10.21" },
  { id: "h2", mac: "14:18:77:4a:2c:02", ip: "10.10.10.22" },
  { id: "h3", mac: "14:18:77:4a:2c:03", ip: null },
]
const opts = { prefix: "", startIndex: 1 }

describe("AC-3.2 renderHostnames", () => {
  it("node-{index:02} → node-01, node-02, …", () => {
    expect(renderHostnames(H, "node-{index:02}", opts, new Map()).map((r) => [r.hostname, r.error])).toEqual([
      ["node-01", null],
      ["node-02", null],
      ["node-03", null],
    ])
  })
  it("startIndex dihormati; {index} tanpa padding", () => {
    expect(renderHostnames(H, "n{index:03}", { prefix: "", startIndex: 9 }, new Map()).map((r) => r.hostname)).toEqual([
      "n009",
      "n010",
      "n011",
    ])
    expect(renderHostnames(H.slice(0, 2), "n{index}", { prefix: "", startIndex: 0 }, new Map()).map((r) => r.hostname)).toEqual([
      "n0",
      "n1",
    ])
  })
  it("web-{mac_suffix} → 4 hex terakhir MAC", () => {
    expect(renderHostnames(H.slice(0, 2), "web-{mac_suffix}", opts, new Map()).map((r) => r.hostname)).toEqual([
      "web-2c01",
      "web-2c02",
    ])
  })
  it("{prefix}-{ip_last_octet}; host tanpa IP → error per baris", () => {
    const rows = renderHostnames(H, "{prefix}-{ip_last_octet}", { prefix: " Compute ", startIndex: 1 }, new Map())
    expect(rows[0]).toEqual({ hostId: "h1", hostname: "compute-21", error: null })
    expect(rows[1].hostname).toBe("compute-22")
    expect(rows[2].error).toBe("Host belum punya IP untuk {ip_last_octet}")
  })
  it("token asing → error per baris", () => {
    const rows = renderHostnames(H.slice(0, 1), "x-{serial}", opts, new Map())
    expect(rows[0].error).toBe("Token tidak dikenal: {serial}")
  })
  it("hasil invalid (kosong) memakai pesan validateHostname", () => {
    expect(renderHostnames(H.slice(0, 1), "{prefix}", opts, new Map())[0].error).toBe("Hostname wajib diisi")
  })
  it("duplikat dalam batch & nama dipakai host lain → error per baris", () => {
    const rows = renderHostnames(H, "same", opts, new Map())
    expect(rows.map((r) => r.error)).toEqual([null, "Duplikat dalam batch", "Duplikat dalam batch"])
    const taken = renderHostnames(H.slice(0, 2), "node-{index:02}", opts, new Map([["node-02", "52:54:00:00:00:02"]]))
    expect(taken[0].error).toBeNull()
    expect(taken[1].error).toBe("Sudah dipakai 52:54:00:00:00:02")
  })
})
