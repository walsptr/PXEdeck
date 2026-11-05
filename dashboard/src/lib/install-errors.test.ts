import { describe, expect, it } from "vitest"

import { stripHostPrefix } from "@/lib/install-errors"

describe("stripHostPrefix (DR-5-3)", () => {
  it("membuang prefix hostname dari pesan server", () => {
    expect(stripHostPrefix("web-01: belum ada credentials", ["web-01", "52:54:00:99:00:01"])).toBe(
      "belum ada credentials",
    )
  })

  it("membuang prefix MAC bila host belum punya hostname", () => {
    expect(
      stripHostPrefix("52:54:00:99:00:01: belum ada OS image dan credentials", [null, "52:54:00:99:00:01"]),
    ).toBe("belum ada OS image dan credentials")
  })

  it("hanya prefix di awal yang dibuang, sekali", () => {
    expect(stripHostPrefix("web-01: web-01: x", ["web-01"])).toBe("web-01: x")
    expect(stripHostPrefix("OS image web-01: x", ["web-01"])).toBe("OS image web-01: x")
  })

  it("pesan tanpa prefix label dikembalikan utuh", () => {
    expect(stripHostPrefix("Host tidak ditemukan", ["web-01", undefined, ""])).toBe("Host tidak ditemukan")
    expect(stripHostPrefix("web-01:tanpa spasi", ["web-01"])).toBe("web-01:tanpa spasi")
  })
})
