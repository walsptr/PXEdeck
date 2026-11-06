// M6-T10 (test-engineer): nilai batas yang DITETAPKAN decision dikunci secara literal (bukan relatif ke
// konstanta kode), sehingga mengubah nilai tanpa decision membuat test merah (temuan mutasi MU6:
// test SSE lama memakai `SSE_MAX_PER_SESSION` sendiri).
//   DEC-017 §1 idle 120 mnt / absolut 12 jam; §5 login 5 gagal / 15 mnt (per IP 20), API 600/mnt,
//   SSE 5 per sesi; SR-5-3 20 baris / 60 dtk; AC-5.17 batas global SSE 50.
import { describe, expect, it, vi } from "vitest"

import { getDb } from "@/lib/server/db"
import { getSettings } from "@/lib/server/settings"
import { createSession } from "@/lib/server/auth/session"
import { withDb } from "@/test/db"

import { BOOT_LOG_MAX_PER_WINDOW, BOOT_LOG_WINDOW_MS } from "./boot-http"
import { openJobLogStream, sseConnections, SSE_MAX_CONNECTIONS, SSE_MAX_PER_SESSION } from "./sse"

withDb("demo")

describe("nilai DEC terkunci literal", () => {
  it("konstanta: SSE 5 per sesi, 50 global; log penolakan /boot 20 per 60 dtk", () => {
    expect(SSE_MAX_PER_SESSION).toBe(5)
    expect(SSE_MAX_CONNECTIONS).toBe(50)
    expect(BOOT_LOG_MAX_PER_WINDOW).toBe(20)
    expect(BOOT_LOG_WINDOW_MS).toBe(60_000)
  })

  it("default env auth: idle 120, absolut 12 jam, login 5 / 15 mnt, API 600/mnt", () => {
    expect(getSettings().auth).toEqual({
      sessionIdleMin: 120,
      sessionMaxHours: 12,
      loginMaxFailures: 5,
      loginWindowMin: 15,
      apiRatePerMin: 600,
    })
  })

  it("SSE: tepat 5 stream untuk satu sesi, stream ke-6 ditolak `session`; sesi lain tetap dapat", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] })
    try {
      const job = getDb().prepare("SELECT id FROM hosts LIMIT 1").get() as { id: string }
      const now = new Date().toISOString()
      getDb()
        .prepare("INSERT INTO jobs (id, host_id, os_image_id, status, created_at, updated_at) VALUES ('job-lim', ?, 'ubuntu-24.04', 'installing', ?, ?)")
        .run(job.id, now, now)
      const admin = getSettings().admin!
      const a = createSession(admin, null)
      const b = createSession(admin, null)
      const acs: AbortController[] = []
      const open = (key: string) => {
        const ac = new AbortController()
        acs.push(ac)
        return openJobLogStream("job-lim", 0, ac.signal, { key, isValid: () => true })
      }
      const results = Array.from({ length: 6 }, () => open(a.session.idHash))
      expect(results.map((r) => (r.ok ? "ok" : r.reason))).toEqual(["ok", "ok", "ok", "ok", "ok", "session"])
      expect(open(b.session.idHash).ok).toBe(true)
      for (const ac of acs) ac.abort()
      expect(sseConnections()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
