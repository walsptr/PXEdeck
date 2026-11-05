import { describe, expect, it } from "vitest"

import { ipToNumber } from "./format"

// Smoke setup tooling (M1-T1). Test fitur lengkap ditulis test-engineer (M2-T4).
describe("ipToNumber", () => {
  it("mengurutkan IPv4 secara numerik", () => {
    expect(ipToNumber("10.0.0.9")).toBeLessThan(ipToNumber("10.0.0.10"))
    expect(ipToNumber(null)).toBe(-1)
  })
})
