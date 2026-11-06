// F-T8-1 (M7): axe `scrollable-region-focusable` pada pratinjau bulk di 375 px. Container scroll
// tabel pratinjau (tanpa elemen fokusable di dalamnya) wajib bisa difokus keyboard dan berlabel.
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PasswordsDialog } from "@/components/host-config/passwords-dialog"
import { PlanTable } from "@/components/host-config/plan-table"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import type { Host } from "@/lib/types"

function host(id: string, mac: string): Host {
  return {
    id,
    mac,
    hostname: null,
    currentIp: null,
    mgmtIp: null,
    vendor: null,
    firmware: "uefi",
    osInstalled: null,
    osAssigned: null,
    status: "discovered",
    statusSince: "2026-11-06T10:00:00.000Z",
    lastSeen: "2026-11-06T10:00:00.000Z",
  }
}

const HOSTS = [host("h1", "52:54:00:99:00:01"), host("h2", "52:54:00:99:00:02")]

describe("PlanTable: region scroll bisa difokus (F-T8-1)", () => {
  it("container scroll = region berlabel, tabIndex 0, membungkus tabel, dengan focus ring", () => {
    render(
      <PlanTable
        hosts={HOSTS}
        rows={[
          { hostId: "h1", value: "10.99.20.41", error: null },
          { hostId: "h2", value: "10.99.20.42", error: null },
        ]}
        valueLabel="IP baru"
        currentOf={(h) => h.currentIp}
      />,
    )
    // CR-7-4: region punya label sendiri agar pembaca layar tidak mengumumkan nama tabel dua kali.
    const region = screen.getByRole("region", { name: "Area gulir preview IP baru" })
    expect(region).toHaveAttribute("tabindex", "0")
    expect(region).toHaveAttribute("data-slot", "table-container")
    // Kotak scroll (tinggi maks + overflow) adalah elemen yang sama dengan region fokusable,
    // bukan wrapper terpisah yang tak bisa difokus.
    expect(region.className).toMatch(/\bmax-h-72\b/)
    expect(region.className).toMatch(/\boverflow-auto\b/)
    expect(region.className).toMatch(/focus-visible:ring-\[3px\]/)
    expect(region.parentElement?.className ?? "").not.toMatch(/overflow/)
    const table = within(region).getByRole("table", { name: "Preview IP baru" })
    expect(within(table).getByText("10.99.20.41")).toHaveClass("type-data")
    expect(region.getAttribute("aria-label")).not.toBe(table.getAttribute("aria-label"))
    expect(screen.queryByRole("region", { name: "Preview IP baru" })).toBeNull()
    region.focus()
    expect(region).toHaveFocus()
  })
})

describe("PasswordsDialog: label region scroll beda dari label tabel (CR-7-4)", () => {
  it("region 'Area gulir password yang dibuat' membungkus tabel 'Password yang dibuat'", () => {
    render(
      <PasswordsDialog
        passwords={[
          { mac: "52:54:00:99:00:01", hostname: "node-01", username: "admin", password: "dummy-pw-1" },
        ]}
        onClose={() => {}}
      />,
    )
    const region = screen.getByRole("region", { name: "Area gulir password yang dibuat" })
    expect(region).toHaveAttribute("tabindex", "0")
    const table = within(region).getByRole("table", { name: "Password yang dibuat" })
    expect(within(table).getByText("52:54:00:99:00:01")).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Password yang dibuat" })).toBeNull()
  })
})

describe("Table: scrollRegionLabel opt-in", () => {
  it("tanpa scrollRegionLabel → tidak ada region/tab stop baru (tabel lain tak berubah)", () => {
    render(
      <Table aria-label="Biasa">
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect(screen.queryByRole("region")).toBeNull()
    const container = screen.getByRole("table", { name: "Biasa" }).parentElement!
    expect(container).not.toHaveAttribute("tabindex")
    expect(container.className).toBe("relative w-full overflow-x-auto")
  })
})
