// AC-1.6: StatusPill merender label + data-status untuk ketujuh status.
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PROVISION_STATUSES, STATUS_LABEL, StatusPill } from "./status-pill"

describe("AC-1.6 StatusPill", () => {
  it("tujuh status tersedia", () => {
    expect(PROVISION_STATUSES).toEqual([
      "discovered",
      "booting",
      "installing",
      "configuring",
      "done",
      "failed",
      "offline",
    ])
  })

  it.each(PROVISION_STATUSES)("status %s → label + data-status", (status) => {
    render(<StatusPill status={status} />)
    const pill = screen.getByText(STATUS_LABEL[status])
    expect(pill).toHaveAttribute("data-status", status)
    expect(pill).toHaveAttribute("data-slot", "badge")
    // Bentuk pill: radius 9999 (rounded-4xl).
    expect(pill.className).toContain("rounded-4xl")
  })

  it("done & failed memakai teks putih", () => {
    render(
      <>
        <StatusPill status="done" />
        <StatusPill status="failed" />
      </>,
    )
    expect(screen.getByText("Done").className).toMatch(/\bbg-stage-done\b/)
    expect(screen.getByText("Done").className).toMatch(/\btext-white\b/)
    expect(screen.getByText("Failed").className).toMatch(/\bbg-destructive\b/)
    expect(screen.getByText("Failed").className).toMatch(/\btext-white\b/)
  })

  it("offline memakai kelas netral (tanpa pastel stage)", () => {
    render(<StatusPill status="offline" />)
    const cls = screen.getByText("Offline").className
    expect(cls).toMatch(/\bbg-secondary\b/)
    expect(cls).toMatch(/\btext-muted-foreground\b/)
    expect(cls).not.toMatch(/stage-/)
  })

  it.each(["discovered", "booting", "installing", "configuring"] as const)(
    "%s memakai pastel bg-stage-* dengan teks ink",
    (status) => {
      render(<StatusPill status={status} />)
      const cls = screen.getByText(STATUS_LABEL[status]).className
      expect(cls).toContain(`bg-stage-${status}`)
      expect(cls).toMatch(/\btext-foreground\b/)
    },
  )

  it("className tambahan digabung", () => {
    render(<StatusPill status="done" className="ml-auto" />)
    expect(screen.getByText("Done").className).toContain("ml-auto")
  })
})
