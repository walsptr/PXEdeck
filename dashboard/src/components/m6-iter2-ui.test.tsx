// M6 iterasi 2 (gate-iter1 R1/R2/R3/R7, DEC-022 §1/§3): informasi penting tidak `muted`
// (DEC-017 §9), status server tidak hanya warna (WCAG 1.4.1), CIDR mono di pesan jaringan, 404 job
// tanpa judul berulang. Asersi warna komputasi ada di e2e/m6-iter2-ui.spec.ts; di sini kelasnya.
import { render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/jobs",
}))

import { IpText } from "@/components/host-config/ip-text"
import { JobDetail } from "@/components/jobs/job-detail"
import { JobTimeline } from "@/components/jobs/job-timeline"
import { JOB_NOT_FOUND_EXPLANATION, LogViewer } from "@/components/jobs/log-viewer"
import { ServerStatus } from "@/components/server-status"
import { Input } from "@/components/ui/input"
import { TooltipProvider } from "@/components/ui/tooltip"
import { resetApiState } from "@/lib/api-client"
import type { JobSummary } from "@/lib/types"

/** Kelas muted tanpa varian (mis. `[a]:hover:text-muted-foreground` di Badge outline tidak dihitung). */
const MUTED = /(^|\s)text-muted-foreground(\s|$)/

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  )
}
const json = (body: unknown, status = 200) => Response.json(body, { status })

beforeEach(() => resetApiState())
afterEach(() => {
  vi.unstubAllGlobals()
  resetApiState()
})

describe("R7 / DR-6-5 ServerStatus: state tidak hanya warna, nama layanan terlihat", () => {
  const services = [
    { name: "DHCP" as const, state: "online" as const, online: true, detail: "ok" },
    { name: "TFTP" as const, state: "offline" as const, online: false, detail: "mati" },
    { name: "HTTP" as const, state: "unknown" as const, online: false, detail: "?" },
  ]

  it("tiap state punya glyph SVG berbeda di indikator; nama layanan bukan sr-only", () => {
    render(wrap(<ServerStatus services={services} />))
    const svgs: string[] = []
    for (const s of services) {
      const badge = document.querySelector(`[data-service="${s.name}"]`) as HTMLElement
      const dot = badge.querySelector('[data-slot="status-dot"]') as HTMLElement
      expect(dot).toHaveAttribute("data-glyph", s.state)
      const svg = dot.querySelector("svg")
      expect(svg).not.toBeNull()
      svgs.push(svg!.innerHTML)
      const name = within(badge).getByText(s.name)
      expect(name).toHaveAttribute("data-slot", "service-name")
      expect(name.className).not.toMatch(/\bsr-only\b/)
    }
    // Bentuk berbeda per state (bukan hanya warna).
    expect(new Set(svgs).size).toBe(3)
  })
})

describe("R1 / DR-6-1 LogViewer: pesan 404 dan sesi berakhir tidak muted", () => {
  it("404 → pesan 'Job tidak ditemukan — …' text-body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Job tidak ditemukan" }, 404)))
    render(wrap(<LogViewer jobId="job-x" />))
    await waitFor(() => expect(screen.getByTestId("log-empty")).toHaveAttribute("data-state", "not-found"))
    const msg = screen.getByTestId("log-empty")
    expect(msg).toHaveTextContent(`Job tidak ditemukan — ${JOB_NOT_FOUND_EXPLANATION.toLowerCase()}`)
    expect(msg).toHaveClass("text-body")
    expect(msg.className).not.toMatch(MUTED)
  })

  it("401 → 'Sesi berakhir…' text-body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Sesi berakhir" }, 401)))
    render(wrap(<LogViewer jobId="job-s" />))
    await waitFor(() => expect(screen.getByTestId("log-empty")).toHaveAttribute("data-state", "session"))
    const msg = screen.getByTestId("log-empty")
    expect(msg).toHaveTextContent("Sesi berakhir. Masuk lagi untuk melihat log.")
    expect(msg).toHaveClass("text-body")
    expect(msg.className).not.toMatch(MUTED)
  })
})

describe("R2 / DR-6-2 JobTimeline: label tahap belum tercapai text-body", () => {
  it("Installing/Configuring/Done belum tercapai → bukan muted", () => {
    const at = "2026-11-06T10:00:00.000Z"
    const job: JobSummary = {
      id: "job-1",
      hostId: "h1",
      host: { mac: "52:54:00:99:00:01", hostname: null },
      type: "install",
      osImageId: "ubuntu-24.04",
      status: "booting",
      stages: [{ stage: "booting", at, source: "boot-script" }],
      failureReason: null,
      installerBoots: 0,
      createdAt: at,
      updatedAt: at,
      finishedAt: null,
      eventCount: 0,
    }
    render(<JobTimeline job={job} />)
    const pending = screen
      .getAllByTestId("timeline-step")
      .filter((li) => li.getAttribute("data-reached") === "false")
    expect(pending.length).toBe(3)
    for (const li of pending) {
      const label = li.querySelector('[data-slot="badge"]') as HTMLElement
      expect(label).toHaveClass("text-body")
      expect(label.className).not.toMatch(MUTED)
    }
  })
})

describe("DR-6-8 JobDetail 404: deskripsi tidak mengulang judul", () => {
  it("judul 'Job tidak ditemukan', deskripsi = penjelasan log viewer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Job tidak ditemukan" }, 404)))
    render(wrap(<JobDetail jobId="job-hilang" />))
    const err = await screen.findByTestId("job-detail-error")
    expect(within(err).getByText("Job tidak ditemukan")).toHaveAttribute("data-slot", "alert-title")
    const desc = screen.getByTestId("job-detail-error-description")
    expect(desc).toHaveTextContent(JOB_NOT_FOUND_EXPLANATION)
    expect(desc.textContent).not.toMatch(/Job tidak ditemukan/)
  })
})

describe("DR-6-7 IpText: IP/CIDR mono, teks pesan tidak berubah", () => {
  it.each([
    ["Di luar subnet 10.99.0.0/24", ["10.99.0.0/24"]],
    ["Di dalam range DHCP dinamis 10.99.0.100–10.99.0.200", ["10.99.0.100", "10.99.0.200"]],
    ["Format IPv4 tidak valid", []],
  ])("%s", (text, tokens) => {
    const { container } = render(
      <p>
        <IpText text={text} />
      </p>,
    )
    expect(container.textContent).toBe(text)
    const spans = [...container.querySelectorAll('[data-slot="ip-token"]')]
    expect(spans.map((s) => s.textContent)).toEqual(tokens)
    for (const s of spans) expect(s).toHaveClass("type-data")
  })
})

describe("DR-6-4 Input: ring fokus kuat", () => {
  it("focus-visible: border ring + ring/40 (bukan ring/15)", () => {
    render(<Input aria-label="x" />)
    const cls = screen.getByLabelText("x").className
    expect(cls).toMatch(/focus-visible:border-ring\b/)
    expect(cls).toMatch(/focus-visible:ring-ring\/40\b/)
    expect(cls).not.toMatch(/ring-ring\/15/)
  })
})
