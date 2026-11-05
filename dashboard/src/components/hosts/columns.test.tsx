// AC-2.7: filter & sort tabel host diuji lewat instance TanStack Table v9 headless
// (useTable via renderHook) dengan konfigurasi yang sama seperti hosts-view.tsx.
import { renderHook } from "@testing-library/react"
import { useTable, type TableState } from "@tanstack/react-table"
import { describe, expect, it } from "vitest"

import type { Host } from "@/lib/types"

import { columns, features, hostGlobalFilter } from "./columns"

function host(p: Partial<Host> & { id: string; mac: string }): Host {
  return {
    hostname: null,
    currentIp: null,
    mgmtIp: null,
    vendor: null,
    firmware: "uefi",
    osInstalled: null,
    osAssigned: null,
    status: "discovered",
    statusSince: "2026-11-05T10:00:00.000Z",
    lastSeen: "2026-11-05T10:00:00.000Z",
    ...p,
  }
}

const HOSTS: Host[] = [
  host({ id: "525400101011", mac: "52:54:00:10:10:11", hostname: "node01", currentIp: "10.10.10.9", mgmtIp: "10.10.10.11", osInstalled: "ubuntu-24.04.5", status: "done" }),
  host({ id: "14187740ab01", mac: "14:18:77:40:ab:01", hostname: "ctrl-01", currentIp: "10.10.10.10", osAssigned: "rocky-9.4", status: "installing" }),
  host({ id: "0cc47a915e10", mac: "0c:c4:7a:91:5e:10", currentIp: "10.10.10.100", mgmtIp: "10.10.10.31", status: "booting" }),
  host({ id: "b083fe5c19e2", mac: "b0:83:fe:5c:19:e2", currentIp: "10.10.10.2", status: "failed", osInstalled: "debian-12", osAssigned: "ubuntu-24.04.5" }),
  host({ id: "9440c96e01ab", mac: "94:40:c9:6e:01:ab", hostname: "storage-02", status: "offline" }),
]

function rows(state: Partial<TableState<typeof features>>) {
  const { result } = renderHook(() =>
    useTable({
      features,
      columns,
      data: HOSTS,
      getRowId: (h) => h.id,
      initialState: state,
      globalFilterFn: hostGlobalFilter,
      getColumnCanGlobalFilter: (column) => column.id === "mac",
    }),
  )
  return result.current.getRowModel().rows.map((r) => r.original.id)
}

describe("AC-2.7 pencarian global", () => {
  it("format MAC 52-54-00, 525400, 52:54:00 setara", () => {
    for (const q of ["52-54-00", "525400", "52:54:00", "52.54.00".replaceAll(".", ":"), "52:54:00:10:10:11"])
      expect(rows({ globalFilter: q }), q).toEqual(["525400101011"])
  })
  it("cocok pada hostname, IP lease, IP management (case-insensitive)", () => {
    expect(rows({ globalFilter: "CTRL" })).toEqual(["14187740ab01"])
    expect(rows({ globalFilter: "10.10.10.100" })).toEqual(["0cc47a915e10"])
    expect(rows({ globalFilter: "10.10.10.31" })).toEqual(["0cc47a915e10"])
    expect(rows({ globalFilter: "storage" })).toEqual(["9440c96e01ab"])
  })
  it("query kosong = semua; tanpa kecocokan = kosong", () => {
    expect(rows({ globalFilter: "  " })).toHaveLength(5)
    expect(rows({ globalFilter: "tidak-ada" })).toEqual([])
    expect(rows({ globalFilter: "::" })).toEqual([])
  })
})

describe("AC-2.7 filter kolom", () => {
  it("filter status multi-nilai", () => {
    expect(rows({ columnFilters: [{ id: "status", value: ["done", "failed"] }] }).sort()).toEqual(
      ["525400101011", "b083fe5c19e2"].sort(),
    )
    expect(rows({ columnFilters: [{ id: "status", value: ["offline"] }] })).toEqual(["9440c96e01ab"])
  })
  it("filter OS cocok dengan terpasang ATAU ditugaskan", () => {
    expect(rows({ columnFilters: [{ id: "os", value: "ubuntu-24.04.5" }] }).sort()).toEqual(
      ["525400101011", "b083fe5c19e2"].sort(),
    )
    expect(rows({ columnFilters: [{ id: "os", value: "rocky-9.4" }] })).toEqual(["14187740ab01"])
    expect(rows({ columnFilters: [{ id: "os", value: "debian-12" }] })).toEqual(["b083fe5c19e2"])
  })
  it('"none" = host tanpa OS', () => {
    expect(rows({ columnFilters: [{ id: "os", value: "none" }] }).sort()).toEqual(
      ["0cc47a915e10", "9440c96e01ab"].sort(),
    )
  })
  it("kombinasi filter + pencarian", () => {
    expect(
      rows({ globalFilter: "10.10.10", columnFilters: [{ id: "status", value: ["booting", "done"] }] }).sort(),
    ).toEqual(["0cc47a915e10", "525400101011"].sort())
  })
})

describe("AC-2.7 sorting", () => {
  it("sort status mengikuti urutan PROVISION_STATUSES", () => {
    const ids = rows({ sorting: [{ id: "status", desc: false }] })
    expect(ids.map((id) => HOSTS.find((h) => h.id === id)!.status)).toEqual([
      "booting",
      "installing",
      "done",
      "failed",
      "offline",
    ])
  })
  it("sort IP numerik (lease, fallback mgmt); tanpa IP paling awal", () => {
    const ids = rows({ sorting: [{ id: "ip", desc: false }] })
    expect(ids).toEqual(["9440c96e01ab", "b083fe5c19e2", "525400101011", "14187740ab01", "0cc47a915e10"])
    const desc = rows({ sorting: [{ id: "ip", desc: true }] })
    expect(desc[0]).toBe("0cc47a915e10")
  })
})
