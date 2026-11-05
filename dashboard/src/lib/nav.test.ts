// AC-1.7: NAV_ITEMS dan navItemFor.
import { describe, expect, it } from "vitest"

import { NAV_ITEMS, navItemFor } from "./nav"

describe("AC-1.7 navigasi", () => {
  it("NAV_ITEMS berisi tepat 5 item berurutan", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Hosts",
      "OS Images",
      "SSH Keys",
      "Provisioning Jobs",
      "Settings",
    ])
    expect(NAV_ITEMS.map((i) => i.href)).toEqual([
      "/hosts",
      "/os-images",
      "/ssh-keys",
      "/jobs",
      "/settings",
    ])
    for (const item of NAV_ITEMS) expect(item.description.length).toBeGreaterThan(0)
  })

  it("cocok untuk path persis dan sub-path", () => {
    expect(navItemFor("/hosts")?.label).toBe("Hosts")
    expect(navItemFor("/hosts/abc")?.label).toBe("Hosts")
    expect(navItemFor("/jobs")?.label).toBe("Provisioning Jobs")
    expect(navItemFor("/settings/network")?.label).toBe("Settings")
  })

  it("undefined untuk /design, /hostsx, dan /", () => {
    expect(navItemFor("/design")).toBeUndefined()
    expect(navItemFor("/hostsx")).toBeUndefined()
    expect(navItemFor("/")).toBeUndefined()
  })
})
