// M5-T8: logika tampilan job (alasan gagal, timeline, durasi, gabung log).
import { describe, expect, it } from "vitest"

import {
  failureReasonText,
  formatClock,
  formatDuration,
  isFinalJob,
  jobDurationMs,
  jobsHref,
  jobTimeline,
  mergeLogEvents,
  parseLogEvent,
} from "./jobs"
import type { JobLogEvent, JobSummary } from "./types"

const T = (min: number, sec = 0) =>
  new Date(Date.UTC(2026, 10, 5, 10, min, sec)).toISOString()

function job(p: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job-1",
    hostId: "525400990011",
    host: { mac: "52:54:00:99:00:11", hostname: "m5-node11" },
    type: "install",
    osImageId: "ubuntu-24.04",
    status: "booting",
    stages: [{ stage: "booting", at: T(0), source: "install" }],
    failureReason: null,
    installerBoots: 0,
    createdAt: T(0),
    updatedAt: T(0),
    finishedAt: null,
    eventCount: 1,
    ...p,
  }
}

const ev = (seq: number, p: Partial<JobLogEvent> = {}): JobLogEvent => ({
  seq,
  at: T(0, seq),
  kind: "system",
  level: "info",
  source: "boot-script",
  message: `m${seq}`,
  repeat: 1,
  ...p,
})

describe("failureReasonText", () => {
  const timeouts = { bootingMin: 60, installingMin: 15, configuringMin: 45 }
  it("timeout per tahap dengan N dari settings", () => {
    expect(failureReasonText("timeout-booting", { timeouts })).toBe("Timeout di tahap Booting (> 60 mnt)")
    expect(failureReasonText("timeout-installing", { timeouts })).toBe("Timeout di tahap Installing (> 15 mnt)")
    expect(failureReasonText("timeout-configuring", { timeouts })).toBe("Timeout di tahap Configuring (> 45 mnt)")
  })
  it("tanpa settings: tanpa bagian (> N mnt)", () => {
    expect(failureReasonText("timeout-installing")).toBe("Timeout di tahap Installing")
  })
  it("alasan lain + tidak dikenal + kosong", () => {
    expect(failureReasonText("installer-boot-limit", { maxInstallerBoots: 3 })).toContain("3×")
    expect(failureReasonText("installer-boot-limit")).toContain("Batas penyajian installer")
    expect(failureReasonText("installer-error")).toBe("Installer melaporkan gagal")
    expect(failureReasonText("superseded")).toBe("Digantikan job install yang lebih baru")
    expect(failureReasonText("lainnya")).toBe("lainnya")
    expect(failureReasonText(null)).toBeNull()
    expect(failureReasonText(undefined)).toBeNull()
  })
})

describe("jobTimeline", () => {
  it("job done: 4 tahap tercapai berurutan, durasi antar tahap", () => {
    const j = job({
      status: "done",
      stages: [
        { stage: "booting", at: T(0), source: "install" },
        { stage: "booting", at: T(1), source: "boot-script" },
        { stage: "installing", at: T(2), source: "config-fetch" },
        { stage: "configuring", at: T(10), source: "callback" },
        { stage: "done", at: T(12), source: "callback" },
      ],
      finishedAt: T(12),
    })
    const s = jobTimeline(j, Date.parse(T(30)))
    expect(s.map((x) => [x.stage, x.reached, x.current])).toEqual([
      ["booting", true, false],
      ["installing", true, false],
      ["configuring", true, false],
      ["done", true, false],
    ])
    expect(s.map((x) => x.at)).toEqual([T(0), T(2), T(10), T(12)])
    expect(s.map((x) => x.durationMs)).toEqual([120_000, 480_000, 120_000, null])
  })
  it("job aktif: tahap berjalan memakai now; tahap berikutnya belum tercapai", () => {
    const j = job({
      status: "installing",
      stages: [
        { stage: "booting", at: T(0), source: "install" },
        { stage: "installing", at: T(2), source: "config-fetch" },
      ],
    })
    const s = jobTimeline(j, Date.parse(T(5)))
    expect(s[1]).toMatchObject({ stage: "installing", current: true, durationMs: 180_000 })
    expect(s[2]).toMatchObject({ stage: "configuring", reached: false, at: null, durationMs: null })
    expect(s[3]).toMatchObject({ stage: "done", reached: false })
    // now = 0 (SSR): durasi tahap berjalan tidak dihitung.
    expect(jobTimeline(j, 0)[1].durationMs).toBeNull()
  })
  it("job failed di Installing: slot terakhir Failed (finishedAt), Configuring belum tercapai", () => {
    const j = job({
      status: "failed",
      failureReason: "timeout-installing",
      stages: [
        { stage: "booting", at: T(0), source: "install" },
        { stage: "installing", at: T(2), source: "config-fetch" },
        { stage: "failed", at: T(20), source: "watchdog" },
      ],
      finishedAt: T(20),
    })
    const s = jobTimeline(j, Date.parse(T(30)))
    expect(s.map((x) => x.stage)).toEqual(["booting", "installing", "configuring", "failed"])
    expect(s[1].durationMs).toBe(18 * 60_000)
    expect(s[2].reached).toBe(false)
    expect(s[3]).toMatchObject({ reached: true, at: T(20) })
  })
  it("failed tanpa entri stage failed → finishedAt/updatedAt; booting tanpa entri → createdAt", () => {
    const j = job({ status: "failed", stages: [], finishedAt: null, updatedAt: T(9) })
    const s = jobTimeline(j, Date.parse(T(10)))
    expect(s[0].at).toBe(T(0))
    expect(s[0].durationMs).toBe(9 * 60_000)
    expect(s[3].at).toBe(T(9))
  })
})

describe("durasi & format", () => {
  it("jobDurationMs: finishedAt atau now", () => {
    expect(jobDurationMs(job({ finishedAt: T(3) }), Date.parse(T(50)))).toBe(180_000)
    expect(jobDurationMs(job(), Date.parse(T(1)))).toBe(60_000)
    expect(jobDurationMs(job(), Date.parse(T(0)) - 5000)).toBe(0)
  })
  it("formatDuration", () => {
    expect(formatDuration(45_400)).toBe("45 dtk")
    expect(formatDuration(180_000)).toBe("3 mnt")
    expect(formatDuration(192_000)).toBe("3 mnt 12 dtk")
    expect(formatDuration(3_600_000)).toBe("1 j")
    expect(formatDuration(3_900_000)).toBe("1 j 5 mnt")
  })
  it("formatClock HH:MM:SS", () => {
    expect(formatClock(T(3, 7))).toMatch(/^\d{2}:\d{2}:07$/)
  })
  it("isFinalJob", () => {
    expect(isFinalJob("done")).toBe(true)
    expect(isFinalJob("failed")).toBe(true)
    expect(isFinalJob("installing")).toBe(false)
  })
  it("jobsHref", () => {
    expect(jobsHref({})).toBe("/jobs")
    expect(jobsHref({ host: "525400990011", status: "failed", job: "job-1" })).toBe(
      "/jobs?host=525400990011&status=failed&job=job-1",
    )
    expect(jobsHref({ host: null, job: "j" })).toBe("/jobs?job=j")
  })
})

describe("mergeLogEvents", () => {
  it("append cepat bila seq naik", () => {
    const a = [ev(1), ev(2)]
    expect(mergeLogEvents(a, [ev(3), ev(4)]).map((e) => e.seq)).toEqual([1, 2, 3, 4])
    expect(mergeLogEvents(a, [])).toBe(a)
  })
  it("seq sama → baris diganti (repeat baru), tidak ganda; urut seq", () => {
    const a = [ev(1), ev(2), ev(3)]
    const r = mergeLogEvents(a, [ev(2, { repeat: 4 }), ev(1)])
    expect(r.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(r[1].repeat).toBe(4)
    // Kirim ulang backlog setelah reconnect + event baru.
    expect(mergeLogEvents(a, [ev(3), ev(4)]).map((e) => e.seq)).toEqual([1, 2, 3, 4])
  })
})

describe("parseLogEvent", () => {
  it("data valid + normalisasi", () => {
    expect(parseLogEvent(JSON.stringify(ev(5, { level: "error" })))).toEqual(ev(5, { level: "error" }))
    expect(
      parseLogEvent(JSON.stringify({ seq: 1, at: T(0), message: "x", level: "weird", repeat: 0 })),
    ).toEqual({ seq: 1, at: T(0), kind: "system", level: "info", source: "", message: "x", repeat: 1 })
  })
  it("data rusak → null", () => {
    expect(parseLogEvent("{")).toBeNull()
    expect(parseLogEvent(JSON.stringify({ seq: "1", at: T(0), message: "x" }))).toBeNull()
  })
})
