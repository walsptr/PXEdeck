// M6-T2/T3 (backend-dev): POST /api/auth/login, POST /api/auth/logout, GET /api/auth/session,
// rate limit login & API (AC-6.2, 6.5, 6.6, 6.10, 6.11 tingkat route handler, jam injeksi).
import crypto from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

import { getDb } from "@/lib/server/db"
import { countSessions } from "@/lib/server/db/repos/sessions"
import { hashPasswordSync } from "@/lib/server/auth/password"
import { hashSessionId } from "@/lib/server/auth/session"
import { TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME } from "@/test/auth"
import { withDb } from "@/test/db"

import { GET as hostsGET } from "../hosts/route"
import { GET as bootGET } from "../../boot/[name]/route"
import { POST as loginPOST } from "./login/route"
import { POST as logoutPOST } from "./logout/route"
import { GET as sessionGET } from "./session/route"

withDb("demo")

const T0 = new Date("2026-11-06T08:00:00.000Z")
const MIN = 60_000

function loginReq(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify(body),
  })
}
const good = { username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD }
const login = (body: unknown = good, headers: Record<string, string> = {}) => loginPOST(loginReq(body, headers))

function cookieOf(res: Response): string {
  const sc = res.headers.get("set-cookie")!
  return sc.split(";")[0]
}
const idOf = (cookie: string) => cookie.split("=")[1]
const withCookie = (url: string, cookie: string, init: RequestInit = {}) =>
  new Request(`http://localhost${url}`, { ...init, headers: { ...(init.headers as Record<string, string>), cookie } })

afterEach(() => vi.useRealTimers())

describe("POST /api/auth/login (AC-6.5)", () => {
  it("benar → 204 + Set-Cookie pxe_session HttpOnly/SameSite=Strict/Path=/ tanpa Secure (http); DB hanya sha256", async () => {
    const res = await login()
    expect(res.status).toBe(204)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const sc = res.headers.get("set-cookie")!
    expect(sc).toMatch(/^pxe_session=[A-Za-z0-9_-]{43}; /)
    expect(sc).toContain("; HttpOnly")
    expect(sc).toContain("; SameSite=Strict")
    expect(sc).toContain("; Path=/")
    expect(sc).toContain("; Max-Age=43200")
    expect(sc).not.toMatch(/Secure/i)
    const id = idOf(cookieOf(res))
    const dump = JSON.stringify(getDb().prepare("SELECT * FROM sessions").all())
    expect(dump).not.toContain(id)
    expect(dump).toContain(hashSessionId(id))
    expect(dump).not.toContain(TEST_ADMIN_PASSWORD)
    // Cookie dipakai → API terbuka.
    expect((await hostsGET(withCookie("/api/hosts", cookieOf(res)))).status).toBe(200)
  })

  it("PXE_BASE_URL https → cookie Secure", async () => {
    process.env.PXE_BASE_URL = "https://pxe.lab.example"
    const res = await login()
    expect(res.status).toBe(204)
    expect(res.headers.get("set-cookie")).toMatch(/; Secure$/)
  })

  it("password salah dan username tak dikenal → 401 dengan body identik; scrypt tetap dijalankan", async () => {
    const spy = vi.spyOn(crypto, "scrypt")
    const a = await login({ username: TEST_ADMIN_USERNAME, password: "salah-sekali-123" })
    const b = await login({ username: "tidakada", password: "salah-sekali-123" })
    const c = await login({ username: TEST_ADMIN_USERNAME.toUpperCase(), password: TEST_ADMIN_PASSWORD })
    for (const r of [a, b, c]) {
      expect(r.status).toBe(401)
      expect(r.headers.get("set-cookie")).toBeNull()
    }
    const bodies = await Promise.all([a, b, c].map((r) => r.text()))
    expect(new Set(bodies).size).toBe(1)
    expect(JSON.parse(bodies[0])).toEqual({ error: "Username atau password salah" })
    expect(spy).toHaveBeenCalledTimes(3)
    expect(countSessions()).toBe(0)
  })

  it("Origin lintas → 403; Sec-Fetch-Site cross-site → 403; non-JSON → 415; kunci tambahan/field salah → 400; > 1 MB → 413", async () => {
    expect((await login(good, { origin: "http://evil.test" })).status).toBe(403)
    expect((await login(good, { "sec-fetch-site": "cross-site" })).status).toBe(403)
    expect((await login(good, { host: "evil.test" })).status).toBe(403)
    expect((await loginPOST(loginReq(good, { "content-type": "text/plain" }))).status).toBe(415)
    expect((await loginPOST(loginReq(good, { "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415)
    for (const b of [{ ...good, extra: 1 }, { username: TEST_ADMIN_USERNAME }, { username: "", password: "x" }, { username: TEST_ADMIN_USERNAME, password: "" }, { username: TEST_ADMIN_USERNAME, password: "x".repeat(257) }, { username: "u".repeat(65), password: "x" }, [], "str"])
      expect((await login(b)).status, JSON.stringify(b)).toBe(400)
    expect((await loginPOST(loginReq(null, {}, "{"))).status).toBe(400)
    expect((await loginPOST(loginReq(null, { "content-length": String(2 * 1024 * 1024) }, "{}"))).status).toBe(413)
    expect(countSessions()).toBe(0)
  })

  it("dua login berurutan → dua id berbeda; id dari cookie request lama dihapus", async () => {
    const c1 = cookieOf(await login())
    const res2 = await loginPOST(loginReq(good, { cookie: c1 }))
    expect(res2.status).toBe(204)
    const c2 = cookieOf(res2)
    expect(c2).not.toBe(c1)
    expect(countSessions()).toBe(1)
    expect((await hostsGET(withCookie("/api/hosts", c1))).status).toBe(401)
    expect((await hostsGET(withCookie("/api/hosts", c2))).status).toBe(200)
  })

  it("admin belum dikonfigurasi (non-production) → login apa pun 401 dan API 401 (AC-6.2)", async () => {
    delete process.env.PXE_ADMIN_USERNAME
    delete process.env.PXE_ADMIN_PASSWORD_HASH
    for (const b of [good, { username: "admin", password: "admin" }, { username: "root", password: "x" }])
      expect((await login(b)).status).toBe(401)
    expect((await hostsGET(new Request("http://localhost/api/hosts"))).status).toBe(401)
    expect(countSessions()).toBe(0)
  })
})

describe("logout & session (AC-6.6)", () => {
  it("GET /api/auth/session → {username, expiresAt}; tanpa sesi → 401 Perlu login", async () => {
    const c = cookieOf(await login())
    const res = await sessionGET(withCookie("/api/auth/session", c))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "username"])
    expect(body.username).toBe(TEST_ADMIN_USERNAME)
    const anon = await sessionGET(new Request("http://localhost/api/auth/session"))
    expect(anon.status).toBe(401)
    expect(await anon.json()).toEqual({ error: "Perlu login" })
  })

  it("logout → 204, cookie Max-Age=0, baris sesi dihapus, cookie lama → 401; logout tanpa sesi → 401", async () => {
    const c = cookieOf(await login())
    const out = await logoutPOST(withCookie("/api/auth/logout", c, { method: "POST" }))
    expect(out.status).toBe(204)
    expect(out.headers.get("set-cookie")).toBe("pxe_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
    expect(countSessions()).toBe(0)
    expect((await hostsGET(withCookie("/api/hosts", c))).status).toBe(401)
    expect((await sessionGET(withCookie("/api/auth/session", c))).status).toBe(401)
    expect((await logoutPOST(withCookie("/api/auth/logout", c, { method: "POST" }))).status).toBe(401)
    // CSRF: logout lintas-origin ditolak sebelum sesi disentuh.
    const c2 = cookieOf(await login())
    expect((await logoutPOST(withCookie("/api/auth/logout", c2, { method: "POST", headers: { origin: "http://evil.test" } }))).status).toBe(403)
    expect(countSessions()).toBe(1)
  })

  it("idle + 1 dtk → 401; aktif sebelum idle memperpanjang; absolut → 401 walau aktif; ganti hash → 401", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const c = cookieOf(await login())
    vi.setSystemTime(new Date(T0.getTime() + 119 * MIN))
    expect((await hostsGET(withCookie("/api/hosts", c))).status).toBe(200)
    vi.setSystemTime(new Date(T0.getTime() + (119 + 120) * MIN))
    expect((await hostsGET(withCookie("/api/hosts", c))).status).toBe(200)
    vi.setSystemTime(new Date(T0.getTime() + (239 + 120) * MIN + 1000))
    expect((await hostsGET(withCookie("/api/hosts", c))).status).toBe(401)

    vi.setSystemTime(T0)
    process.env.PXE_SESSION_MAX_HOURS = "2"
    const c2 = cookieOf(await login())
    for (let m = 30; m < 120; m += 30) {
      vi.setSystemTime(new Date(T0.getTime() + m * MIN))
      expect((await hostsGET(withCookie("/api/hosts", c2))).status).toBe(200)
    }
    vi.setSystemTime(new Date(T0.getTime() + 120 * MIN))
    expect((await hostsGET(withCookie("/api/hosts", c2))).status).toBe(401)

    vi.setSystemTime(T0)
    const c3 = cookieOf(await login())
    process.env.PXE_ADMIN_PASSWORD_HASH = hashPasswordSync(TEST_ADMIN_PASSWORD, { logN: 14, r: 8, p: 1 }) // hash baru, password sama
    expect((await hostsGET(withCookie("/api/hosts", c3))).status).toBe(401)
  })
})

describe("rate limit login (AC-6.10)", () => {
  const trusted = (ip: string) => ({ "x-real-ip": ip })
  function trustProxy() {
    process.env.PXE_TRUST_PROXY = "1"
    process.env.PXE_INSECURE_NO_LEASE_CHECK = "1"
  }

  it("5 gagal untuk (IP, admin) → ke-6 (password BENAR) 429 + Retry-After; body sama untuk username tak dikenal; jendela lewat → 204", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    trustProxy()
    for (let i = 0; i < 5; i++) expect((await login({ ...good, password: `salah-${i}-xxxxxx` }, trusted("10.0.0.7"))).status).toBe(401)
    const locked = await login(good, trusted("10.0.0.7"))
    expect(locked.status).toBe(429)
    expect(locked.headers.get("retry-after")).toBe("900")
    expect(locked.headers.get("set-cookie")).toBeNull()
    const lockedBody = await locked.text()
    // Username tak dikenal yang juga terkunci → body identik (tanpa membocorkan validitas).
    for (let i = 0; i < 5; i++) await login({ username: "ghost", password: `x-${i}` }, trusted("10.0.0.8"))
    const ghost = await login({ username: "ghost", password: "x" }, trusted("10.0.0.8"))
    expect(ghost.status).toBe(429)
    expect(await ghost.text()).toBe(lockedBody)
    expect(JSON.parse(lockedBody)).toEqual({ error: "Terlalu banyak percobaan login. Coba lagi nanti." })
    // IP lain tidak terdampak.
    expect((await login(good, trusted("10.0.0.9"))).status).toBe(204)
    vi.setSystemTime(new Date(T0.getTime() + 15 * MIN + 1000))
    expect((await login(good, trusted("10.0.0.7"))).status).toBe(204)
  })

  it("dari IP sama username lain masih bisa sampai total 20 gagal per IP → 429", async () => {
    trustProxy()
    let n = 0
    for (let u = 0; n < 20; u++) {
      for (let i = 0; i < 5 && n < 20; i++, n++) expect((await login({ username: `u${u}`, password: "salah-xxxxxx" }, trusted("10.0.0.7"))).status).toBe(401)
    }
    expect((await login(good, trusted("10.0.0.7"))).status).toBe(429)
    expect((await login({ username: "baru", password: "x" }, trusted("10.0.0.7"))).status).toBe(429)
  })

  it("login sukses mereset hitungan (IP, username)", async () => {
    trustProxy()
    for (let i = 0; i < 4; i++) await login({ ...good, password: "salah-xxxxxx" }, trusted("10.0.0.7"))
    expect((await login(good, trusted("10.0.0.7"))).status).toBe(204)
    for (let i = 0; i < 5; i++) expect((await login({ ...good, password: "salah-xxxxxx" }, trusted("10.0.0.7"))).status).toBe(401)
    expect((await login(good, trusted("10.0.0.7"))).status).toBe(429)
  })

  it("X-Real-IP hanya dipakai bila PXE_TRUST_PROXY=1 (tanpa itu semua klien = satu kunci 'unknown')", async () => {
    for (let i = 0; i < 5; i++) await login({ ...good, password: "salah-xxxxxx" }, trusted(`10.0.1.${i}`))
    expect((await login(good, trusted("10.0.1.99"))).status).toBe(429)
    trustProxy()
    expect((await login(good, trusted("10.0.1.99"))).status).toBe(204)
  })

  it("race: 10 login salah paralel → tepat 5 diverifikasi (401) dan 5 ditolak (429)", async () => {
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => login({ ...good, password: `paralel-${i}-xxx` })))
    const codes = res.map((r) => r.status).sort()
    expect(codes).toEqual([401, 401, 401, 401, 401, 429, 429, 429, 429, 429])
    // Password benar paralel pun tetap terkunci.
    expect((await login(good)).status).toBe(429)
  })
})

describe("rate limit API per sesi (AC-6.11)", () => {
  it("request ke-(N+1) dalam 60 dtk → 429 + Retry-After; sesi lain tidak terdampak; /boot tidak dihitung", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    process.env.PXE_API_RATE_PER_MIN = "60"
    const a = cookieOf(await login())
    const b = cookieOf(await login())
    for (let i = 0; i < 60; i++) expect((await hostsGET(withCookie("/api/hosts", a))).status).toBe(200)
    const lim = await hostsGET(withCookie("/api/hosts", a))
    expect(lim.status).toBe(429)
    expect(lim.headers.get("retry-after")).toBe("60")
    expect(lim.headers.get("cache-control")).toBe("no-store")
    expect(await lim.json()).toEqual({ error: "Terlalu banyak request" })
    expect((await hostsGET(withCookie("/api/hosts", b))).status).toBe(200)
    // Endpoint /boot (token per-MAC, tanpa sesi) tetap dilayani dan tidak memakai kuota sesi.
    const boot = await bootGET(withCookie("/boot/52-54-00-99-00-31.ipxe", a), { params: Promise.resolve({ name: "52-54-00-99-00-31.ipxe" }) } as never)
    expect(boot.status).toBe(200)
    vi.setSystemTime(new Date(T0.getTime() + 60_000))
    expect((await hostsGET(withCookie("/api/hosts", a))).status).toBe(200)
  })
})
