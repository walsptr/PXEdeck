// AC-1.11 (bagian unit): ServerStatus dengan `online: false` merender titik --destructive.
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"

import { ServerStatus } from "./server-status"

describe("AC-1.11 ServerStatus", () => {
  it("default: tiga indikator DHCP/TFTP/HTTP online dengan titik success", () => {
    render(
      <TooltipProvider>
        <ServerStatus />
      </TooltipProvider>,
    )
    const group = screen.getByRole("group", { name: "Status server PXE" })
    for (const name of ["DHCP", "TFTP", "HTTP"]) {
      const badge = group.querySelector(`[data-service="${name}"]`)!
      expect(badge).not.toBeNull()
      expect(badge).toHaveAttribute("data-online", "true")
      expect(within(badge as HTMLElement).getByText("online")).toBeInTheDocument()
      const dot = badge.querySelector('[data-slot="status-dot"]')!
      expect(dot.className).toMatch(/\bbg-success\b/)
    }
  })

  it("online: false → teks offline + titik bg-destructive", () => {
    render(
      <TooltipProvider>
        <ServerStatus
          services={[
            { name: "DHCP", online: false, detail: "mati" },
            { name: "TFTP", online: true, detail: "ok" },
          ]}
        />
      </TooltipProvider>,
    )
    const dhcp = document.querySelector('[data-service="DHCP"]') as HTMLElement
    expect(dhcp).toHaveAttribute("data-online", "false")
    expect(within(dhcp).getByText("offline")).toBeInTheDocument()
    const dot = dhcp.querySelector('[data-slot="status-dot"]')!
    expect(dot.className).toMatch(/\bbg-destructive\b/)
    expect(dot.className).not.toMatch(/\bbg-success\b/)
    expect(dot).toHaveAttribute("aria-hidden")
    const tftp = document.querySelector('[data-service="TFTP"]') as HTMLElement
    expect(within(tftp).getByText("online")).toBeInTheDocument()
  })
})
