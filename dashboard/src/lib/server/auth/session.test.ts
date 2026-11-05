// M6-T2 (backend-dev): sesi server-side (AC-6.5/6.6 tingkat unit, jam injeksi).
import { afterEach, describe, expect, it, vi } from "vitest"

import { getDb } from "@/lib/server/db"
import { countSessions, getSessionRow } from "@/lib/server/db/repos/sessions"
import { getSettings } from "@/lib/server/settings"
import { watchdogTick } from "@/lib/server/watchdog"
import { testAdminEnv } from "@/test/auth"
import { withDb } from "@/test/db"

import { hashPasswordSync } from "./password"
import {
  clearSessionCookieHeader,
  createSession,
  credFingerprint,
  destroySessionId,
  hashSessionId,
  pruneSessions,
  readCookie,
  SESSION_ID_RE,
  sessionByHash,
  sessionCookieHeader,
  sessionFromId,
  TOUCH_INTERVAL_MS,
} from "./session"

withDb("empty")

const T0 = new Date("2026-11-06T08:00:00.000Z")
const at = (ms: number) => new Date(T0.getTime() + ms)
const MIN = 60_000

function admin() {
  return getSettings().admin!
}

afterEach(() => vi.useRealTimers())

describe("createSession / sessionFromId", () => {
  it("id 32 B base64url (43), DB hanya menyimpan sha256 (id mentah tidak ada di DB)", () => {
    const { id, session } = createSession(admin(), "10.0.0.5", T0)
    expect(id).toMatch(SESSION_ID_RE)
    expect(Buffer.from(id, "base64url")).toHaveLength(32)
    expect(session.idHash).toBe(hashSessionId(id))
    expect(session.idHash).toMatch(/^[0-9a-f]{64}$/)
    const dump = JSON.stringify(getDb().prepare("SELECT * FROM sessions").all())
    expect(dump).not.toContain(id)
    expect(getSessionRow(session.idHash)).toMatchObject({
      username: "testadmin",
      credFp: credFingerprint(admin()),
      createdAt: T0.toISOString(),
      lastSeenAt: T0.toISOString(),
      expiresAt: at(12 * 60 * MIN).toISOString(),
      ip: "10.0.0.5",
    })
    expect(sessionFromId(id, at(1000))).toEqual({
      idHash: session.idHash,
      username: "testadmin",
      createdAt: T0.toISOString(),
      expiresAt: session.expiresAt,
    })
  })

  it("dua sesi → id berbeda", () => {
    expect(createSession(admin(), null, T0).id).not.toBe(createSession(admin(), null, T0).id)
  })

  it("cookie rusak / palsu / kosong → null tanpa melempar", () => {
    createSession(admin(), null, T0)
    for (const v of [undefined, null, "", "abc", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`, "../../etc", "a".repeat(43)])
      expect(sessionFromId(v as string | undefined, T0)).toBeNull()
  })

  it("idle: tepat batas idle masih valid; idle + 1 dtk → null dan baris dihapus", () => {
    const { id, session } = createSession(admin(), null, T0)
    expect(sessionFromId(id, at(120 * MIN), false)).not.toBeNull()
    expect(sessionFromId(id, at(120 * MIN + 1000))).toBeNull()
    expect(getSessionRow(session.idHash)).toBeNull()
  })

  it("aktivitas memperpanjang idle; ≤ 1 tulis last_seen_at per 60 dtk walau 20 request", () => {
    const { id, session } = createSession(admin(), null, T0)
    const writes = vi.spyOn(getDb(), "prepare")
    for (let i = 1; i <= 20; i++) expect(sessionFromId(id, at(i * 1000))).not.toBeNull()
    const updates = writes.mock.calls.filter(([sql]) => /UPDATE sessions SET last_seen_at/.test(String(sql)))
    expect(updates).toHaveLength(0)
    expect(getSessionRow(session.idHash)!.lastSeenAt).toBe(T0.toISOString())
    expect(sessionFromId(id, at(TOUCH_INTERVAL_MS))).not.toBeNull()
    expect(getSessionRow(session.idHash)!.lastSeenAt).toBe(at(TOUCH_INTERVAL_MS).toISOString())
    writes.mockRestore()
    // Aktivitas tiap 100 mnt menjaga sesi tetap hidup melewati 120 mnt sejak login.
    let t = TOUCH_INTERVAL_MS
    for (let i = 0; i < 4; i++) {
      t += 100 * MIN
      expect(sessionFromId(id, at(t)), `t=${t}`).not.toBeNull()
    }
  })

  it("touch=false tidak memperpanjang", () => {
    const { id, session } = createSession(admin(), null, T0)
    expect(sessionFromId(id, at(5 * MIN), false)).not.toBeNull()
    expect(getSessionRow(session.idHash)!.lastSeenAt).toBe(T0.toISOString())
  })

  it("absolut PXE_SESSION_MAX_HOURS → null walau aktif", () => {
    process.env.PXE_SESSION_MAX_HOURS = "1"
    const { id } = createSession(admin(), null, T0)
    for (let m = 10; m < 60; m += 10) expect(sessionFromId(id, at(m * MIN))).not.toBeNull()
    expect(sessionFromId(id, at(60 * MIN))).toBeNull()
  })

  it("mengganti PXE_ADMIN_PASSWORD_HASH atau username → semua sesi lama batal", () => {
    const a = createSession(admin(), null, T0).id
    const b = createSession(admin(), null, T0).id
    process.env.PXE_ADMIN_PASSWORD_HASH = hashPasswordSync("another-password-1", { logN: 14, r: 8, p: 1 })
    expect(sessionFromId(a, T0)).toBeNull()
    expect(sessionFromId(b, T0)).toBeNull()
    Object.assign(process.env, testAdminEnv())
    const c = createSession(admin(), null, T0).id
    process.env.PXE_ADMIN_USERNAME = "otheradmin"
    expect(sessionFromId(c, T0)).toBeNull()
  })

  it("admin tidak dikonfigurasi → sesi apa pun null", () => {
    const { id, session } = createSession(admin(), null, T0)
    delete process.env.PXE_ADMIN_USERNAME
    expect(sessionFromId(id, T0)).toBeNull()
    expect(sessionByHash(session.idHash, T0)).toBeNull()
  })

  it("destroySessionId menghapus; id rusak no-op", () => {
    const { id } = createSession(admin(), null, T0)
    destroySessionId("rusak")
    destroySessionId(null)
    expect(countSessions()).toBe(1)
    destroySessionId(id)
    expect(countSessions()).toBe(0)
    expect(sessionFromId(id, T0)).toBeNull()
  })
})

describe("pruneSessions (sweep)", () => {
  it("menghapus kedaluwarsa absolut, idle, dan sidik kredensial lama; idempoten", () => {
    process.env.PXE_SESSION_MAX_HOURS = "2"
    const live = createSession(admin(), null, at(90 * MIN))
    createSession(admin(), null, T0) // idle > 120 mnt pada t=125 mnt
    const absolute = createSession(admin(), null, at(5 * MIN))
    getDb().prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").run(at(124 * MIN).toISOString(), absolute.session.idHash)
    getDb()
      .prepare("INSERT INTO sessions (id_hash, username, cred_fp, created_at, last_seen_at, expires_at, ip) VALUES (?, 'testadmin', 'oldfp', ?, ?, ?, NULL)")
      .run("f".repeat(64), at(120 * MIN).toISOString(), at(124 * MIN).toISOString(), at(600 * MIN).toISOString())
    expect(countSessions()).toBe(4)
    expect(pruneSessions(at(125 * MIN))).toBe(3)
    expect(pruneSessions(at(125 * MIN))).toBe(0)
    expect(countSessions()).toBe(1)
    expect(getSessionRow(live.session.idHash)).not.toBeNull()
  })

  it("admin tidak dikonfigurasi → semua sesi dihapus", () => {
    createSession(admin(), null, T0)
    delete process.env.PXE_ADMIN_PASSWORD_HASH
    expect(pruneSessions(T0)).toBe(1)
  })

  it("watchdogTick juga memangkas sesi kedaluwarsa", () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    createSession(admin(), null, T0)
    vi.setSystemTime(at(121 * MIN))
    expect(watchdogTick({ error: vi.fn() })).toBe(0)
    expect(countSessions()).toBe(0)
  })

  it("watchdogTick: pembersihan sesi gagal dicatat satu baris tanpa melempar", () => {
    const error = vi.fn()
    const db = getDb()
    const orig = db.prepare.bind(db)
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (/DELETE FROM sessions/.test(sql)) throw new Error("disk I/O")
      return orig(sql)
    })
    expect(watchdogTick({ error })).toBe(0)
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toMatch(/^\[watchdog\] pembersihan sesi gagal/)
  })
})

describe("cookie", () => {
  it("Set-Cookie: HttpOnly, SameSite=Strict, Path=/, Max-Age jam absolut; Secure hanya untuk https", () => {
    const h = sessionCookieHeader("abc")
    expect(h).toBe("pxe_session=abc; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200")
    expect(clearSessionCookieHeader()).toBe("pxe_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
    process.env.PXE_BASE_URL = "https://pxe.lab.example"
    expect(sessionCookieHeader("abc")).toMatch(/; Secure$/)
    expect(clearSessionCookieHeader()).toMatch(/; Secure$/)
  })

  it("readCookie: nama tepat, nilai pertama, header kosong", () => {
    expect(readCookie(null)).toBeNull()
    expect(readCookie("")).toBeNull()
    expect(readCookie("a=1; pxe_session=xyz; b=2")).toBe("xyz")
    expect(readCookie("xpxe_session=1; pxe_session_old=2")).toBeNull()
    expect(readCookie("pxe_session=first; pxe_session=second")).toBe("first")
    expect(readCookie("garbage; pxe_session = spaced ")).toBe("spaced")
  })
})
