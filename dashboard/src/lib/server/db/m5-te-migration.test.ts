// M5-T12 (test-engineer): AC-5.15 migrasi v1 → v2 pada DB berisi data M4 (job lama utuh, backfill
// installer_boots, idempoten) + FK cascade job_events.
import { describe, expect, it } from "vitest"

import { DatabaseSync } from "node:sqlite"

import { MIGRATIONS, runMigrations } from "./migrations"

const at = (s: number) => new Date(Date.parse("2026-11-05T10:00:00.000Z") + s * 1000).toISOString()

function v1db() {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  expect(runMigrations(db, MIGRATIONS.filter((m) => m.version === 1))).toEqual([1])
  const host = db.prepare(`INSERT INTO hosts (id, mac, status, status_since, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)`)
  host.run("525400990011", "52:54:00:99:00:11", "done", at(0), at(0), at(0))
  host.run("525400990012", "52:54:00:99:00:12", "installing", at(0), at(0), at(0))
  const job = db.prepare(
    `INSERT INTO jobs (id, host_id, os_image_id, status, stages, token_hash, token_expires_at, created_at, updated_at, finished_at) VALUES (?, ?, 'ubuntu-24.04', ?, ?, ?, ?, ?, ?, ?)`,
  )
  const st = (n: number, final?: string) => [
    { stage: "booting", at: at(0), source: "install" },
    ...Array.from({ length: n }, (_, i) => ({ stage: "booting", at: at(i + 1), source: "boot-script" })),
    { stage: "installing", at: at(10), source: "config-fetch" },
    ...(final ? [{ stage: final, at: at(20), source: "callback" }] : []),
  ]
  job.run("job-done", "525400990011", "done", JSON.stringify(st(4, "done")), null, null, at(0), at(20), at(20))
  job.run("job-active", "525400990012", "installing", JSON.stringify(st(1)), "h".repeat(64), at(3600), at(0), at(10), null)
  job.run("job-none", "525400990011", "failed", JSON.stringify([{ stage: "booting", at: at(0), source: "install" }, { stage: "failed", at: at(5), source: "callback" }]), null, null, at(0), at(5), at(5))
  return db
}

describe("AC-5.15 migrasi 2 pada DB v1 berisi job M4", () => {
  it("kolom v1 utuh; installer_boots = jumlah stage boot-script; event_seq 0; failure_reason null; job_events kosong; migrasi ulang no-op", () => {
    const db = v1db()
    const before = db.prepare("SELECT * FROM jobs ORDER BY id").all() as Record<string, unknown>[]
    // M6: dibatasi ≤ v2 — test ini khusus transisi v1 → v2 (migrasi 3 diuji di m6 test).
    const V2 = MIGRATIONS.filter((m) => m.version <= 2)
    expect(runMigrations(db, V2)).toEqual([2])
    const after = db.prepare("SELECT * FROM jobs ORDER BY id").all() as Record<string, unknown>[]
    expect(after).toHaveLength(3)
    for (const [i, b] of before.entries()) {
      for (const [k, v] of Object.entries(b)) expect(after[i][k], `${b.id}.${k}`).toEqual(v)
    }
    const extra = Object.fromEntries(after.map((r) => [r.id, [r.installer_boots, r.event_seq, r.failure_reason]]))
    expect(extra).toEqual({ "job-active": [1, 0, null], "job-done": [4, 0, null], "job-none": [0, 0, null] })
    expect(db.prepare("SELECT count(*) AS n FROM job_events").get()).toEqual({ n: 0 })
    expect((db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[]).map((r) => r.version)).toEqual([1, 2])
    expect(runMigrations(db, V2)).toEqual([])
    expect(db.prepare("SELECT * FROM jobs ORDER BY id").all()).toEqual(after)
    db.close()
  })
  it("job_events: CHECK kind/level, PK (job_id, seq), cascade saat job/host dihapus", () => {
    const db = v1db()
    runMigrations(db)
    const ins = db.prepare("INSERT INTO job_events (job_id, seq, at, kind, level, source, message) VALUES (?, ?, ?, ?, ?, ?, ?)")
    ins.run("job-done", 1, at(0), "stage", "info", "install", "a")
    ins.run("job-none", 1, at(0), "installer", "error", "installer", "b")
    expect(() => ins.run("job-done", 1, at(0), "stage", "info", "install", "dup")).toThrow()
    expect(() => ins.run("job-done", 2, at(0), "lain", "info", "install", "x")).toThrow()
    expect(() => ins.run("job-done", 3, at(0), "stage", "debug", "install", "x")).toThrow()
    expect(() => ins.run("job-tidak-ada", 1, at(0), "stage", "info", "install", "x")).toThrow()
    expect(db.prepare("SELECT repeat FROM job_events WHERE job_id = 'job-done'").get()).toEqual({ repeat: 1 })
    db.prepare("DELETE FROM hosts WHERE id = '525400990011'").run()
    expect(db.prepare("SELECT count(*) AS n FROM jobs WHERE host_id = '525400990011'").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT count(*) AS n FROM job_events").get()).toEqual({ n: 0 })
    db.close()
  })
})
