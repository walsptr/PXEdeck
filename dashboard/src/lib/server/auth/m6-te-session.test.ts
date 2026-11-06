// M6-T10 (test-engineer): AC-6.6 / DEC-019 §1 pada batas bawah env — "aktivitas sebelum idle memperpanjang"
// harus berlaku untuk SETIAP nilai PXE_SESSION_IDLE_MIN yang diterima validasi (1–1440), termasuk 1.
// Bukti BUG-M6-L1 (.agent/runs/m6/bugs-local.md).
import { describe, expect, it } from "vitest"

import { getSettings } from "@/lib/server/settings"
import { withDb } from "@/test/db"

import { createSession, sessionFromId } from "./session"

const T0 = new Date("2026-11-06T08:00:00.000Z")
const at = (ms: number) => new Date(T0.getTime() + ms)

describe.each(["1", "2", "120"])("PXE_SESSION_IDLE_MIN=%s", (idle) => {
  withDb("empty", { PXE_SESSION_IDLE_MIN: idle })

  // Polling nyata ber-jitter: langkah 5,003 dtk (tidak pernah tepat di kelipatan 60 dtk).
  it("request tiap ±5 dtk (polling) selama 3× idle (min. 3 mnt) → sesi tetap valid", () => {
    const { id } = createSession(getSettings().admin!, null, T0)
    const span = Math.max(3, 3 * Number(idle)) * 60_000
    for (let t = 5_003; t <= Math.min(span, 15 * 60_000); t += 5_003) expect(sessionFromId(id, at(t)), `t=${t / 1000} dtk`).not.toBeNull()
  })

  it("tanpa request lebih dari idle → habis", () => {
    const { id } = createSession(getSettings().admin!, null, T0)
    expect(sessionFromId(id, at(Number(idle) * 60_000 + 1_000))).toBeNull()
  })
})
