// M5-T8/T10 komponen (jsdom): timeline job, log viewer (fallback JSON tanpa EventSource), dan sel
// status host dengan alasan gagal dari `lastJob`.
import { render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { JobTimeline } from "@/components/jobs/job-timeline"
import { LogViewer } from "@/components/jobs/log-viewer"
import { SETTINGS_KEY } from "@/hooks/use-settings"
import type { JobLogEvent, JobSummary } from "@/lib/types"

function wrap(children: ReactNode, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  )
}

const T = (min: number) => new Date(Date.UTC(2026, 10, 5, 10, min)).toISOString()

function job(p: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job-1",
    hostId: "525400990011",
    host: { mac: "52:54:00:99:00:11", hostname: "m5-node11" },
    type: "install",
    osImageId: "ubuntu-24.04",
    status: "done",
    stages: [
      { stage: "booting", at: T(0), source: "install" },
      { stage: "installing", at: T(2), source: "config-fetch" },
      { stage: "configuring", at: T(10), source: "callback" },
      { stage: "done", at: T(12), source: "callback" },
    ],
    failureReason: null,
    installerBoots: 1,
    createdAt: T(0),
    updatedAt: T(12),
    finishedAt: T(12),
    eventCount: 4,
    ...p,
  }
}

describe("JobTimeline", () => {
  it("job done: 4 pill berurutan ber-data-status, waktu mono", () => {
    render(wrap(<JobTimeline job={job()} />))
    const steps = screen.getAllByTestId("timeline-step")
    expect(steps.map((s) => s.dataset.stage)).toEqual(["booting", "installing", "configuring", "done"])
    expect(steps.every((s) => s.dataset.reached === "true")).toBe(true)
    expect(steps.map((s) => s.querySelector("[data-status]")?.getAttribute("data-status"))).toEqual([
      "booting",
      "installing",
      "configuring",
      "done",
    ])
    expect(screen.getAllByTestId("timeline-time")[0]).toHaveClass("type-data")
  })
  it("job failed di Installing: Configuring netral (tanpa data-status), slot terakhir Failed", () => {
    render(
      wrap(
        <JobTimeline
          job={job({
            status: "failed",
            failureReason: "timeout-installing",
            stages: [
              { stage: "booting", at: T(0), source: "install" },
              { stage: "installing", at: T(2), source: "config-fetch" },
              { stage: "failed", at: T(20), source: "watchdog" },
            ],
            finishedAt: T(20),
          })}
        />,
      ),
    )
    const steps = screen.getAllByTestId("timeline-step")
    expect(steps[2].dataset.reached).toBe("false")
    expect(steps[2].querySelector("[data-status]")).toBeNull()
    expect(within(steps[2]).getByText("Configuring")).toBeInTheDocument()
    expect(steps[3].querySelector("[data-status]")?.getAttribute("data-status")).toBe("failed")
  })
})

describe("LogViewer (fallback JSON tanpa EventSource)", () => {
  const events: JobLogEvent[] = [
    { seq: 1, at: T(0), kind: "stage", level: "info", source: "install", message: "Job install dibuat", repeat: 1, lastAt: T(0) },
    { seq: 2, at: T(1), kind: "system", level: "warn", source: "boot-script", message: "PXE boot ulang", repeat: 3, lastAt: T(1) },
    { seq: 3, at: T(2), kind: "installer", level: "error", source: "installer", message: "ERROR gagal", repeat: 1, lastAt: T(2) },
  ]
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ events, lastSeq: 3, final: true })),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it("baris mono berurutan, ×n untuk event gabungan, error = semantic-error, indikator Selesai", async () => {
    render(wrap(<LogViewer jobId="job-1" />))
    await waitFor(() => expect(screen.getAllByTestId("log-line")).toHaveLength(3))
    const lines = screen.getAllByTestId("log-line")
    expect(lines.map((l) => l.dataset.seq)).toEqual(["1", "2", "3"])
    expect(within(lines[1]).getByTestId("log-repeat")).toHaveTextContent("×3")
    expect(lines[2]).toHaveClass("text-destructive")
    expect(screen.getByTestId("log-lines")).toHaveClass("font-mono")
    expect(screen.getByTestId("log-connection")).toHaveAttribute("data-state", "ended")
    expect(screen.getByTestId("log-connection")).toHaveTextContent("Selesai")
    expect(fetch).toHaveBeenCalledWith("/api/jobs/job-1/logs?format=json&after=0", { cache: "no-store" })
  })
})

describe("StatusCell host (lastJob)", () => {
  afterEach(() => vi.unstubAllGlobals())
  it("host Failed + job terakhir failed → alasan dengan N dari settings; host lain tanpa alasan", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})))
    const { columns } = await import("@/components/hosts/columns")
    const col = columns.find((c) => (c as { accessorKey?: string }).accessorKey === "status")!
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(SETTINGS_KEY, {
      jobTimeouts: { bootingMin: 60, installingMin: 15, configuringMin: 60 },
      maxInstallerBoots: 3,
    })
    const Cell = col.cell as (ctx: unknown) => ReactNode
    const base = { id: "h", mac: "52:54:00:99:00:11", hostname: null, currentIp: null, mgmtIp: null, vendor: null, firmware: null, osInstalled: null, osAssigned: null, statusSince: T(0), lastSeen: T(0) }
    const lastJob = { id: "job-1", status: "failed", failureReason: "timeout-installing", createdAt: T(0) }
    const { unmount } = render(wrap(Cell({ row: { original: { ...base, status: "failed", lastJob } } }), qc))
    expect(screen.getByTestId("host-failure-reason")).toHaveTextContent("Timeout di tahap Installing (> 15 mnt)")
    expect(screen.getByTestId("host-failure-reason")).toHaveAttribute("data-reason", "timeout-installing")
    unmount()
    render(wrap(Cell({ row: { original: { ...base, status: "booting", lastJob: { ...lastJob, status: "booting", failureReason: null } } } }), qc))
    expect(screen.queryByTestId("host-failure-reason")).toBeNull()
  })
})
