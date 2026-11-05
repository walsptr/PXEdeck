// M6-T1/T3/T5 (backend-dev): settings auth + aturan start (AC-6.1–6.3, unit), throttle log
// penolakan /boot (SR-5-3, AC-6.12), migrasi 3 (CR-5-7, AC-6.22), paritas tipe (CR-5-9, AC-6.24).
import { DatabaseSync } from "node:sqlite"

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest"

import type * as T from "@/lib/types"
import type { JobEvent } from "@/lib/server/db/repos/job-events"
import type { FailureReason as RepoFailureReason, JobStatus as RepoJobStatus } from "@/lib/server/db/repos/jobs"
import type { OsImageInfo as RepoOsImageInfo } from "@/lib/server/db/repos/os-images"
import type { SshKeyInfo as LibSshKeyInfo } from "@/lib/server/library-service"
import type { JobSummary as SrvJobSummary, LastJob } from "@/lib/server/jobs-service"
import type { OsImageInfo as HookOsImageInfo } from "@/hooks/use-os-images"
import type { SshKeyInfo as HookSshKeyInfo } from "@/hooks/use-ssh-keys"
import { FAILURE_REASONS as CLIENT_FR, JOB_STATUSES as CLIENT_JS } from "@/lib/types"
import { FAILURE_REASONS, JOB_STATUSES } from "@/lib/server/db/repos/jobs"
import { testAdminHash } from "@/test/auth"
import { isolateEnv } from "@/test/env"

import { hashPasswordSync } from "./auth/password"
import {
  BOOT_LOG_MAX_PER_WINDOW,
  BOOT_LOG_WINDOW_MS,
  bootDeniedLine,
  bootSuppressedLine,
  createBootLogThrottle,
  logBootDenied,
  resetBootLogThrottle,
} from "./boot-http"
import { MIGRATIONS, runMigrations } from "./db/migrations"
import {
  authWarnings,
  getSettings,
  INSECURE_CONFIRM_PHRASE,
  settingsFromEnv,
  toSettingsResponse,
  type SettingsEnv,
} from "./settings"
import { errorClass } from "./sse"
import { onServerStart, startOrExit } from "./startup"

isolateEnv()

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const admin = () => ({ PXE_ADMIN_USERNAME: "pxeadmin", PXE_ADMIN_PASSWORD_HASH: testAdminHash() })
const PROD = { NODE_ENV: "production" } as SettingsEnv

describe("settings auth (AC-6.1)", () => {
  it("default + batas variabel sesi/rate", () => {
    const s = settingsFromEnv(admin())
    expect(s.auth).toEqual({ sessionIdleMin: 120, sessionMaxHours: 12, loginMaxFailures: 5, loginWindowMin: 15, apiRatePerMin: 600 })
    expect(s.admin).toEqual({ username: "pxeadmin", passwordHash: testAdminHash() })
    const ok = settingsFromEnv({ ...admin(), PXE_SESSION_IDLE_MIN: "1440", PXE_SESSION_MAX_HOURS: "168", PXE_LOGIN_MAX_FAILURES: "100", PXE_LOGIN_WINDOW_MIN: "1", PXE_API_RATE_PER_MIN: "10000" })
    expect(ok.auth).toEqual({ sessionIdleMin: 1440, sessionMaxHours: 168, loginMaxFailures: 100, loginWindowMin: 1, apiRatePerMin: 10_000 })
  })

  it.each([
    ["PXE_SESSION_IDLE_MIN", "0"],
    ["PXE_SESSION_IDLE_MIN", "1441"],
    ["PXE_SESSION_MAX_HOURS", "0"],
    ["PXE_SESSION_MAX_HOURS", "169"],
    ["PXE_LOGIN_MAX_FAILURES", "2"],
    ["PXE_LOGIN_MAX_FAILURES", "101"],
    ["PXE_LOGIN_WINDOW_MIN", "0"],
    ["PXE_LOGIN_WINDOW_MIN", "1441"],
    ["PXE_API_RATE_PER_MIN", "59"],
    ["PXE_API_RATE_PER_MIN", "10001"],
    ["PXE_API_RATE_PER_MIN", "6e2"],
  ])("%s=%s → error menyebut variabel", (k, v) => {
    expect(() => settingsFromEnv({ ...admin(), [k]: v })).toThrow(new RegExp(k))
  })

  it("username admin tidak valid → error; hash tidak valid → error tanpa nilai hash (semua mode)", () => {
    for (const u of ["Admin", "1admin", "a b", "a".repeat(33), "adm!n"])
      expect(() => settingsFromEnv({ ...admin(), PXE_ADMIN_USERNAME: u })).toThrow(/PXE_ADMIN_USERNAME/)
    const badHash = testAdminHash().replace(/^scrypt\$14\$/, "scrypt$21$")
    for (const env of [{}, PROD]) {
      let msg = ""
      try {
        settingsFromEnv({ ...env, ...admin(), PXE_ADMIN_PASSWORD_HASH: badHash })
      } catch (e) {
        msg = (e as Error).message
      }
      expect(msg).toMatch(/PXE_ADMIN_PASSWORD_HASH/)
      for (const part of badHash.split("$").slice(4)) expect(msg).not.toContain(part)
      expect(msg).not.toContain(badHash)
    }
  })

  it("hash dengan spasi di tepi diterima (EnvironmentFile); kutip tidak dibuang oleh app", () => {
    expect(settingsFromEnv({ ...admin(), PXE_ADMIN_PASSWORD_HASH: ` ${testAdminHash()} ` }).admin?.passwordHash).toBe(testAdminHash())
    expect(() => settingsFromEnv({ ...admin(), PXE_ADMIN_PASSWORD_HASH: `'${testAdminHash()}'` })).toThrow(/PXE_ADMIN_PASSWORD_HASH/)
  })

  it("GET /api/settings: blok auth + insecureConfirmed; tanpa hash/`scrypt` dalam bentuk apa pun (rekursif)", () => {
    const r = toSettingsResponse(settingsFromEnv(admin()))
    expect(r.auth).toEqual({ adminUsername: "pxeadmin", adminConfigured: true, sessionIdleMin: 120, sessionMaxHours: 12, loginMaxFailures: 5, loginWindowMin: 15, apiRatePerMin: 600 })
    expect(r.insecureConfirmed).toBe(false)
    const walk = (v: unknown, keys: string[] = []): void => {
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...keys, k])
      else expect(String(v), keys.join(".")).not.toMatch(/scrypt|\$\d+\$/)
      for (const k of keys) expect(k.toLowerCase()).not.toMatch(/hash|password/)
    }
    walk(r)
    expect(JSON.stringify(r)).not.toContain(testAdminHash())
  })
})

describe("aturan start (AC-6.2, AC-6.3)", () => {
  it.each([
    ["tanpa username", { PXE_ADMIN_PASSWORD_HASH: "" }, /PXE_ADMIN_USERNAME dan PXE_ADMIN_PASSWORD_HASH/],
    ["tanpa hash", { PXE_ADMIN_USERNAME: "pxeadmin" }, /PXE_ADMIN_USERNAME dan PXE_ADMIN_PASSWORD_HASH/],
    ["hash format salah", { PXE_ADMIN_USERNAME: "pxeadmin", PXE_ADMIN_PASSWORD_HASH: "@PXE_ADMIN_PASSWORD_HASH@" }, /PXE_ADMIN_PASSWORD_HASH/],
  ])("production %s → start ditolak", (_, env, re) => {
    expect(() => settingsFromEnv({ ...PROD, ...env } as SettingsEnv)).toThrow(re)
  })

  it("production logN=21 → start ditolak (startOrExit exit 1, baris `[pxe] start ditolak:` tanpa nilai hash)", () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.PXE_ADMIN_PASSWORD_HASH = testAdminHash().replace(/^scrypt\$14\$/, "scrypt$21$")
    const error = vi.fn()
    const exit = vi.fn((c: number) => {
      throw new Error(`exit ${c}`)
    }) as unknown as (c: number) => never
    expect(() => startOrExit({ warn: vi.fn(), error }, exit)).toThrow("exit 1")
    const line = String(error.mock.calls[0][0])
    expect(line).toMatch(/^\[pxe\] start ditolak: .*PXE_ADMIN_PASSWORD_HASH/)
    expect(line).not.toContain(process.env.PXE_ADMIN_PASSWORD_HASH!.split("$")[5])
    expect(line).not.toContain("\n")
  })

  it("production + admin valid → start tanpa peringatan admin", () => {
    vi.stubEnv("NODE_ENV", "production")
    const warn = vi.fn()
    onServerStart({ warn, error: vi.fn() }, false)
    expect(warn).not.toHaveBeenCalled()
  })

  it("non-production tanpa admin → start dengan tepat satu peringatan (tanpa kredensial default)", () => {
    delete process.env.PXE_ADMIN_USERNAME
    delete process.env.PXE_ADMIN_PASSWORD_HASH
    const warn = vi.fn()
    const s = onServerStart({ warn, error: vi.fn() }, false)
    expect(s.admin).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[pxe\] PERINGATAN: admin belum dikonfigurasi/)
    expect(authWarnings(settingsFromEnv(admin()))).toEqual([])
    // Hanya username atau hanya hash = belum dikonfigurasi (non-production).
    expect(settingsFromEnv({ PXE_ADMIN_USERNAME: "pxeadmin" }).admin).toBeNull()
    expect(settingsFromEnv({ PXE_ADMIN_PASSWORD_HASH: testAdminHash() }).admin).toBeNull()
  })

  it("SR-5-4: production + insecure tanpa/beda konfirmasi → ditolak (pesan menyebut kedua variabel); frasa tepat → start + peringatan", () => {
    const base = { ...PROD, ...admin(), PXE_TRUST_PROXY: "1", PXE_INSECURE_NO_LEASE_CHECK: "1" } as SettingsEnv
    for (const c of [undefined, "", "yes", "1", INSECURE_CONFIRM_PHRASE.toLowerCase(), ` ${INSECURE_CONFIRM_PHRASE}`, `${INSECURE_CONFIRM_PHRASE} `, `${INSECURE_CONFIRM_PHRASE}X`]) {
      expect(() => settingsFromEnv({ ...base, PXE_INSECURE_NO_LEASE_CHECK_CONFIRM: c }), String(c)).toThrow(
        /PXE_INSECURE_NO_LEASE_CHECK=1.*PXE_INSECURE_NO_LEASE_CHECK_CONFIRM/,
      )
    }
    const s = settingsFromEnv({ ...base, PXE_INSECURE_NO_LEASE_CHECK_CONFIRM: INSECURE_CONFIRM_PHRASE })
    expect(s.insecureConfirmed).toBe(true)
    expect(toSettingsResponse(s).insecureConfirmed).toBe(true)
    vi.stubEnv("NODE_ENV", "production")
    Object.assign(process.env, { PXE_TRUST_PROXY: "1", PXE_INSECURE_NO_LEASE_CHECK: "1", PXE_INSECURE_NO_LEASE_CHECK_CONFIRM: INSECURE_CONFIRM_PHRASE })
    const warn = vi.fn()
    onServerStart({ warn, error: vi.fn() }, false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/PXE_INSECURE_NO_LEASE_CHECK=1/)
  })

  it("SR-5-4 non-production tidak terpengaruh konfirmasi", () => {
    const s = settingsFromEnv({ PXE_TRUST_PROXY: "1", PXE_INSECURE_NO_LEASE_CHECK: "1" })
    expect(s.insecureNoLeaseCheck).toBe(true)
    expect(s.insecureConfirmed).toBe(false)
  })

  it("getSettings membaca env auth (kunci cache)", () => {
    process.env.PXE_SESSION_IDLE_MIN = "7"
    expect(getSettings().auth.sessionIdleMin).toBe(7)
    process.env.PXE_SESSION_IDLE_MIN = "8"
    expect(getSettings().auth.sessionIdleMin).toBe(8)
  })
})

describe("SR-5-3 throttle log penolakan /boot (AC-6.12)", () => {
  it("100 penolakan log dalam 60 dtk → 20 baris detail + tepat 1 ringkasan `80 penolakan log` saat jendela berganti", () => {
    vi.useFakeTimers()
    const lines: string[] = []
    const t = createBootLogThrottle((l) => lines.push(l))
    for (let i = 0; i < 100; i++) t.log("log", bootDeniedLine("log", "zz", "token-unknown"))
    expect(lines).toHaveLength(BOOT_LOG_MAX_PER_WINDOW)
    expect(new Set(lines)).toEqual(new Set(["[boot] tolak log mac=- alasan=token-unknown"]))
    vi.advanceTimersByTime(BOOT_LOG_WINDOW_MS - 1)
    expect(lines).toHaveLength(20)
    vi.advanceTimersByTime(1)
    expect(lines).toHaveLength(21)
    expect(lines[20]).toBe("[boot] 80 penolakan log ditekan dalam 60 dtk")
    expect(lines[20]).toBe(bootSuppressedLine("log", 80))
    expect(vi.getTimerCount()).toBe(0)
    // Jendela baru: kuota penuh lagi.
    for (let i = 0; i < 25; i++) t.log("log", "x")
    expect(lines.filter((l) => l === "x")).toHaveLength(20)
    t.flush()
    expect(lines.at(-1)).toBe("[boot] 5 penolakan log ditekan dalam 60 dtk")
    t.flush()
    expect(lines.filter((l) => l.includes("ditekan"))).toHaveLength(2)
  })

  it("jalur lain punya kuota sendiri; tanpa penekanan → tanpa ringkasan; panggilan setelah jendela habis juga menutup jendela", () => {
    let now = 0
    const lines: string[] = []
    const t = createBootLogThrottle((l) => lines.push(l), () => now)
    for (let i = 0; i < 21; i++) t.log("file", "f")
    for (let i = 0; i < 20; i++) t.log("status", "s")
    for (let i = 0; i < 20; i++) t.log("ipxe", "i")
    expect(lines.filter((l) => l === "f")).toHaveLength(20)
    expect(lines.filter((l) => l === "s")).toHaveLength(20)
    expect(lines.filter((l) => l === "i")).toHaveLength(20)
    now = BOOT_LOG_WINDOW_MS
    t.log("file", "f2")
    t.log("status", "s2")
    expect(lines.slice(-3)).toEqual(["[boot] 1 penolakan file ditekan dalam 60 dtk", "f2", "s2"])
    t.dispose()
  })

  it("dispose membuang timer tanpa menulis ringkasan", () => {
    vi.useFakeTimers()
    const lines: string[] = []
    const t = createBootLogThrottle((l) => lines.push(l))
    for (let i = 0; i < 30; i++) t.log("log", "x")
    t.dispose()
    vi.advanceTimersByTime(BOOT_LOG_WINDOW_MS * 2)
    expect(lines).toHaveLength(20)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("logBootDenied (di luar test) lewat throttle global: tiap baris satu baris ter-escape tanpa token", () => {
    vi.useFakeTimers()
    vi.stubEnv("VITEST", "")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    resetBootLogThrottle()
    const token = "A".repeat(43)
    for (let i = 0; i < 100; i++) logBootDenied("log", `52:54:00:99:00:11\n${token}`, `alasan\r\n${i}`)
    expect(warn).toHaveBeenCalledTimes(20)
    vi.advanceTimersByTime(BOOT_LOG_WINDOW_MS)
    expect(warn).toHaveBeenCalledTimes(21)
    const all = warn.mock.calls.map((c) => String(c[0]))
    for (const l of all) {
      expect(l).not.toContain("\n")
      expect(l).not.toContain(token)
    }
    expect(all[0]).toBe("[boot] tolak log mac=- alasan=alasan\\u000d\\u000a0")
    expect(all[20]).toBe("[boot] 80 penolakan log ditekan dalam 60 dtk")
    resetBootLogThrottle()
    warn.mockRestore()
  })
})

describe("migrasi 3 (CR-5-7, AC-6.22)", () => {
  it("DB v2 berisi event → v3: tabel sessions, last_at = at; migrasi dua kali tanpa error", () => {
    const db = new DatabaseSync(":memory:")
    runMigrations(db, MIGRATIONS.filter((m) => m.version <= 2))
    db.prepare("INSERT INTO hosts (id, mac, status, status_since, first_seen, last_seen) VALUES ('525400990011', '52:54:00:99:00:11', 'done', 'x', 'x', 'x')").run()
    db.prepare("INSERT INTO jobs (id, host_id, os_image_id, status, created_at, updated_at) VALUES ('j', '525400990011', 'u', 'done', 'a', 'a')").run()
    db.prepare("INSERT INTO job_events (job_id, seq, at, kind, level, source, message, repeat) VALUES ('j', 1, '2026-11-06T00:00:00.000Z', 'system', 'warn', 's', 'm', 4)").run()
    expect(runMigrations(db)).toEqual([3])
    expect(runMigrations(db)).toEqual([])
    expect(db.prepare("SELECT at, last_at, repeat FROM job_events").get()).toEqual({ at: "2026-11-06T00:00:00.000Z", last_at: "2026-11-06T00:00:00.000Z", repeat: 4 })
    const cols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(["id_hash", "username", "cred_fp", "created_at", "last_seen_at", "expires_at", "ip"])
    expect(() => db.prepare("INSERT INTO sessions VALUES ('pendek', 'u', 'f', 'a', 'a', 'a', NULL)").run()).toThrow(/CHECK/)
    db.close()
  })
})

describe("CR-5-9 tipe kontrak satu sumber (AC-6.24)", () => {
  it("tipe server = tipe klien", () => {
    expectTypeOf<SrvJobSummary>().toEqualTypeOf<T.JobSummary>()
    expectTypeOf<LastJob>().toEqualTypeOf<T.HostLastJob>()
    expectTypeOf<T.HostLastJob["failureReason"]>().toEqualTypeOf<T.FailureReason | null>()
    expectTypeOf<JobEvent>().toEqualTypeOf<T.JobLogEvent>()
    expectTypeOf<RepoOsImageInfo>().toEqualTypeOf<T.OsImageInfo>()
    expectTypeOf<HookOsImageInfo>().toEqualTypeOf<T.OsImageInfo>()
    expectTypeOf<LibSshKeyInfo>().toEqualTypeOf<T.SshKeyInfo>()
    expectTypeOf<HookSshKeyInfo>().toEqualTypeOf<T.SshKeyInfo>()
    expectTypeOf<RepoJobStatus>().toEqualTypeOf<T.JobStatus>()
    expectTypeOf<RepoFailureReason>().toEqualTypeOf<T.FailureReason>()
    expect([...CLIENT_JS]).toEqual([...JOB_STATUSES])
    expect([...CLIENT_FR]).toEqual([...FAILURE_REASONS])
  })

  it("errorClass: kode SQLite / nama error, tanpa pesan", () => {
    expect(errorClass(Object.assign(new Error("database is locked"), { errcode: 5 }))).toBe("SQLITE_BUSY")
    expect(errorClass(Object.assign(new Error("x"), { errcode: 517 }))).toBe("SQLITE_BUSY")
    expect(errorClass(Object.assign(new Error("x"), { errcode: 6 }))).toBe("SQLITE_LOCKED")
    expect(errorClass(Object.assign(new Error("x"), { errcode: 19 }))).toBe("SQLITE_19")
    expect(errorClass(Object.assign(new Error("x"), { code: "ERR_X y\n" }))).toBe("ERR_Xy")
    expect(errorClass(new RangeError("pesan rahasia"))).toBe("RangeError")
    expect(errorClass(null)).toBe("Error")
    expect(errorClass("str")).toBe("Error")
    expect(hashPasswordSync).toBeTypeOf("function")
  })
})
