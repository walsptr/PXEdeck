// M6-T9 CR-5-4 (klien): `mergeJobsHead` — polling hanya halaman pertama, digabung ke halaman yang
// sudah dimuat tanpa duplikat/item hilang.
import { describe, expect, it } from "vitest"

import { mergeJobsHead, type JobPages } from "./jobs"
import type { JobSummary, JobsResponse } from "./types"

const T = (n: number) => new Date(Date.UTC(2026, 10, 6, 10, 0, n)).toISOString()

function job(n: number, p: Partial<JobSummary> = {}): JobSummary {
  return {
    id: `job-${String(n).padStart(3, "0")}`,
    hostId: "525400990011",
    host: null,
    type: "install",
    osImageId: "ubuntu-24.04",
    status: "done",
    stages: [],
    failureReason: null,
    installerBoots: 1,
    createdAt: T(n),
    updatedAt: T(n),
    finishedAt: T(n),
    eventCount: 0,
    ...p,
  }
}

/** Halaman job terbaru dulu: n dari `from` turun sebanyak `count`. */
const page = (from: number, count: number, nextBefore: string | null): JobsResponse => ({
  jobs: Array.from({ length: count }, (_, i) => job(from - i)),
  nextBefore,
  serverTime: T(99),
})

const ids = (d: JobPages) => d.pages.flatMap((p) => p.jobs.map((j) => j.id))

describe("mergeJobsHead (CR-5-4)", () => {
  it("tanpa cache → satu halaman", () => {
    const h = page(10, 3, "c-8")
    expect(mergeJobsHead(undefined, h)).toEqual({ pages: [h], pageParams: [null] })
  })

  it("job baru masuk: item yang terdorong keluar halaman 1 tidak hilang (tidak ada gap) dan tanpa duplikat", () => {
    // Dimuat: halaman 1 = 10..6 (cursor c-6), halaman 2 = 5..1.
    const old: JobPages = { pages: [page(10, 5, "c-6"), page(5, 5, null)], pageParams: [null, "c-6"] }
    // Dua job baru (11, 12) → head = 12..8; job 7 dan 6 terdorong keluar head.
    const out = mergeJobsHead(old, page(12, 5, "c-8"))
    expect(ids(out)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => job(n).id))
    expect(out.pageParams).toEqual([null, "c-6"])
    // Halaman 1 tetap menunjuk cursor lama (halaman 2 dimulai setelah job 6).
    expect(out.pages[0].nextBefore).toBe("c-6")
    expect(out.pages[1].nextBefore).toBeNull()
  })

  it("status job di head menggantikan versi lama; job lama di jendela head yang hilang dibuang", () => {
    const old: JobPages = {
      pages: [{ jobs: [job(5, { status: "installing" }), job(4), job(3)], nextBefore: "c-3", serverTime: T(0) }],
      pageParams: [null],
    }
    // Job 4 terhapus (retensi/keluar filter); job 5 kini done. Head = 5, 3 (cursor c-3, masih ada job lebih lama).
    const out = mergeJobsHead(old, { jobs: [job(5), job(3)], nextBefore: "c-3", serverTime: T(9) })
    expect(ids(out)).toEqual([job(5).id, job(3).id])
    expect(out.pages[0].jobs[0].status).toBe("done")
    expect(out.pages[0].serverTime).toBe(T(9))
    expect(out.pages[0].nextBefore).toBe("c-3")
  })

  it("head memuat semua job (nextBefore null) → halaman lain dibuang", () => {
    const old: JobPages = { pages: [page(10, 5, "c-6"), page(5, 5, null)], pageParams: [null, "c-6"] }
    const h = page(3, 3, null)
    expect(mergeJobsHead(old, h)).toEqual({ pages: [h], pageParams: [null] })
  })

  it("hanya satu halaman dimuat dan tidak ada yang terdorong → nextBefore milik head", () => {
    const old: JobPages = { pages: [page(10, 5, "c-6")], pageParams: [null] }
    const out = mergeJobsHead(old, page(10, 5, "c-6b"))
    expect(out.pages).toHaveLength(1)
    expect(out.pages[0].nextBefore).toBe("c-6b")
  })

  it("createdAt sama: urutan id DESC dipakai sebagai pemutus (sama seperti server)", () => {
    const a = job(1, { id: "job-b", createdAt: T(5) })
    const b = job(1, { id: "job-a", createdAt: T(5) })
    const old: JobPages = { pages: [{ jobs: [a, b], nextBefore: "c", serverTime: T(0) }], pageParams: [null] }
    // Head hanya memuat job-b (job-a lebih "lama" → dipertahankan).
    const out = mergeJobsHead(old, { jobs: [a], nextBefore: "c-b", serverTime: T(1) })
    expect(ids(out)).toEqual(["job-b", "job-a"])
  })
})
