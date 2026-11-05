// AC-2.1: lookupVendor + osLabel.
import { describe, expect, it } from "vitest"

import { lookupVendor } from "./oui"
import { OS_IMAGES, osLabel } from "./os-images"

describe("AC-2.1 lookupVendor", () => {
  it("prefix OUI dikenal → vendor", () => {
    expect(lookupVendor("52:54:00:10:10:11")).toBe("QEMU/KVM")
    expect(lookupVendor("14:18:77:4a:2c:01")).toBe("Dell")
    expect(lookupVendor("0c:c4:7a:91:5e:10")).toBe("Supermicro")
  })
  it("huruf besar diterima", () => {
    expect(lookupVendor("52:54:00:AA:BB:CC")).toBe("QEMU/KVM")
    expect(lookupVendor("F8:BC:12:3A:00:61")).toBe("Dell")
  })
  it("tidak dikenal → null", () => {
    expect(lookupVendor("de:ad:be:ef:00:01")).toBeNull()
    expect(lookupVendor("")).toBeNull()
  })
})

describe("AC-2.1 osLabel", () => {
  it("id katalog → 'Nama Versi'", () => {
    expect(osLabel("ubuntu-24.04.5")).toBe("Ubuntu Server 24.04.5 LTS")
    expect(osLabel("rocky-9.4")).toBe("Rocky Linux 9.4")
    for (const img of OS_IMAGES) expect(osLabel(img.id)).toBe(`${img.name} ${img.version}`)
  })
  it("id asing → id itu sendiri", () => {
    expect(osLabel("arch-2026")).toBe("arch-2026")
  })
  it("null/undefined/kosong → null", () => {
    expect(osLabel(null)).toBeNull()
    expect(osLabel(undefined)).toBeNull()
    expect(osLabel("")).toBeNull()
  })
})
