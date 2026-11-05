// M5-T2 (backend-dev, dasar): migrasi 2 + backfill, repo job_events (seq, gabung, cap, redaksi),
// listJobs cursor, pruneHostHistory, latestJobsByHost; redactSecrets dasar. Test menyeluruh
// AC-5.12–5.16 = M5-T11/T12 (test-engineer).
import { describe, expect, it } from "vitest"

import { DatabaseSync } from "node:sqlite"

import { redactSecrets } from "@/lib/server/redact"
import { withDb } from "@/test/db"

import { getDb } from "./index"
import { MIGRATIONS, runMigrations } from "./migrations"
import { deleteHost, insertHost } from "./repos/hosts"
import {
  appendEvent,
  eventsAfter,
  LOG_TRUNCATED_MESSAGE,
  sanitizeMessage,
  TRUNCATED_SUFFIX,
} from "./repos/job-events"
import {
  getJob,
  insertJob,
  latestJobsByHost,
  listJobs,
  pruneHostHistory,
  supersedeActiveJobs,
  type Job,
} from "./repos/jobs"

withDb("empty")

const T = Date.parse("2026-11-05T10:00:00.000Z")
const at = (s: number) => new Date(T + s * 1000).toISOString()
const H = "525400990011"
const TOKEN = "A".repeat(43)

function host(id = H) {
  insertHost({
    id,
    mac: id.match(/../g)!.join(":"),
    hostname: null,
    currentIp: null,
    mgmtIp: null,
    vendor: null,
    firmware: null,
    osInstalled: null,
    osAssigned: null,
    status: "discovered",
    statusSince: at(0),
    lastSeen: at(0),
  })
}

function job(id: string, over: Partial<Job> = {}) {
  insertJob({
    id,
    hostId: H,
    kind: "install",
    osImageId: "ubuntu-24.04",
    status: "done",
    stages: [],
    tokenHash: null,
    tokenExpiresAt: null,
    bootServedAt: null,
    createdAt: at(0),
    updatedAt: at(0),
    finishedAt: at(0),
    ...over,
  })
}

describe("migrasi 2", () => {
  it("v1 berisi job M4 → v2: kolom baru, backfill installer_boots, idempoten", () => {
    const db = new DatabaseSync(":memory:")
    db.exec("PRAGMA foreign_keys = ON")
    runMigrations(db, MIGRATIONS.filter((m) => m.version === 1))
    db.prepare(
      `INSERT INTO hosts (id, mac, status, status_since, first_seen, last_seen) VALUES (?, ?, 'installing', ?, ?, ?)`,
    ).run(H, "52:54:00:99:00:11", at(0), at(0), at(0))
    const stages = [
      { stage: "booting", at: at(0), source: "install" },
      { stage: "booting", at: at(1), source: "boot-script" },
      { stage: "booting", at: at(2), source: "boot-script" },
      { stage: "installing", at: at(3), source: "config-fetch" },
    ]
    db.prepare(
      `INSERT INTO jobs (id, host_id, os_image_id, status, stages, created_at, updated_at) VALUES ('j', ?, 'ubuntu-24.04', 'installing', ?, ?, ?)`,
    ).run(H, JSON.stringify(stages), at(0), at(0))
    expect(runMigrations(db)).toEqual([2])
    expect(runMigrations(db)).toEqual([])
    expect(db.prepare("SELECT installer_boots, event_seq, failure_reason, stages FROM jobs").get()).toEqual({
      installer_boots: 2,
      event_seq: 0,
      failure_reason: null,
      stages: JSON.stringify(stages),
    })
    db.close()
  })
})

describe("job_events", () => {
  it("seq naik ketat; redaksi + sanitasi; gabung system identik ≤ 60 dtk", () => {
    host()
    job("j1", { status: "booting", finishedAt: null })
    expect(appendEvent("j1", { at: at(0), kind: "stage", level: "info", source: "install", message: "a" }, 100)).toEqual({ status: "appended", seq: 1 })
    expect(appendEvent("j1", { at: at(1), kind: "installer", level: "info", source: "installer", message: `x /boot/52:54:00:99:00:11/${TOKEN}/status\r\n` }, 100)).toEqual({ status: "appended", seq: 2 })
    const w = { kind: "system", level: "warn", source: "boot-script", message: "PXE boot ulang" } as const
    expect(appendEvent("j1", { ...w, at: at(2) }, 100)).toEqual({ status: "appended", seq: 3 })
    expect(appendEvent("j1", { ...w, at: at(30) }, 100)).toEqual({ status: "merged", seq: 3, repeat: 2 })
    expect(appendEvent("j1", { ...w, at: at(63) }, 100)).toEqual({ status: "appended", seq: 4 })
    const ev = eventsAfter("j1", 0)
    expect(ev.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    expect(ev[1].message).toBe("x /boot/52:54:00:99:00:11/[REDACTED]/status")
    expect(ev[2].repeat).toBe(2)
    expect(getJob("j1")!.eventSeq).toBe(4)
    expect(getJob("j1")!.updatedAt).toBe(at(63))
    expect(eventsAfter("j1", 2).map((e) => e.seq)).toEqual([3, 4])
    expect(appendEvent("tidak-ada", { ...w, at: at(0) }, 100)).toEqual({ status: "dropped" })
  })
  it("cap: installer dibuang + satu warn; stage tetap", () => {
    host()
    job("j1", { status: "installing", finishedAt: null })
    const inst = (i: number) => ({ at: at(i), kind: "installer" as const, level: "info" as const, source: "installer", message: `l${i}` })
    for (let i = 0; i < 3; i++) appendEvent("j1", inst(i), 3)
    expect(appendEvent("j1", inst(3), 3)).toEqual({ status: "dropped" })
    expect(appendEvent("j1", inst(4), 3)).toEqual({ status: "dropped" })
    expect(appendEvent("j1", { at: at(5), kind: "stage", level: "info", source: "callback", message: "done" }, 3).status).toBe("appended")
    const ev = eventsAfter("j1", 0)
    expect(ev.map((e) => e.message)).toEqual(["l0", "l1", "l2", LOG_TRUNCATED_MESSAGE, "done"])
  })
  it("sanitizeMessage: kontrol dibuang, \\t dipertahankan, dipotong 2048", () => {
    expect(sanitizeMessage("a\tb\u0000c\u001bd e")).toBe("a\tbcde")
    const long = sanitizeMessage("x".repeat(3000))
    expect(long).toBe("x".repeat(2048) + TRUNCATED_SUFFIX)
  })
})

describe("jobs repo M5", () => {
  it("listJobs: terbaru dulu, filter, cursor tanpa duplikat; before tak dikenal → null", () => {
    host()
    host("525400990012")
    for (let i = 0; i < 5; i++) job(`j${i}`, { createdAt: at(i), hostId: i % 2 ? "525400990012" : H, status: i === 4 ? "booting" : "done", finishedAt: i === 4 ? null : at(i) })
    const p1 = listJobs({ limit: 2 })!
    expect(p1.jobs.map((j) => j.id)).toEqual(["j4", "j3"])
    const p2 = listJobs({ limit: 2, before: p1.nextBefore! })!
    expect(p2.jobs.map((j) => j.id)).toEqual(["j2", "j1"])
    const p3 = listJobs({ limit: 2, before: p2.nextBefore! })!
    expect(p3).toEqual({ jobs: [expect.objectContaining({ id: "j0" })], nextBefore: null })
    expect(listJobs({ limit: 10, hostId: H })!.jobs.map((j) => j.id)).toEqual(["j4", "j2", "j0"])
    expect(listJobs({ limit: 10, status: "booting" })!.jobs.map((j) => j.id)).toEqual(["j4"])
    expect(listJobs({ limit: 10, before: "x" })).toBeNull()
    expect(latestJobsByHost().get(H)!.id).toBe("j4")
    expect(latestJobsByHost().get("525400990012")!.id).toBe("j3")
  })
  it("pruneHostHistory menyisakan N final terbaru + job aktif; event ikut terhapus; hapus host cascade", () => {
    host()
    for (let i = 0; i < 4; i++) job(`j${i}`, { createdAt: at(i) })
    job("act", { createdAt: at(9), status: "installing", finishedAt: null })
    appendEvent("j0", { at: at(0), kind: "stage", level: "info", source: "install", message: "x" }, 10)
    expect(pruneHostHistory(H, 2)).toBe(2)
    expect(listJobs({ limit: 10 })!.jobs.map((j) => j.id)).toEqual(["act", "j3", "j2"])
    expect(getDb().prepare("SELECT count(*) AS n FROM job_events").get()).toEqual({ n: 0 })
    appendEvent("act", { at: at(9), kind: "stage", level: "info", source: "install", message: "x" }, 10)
    deleteHost(H)
    expect(getDb().prepare("SELECT (SELECT count(*) FROM jobs) + (SELECT count(*) FROM job_events) AS n").get()).toEqual({ n: 0 })
  })
  it("supersedeActiveJobs → failed superseded + stage + token dicabut", () => {
    host()
    job("act", { status: "installing", finishedAt: null, tokenHash: "h", tokenExpiresAt: at(100) })
    expect(supersedeActiveJobs(H, at(5))).toEqual(["act"])
    expect(getJob("act")).toMatchObject({ status: "failed", failureReason: "superseded", tokenHash: null, tokenExpiresAt: null, finishedAt: at(5) })
    expect(getJob("act")!.stages.at(-1)).toEqual({ stage: "failed", at: at(5), source: "install" })
  })
})

describe("redactSecrets (dasar)", () => {
  it("token path/kv, hash, private key, base64; teks bersih identik; idempoten", () => {
    const hash = "$6$rounds=5000$saltsalt$" + "h".repeat(86)
    const pk = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----"
    const b64 = Buffer.from(`curl http://10.99.0.2/boot/52:54:00:99:00:11/${TOKEN}/status`).toString("base64")
    const b64u16 = Buffer.from(`pw ${hash}`, "utf16le").toString("base64")
    const input = [`/boot/525400990011/${TOKEN}/x`, `token=${TOKEN}`, `"token":"${TOKEN}"`, hash, pk, b64, b64u16].join(" | ")
    const out = redactSecrets(input)
    expect(out).not.toContain(TOKEN)
    expect(out).not.toContain(hash)
    expect(out).not.toContain("abc")
    expect(out).not.toContain(b64)
    expect(out).not.toContain(b64u16)
    expect(redactSecrets(out)).toBe(out)
    const clean = "installer: autoinstall mulai 10.99.0.21 " + "Q".repeat(50)
    expect(redactSecrets(clean)).toBe(clean)
  })
})
