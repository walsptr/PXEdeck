// M6-T2 (backend-dev): cakupan autentikasi semua route `/api/**` (AC-6.7).
//  - Statis: setiap fungsi GET|POST|PUT|PATCH|DELETE di `src/app/api/**/route.ts` memanggil
//    `guardRead(req)`/`guardMutation(req, …)` sebagai pernyataan pertama; `{ session: false }` hanya
//    di `auth/login` (pengecualian tertulis).
//  - Integration: setiap route × method tanpa cookie, cookie palsu, cookie kedaluwarsa, dan cookie
//    sesi yang sudah logout → 401 `{"error":"Perlu login"}` no-store, snapshot DB tidak berubah.
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

import { createSession, destroySessionId } from "@/lib/server/auth/session"
import { getSettings } from "@/lib/server/settings"
import { dbSnapshot, withDb } from "@/test/db"

withDb("demo")

const API_DIR = __dirname
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

function routeFiles(dir = API_DIR): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f)
    if (statSync(p).isDirectory()) return routeFiles(p)
    return f === "route.ts" ? [p] : []
  })
}

const modules = import.meta.glob<Record<string, Handler>>("./**/route.ts", { eager: true })
const rel = (abs: string) => `./${path.relative(API_DIR, abs).split(path.sep).join("/")}`

/** Semua (file, method, handler) yang diekspor. */
const ROUTES = routeFiles().flatMap((abs) => {
  const mod = modules[rel(abs)]
  return METHODS.filter((m) => typeof mod?.[m] === "function").map((m) => ({ file: rel(abs), method: m, handler: mod[m] }))
})

describe("statis: setiap handler API memanggil guard di awal", () => {
  it("modul route ditemukan (enumerasi tidak kosong; glob = file system)", () => {
    expect(Object.keys(modules).sort()).toEqual(routeFiles().map(rel).sort())
    expect(ROUTES.length).toBeGreaterThanOrEqual(25)
  })

  it.each(routeFiles().map(rel))("%s", (file) => {
    const src = readFileSync(path.join(API_DIR, file), "utf8")
    const fns = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(([^)]*)\)[^{]*\{\s*([^\n]*)\n\s*([^\n]*)/g)]
    expect(fns.length, "minimal satu handler").toBeGreaterThan(0)
    // Semua method yang diekspor harus berbentuk `export async function` (bisa diperiksa).
    const exported = METHODS.filter((m) => new RegExp(`export\\s+(const|function|async)[^\\n]*\\b${m}\\b`).test(src))
    expect(fns.map((f) => f[1]).sort()).toEqual([...exported].sort())
    for (const [, method, , firstLine, secondLine] of fns) {
      // Pernyataan 1: `const <v> = guardRead(req…)`/`guardMutation(req…)`; pernyataan 2: `if (<v>) return <v>`.
      const m = /^const (\w+) = guard(?:Read|Mutation)\(req[,)]/.exec(firstLine)
      expect(m, `${file} ${method}: pernyataan pertama "${firstLine}"`).not.toBeNull()
      expect(secondLine.trim(), `${file} ${method}: hasil guard dikembalikan`).toBe(`if (${m![1]}) return ${m![1]}`)
    }
    const optOut = /session:\s*false/.test(src)
    expect(optOut, `${file}: pengecualian session:false`).toBe(file === "./auth/login/route.ts")
  })
})

// ---------------------------------------------------------------------------------------------
const HOST = "525400101011"
const PARAMS: Record<string, Record<string, string>> = {
  "./hosts/[id]/route.ts": { id: HOST },
  "./hosts/[id]/config/route.ts": { id: HOST },
  "./hosts/[id]/install/route.ts": { id: HOST },
  "./hosts/[id]/reboot/route.ts": { id: HOST },
  "./jobs/[id]/route.ts": { id: "job-x" },
  "./jobs/[id]/logs/route.ts": { id: "job-x" },
  "./os-images/[id]/route.ts": { id: "ubuntu-24.04" },
  "./ssh-keys/[id]/route.ts": { id: "key-x" },
}

function url(file: string): string {
  const p = file.replace(/^\.\//, "/api/").replace(/\/route\.ts$/, "")
  return `http://localhost${p.replace(/\[(\w+)\]/g, (_, k) => PARAMS[file]?.[k] ?? "x")}`
}

function req(file: string, method: string, cookie?: string): Request {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = cookie
  if (method !== "GET") headers["content-type"] = "application/json"
  else headers.accept = "text/event-stream"
  return new Request(url(file), { method, headers, body: method === "GET" ? undefined : "{}" })
}

const call = (r: (typeof ROUTES)[number], cookie?: string) =>
  r.handler(req(r.file, r.method, cookie), { params: Promise.resolve(PARAMS[r.file] ?? {}) })

const PROTECTED = ROUTES.filter((r) => r.file !== "./auth/login/route.ts")

describe("integration: tanpa sesi valid → 401 Perlu login tanpa efek", () => {
  const cases: [string, () => string | undefined][] = [
    ["tanpa cookie", () => undefined],
    ["cookie palsu (bentuk benar)", () => `pxe_session=${"A".repeat(43)}`],
    ["cookie rusak", () => "pxe_session=%00%ff'; DROP TABLE sessions;--"],
    ["cookie kedaluwarsa", () => `pxe_session=${createSession(getSettings().admin!, null, new Date(Date.now() - 13 * 3_600_000)).id}`],
    [
      "cookie setelah logout",
      () => {
        const { id } = createSession(getSettings().admin!, null)
        destroySessionId(id)
        return `pxe_session=${id}`
      },
    ],
  ]
  for (const [label, mk] of cases) {
    it(`${label}: setiap route × method`, async () => {
      const before = dbSnapshot()
      for (const r of PROTECTED) {
        const res = await call(r, mk())
        expect(res.status, `${r.method} ${r.file}`).toBe(401)
        expect(res.headers.get("cache-control"), `${r.method} ${r.file}`).toBe("no-store")
        expect(await res.json(), `${r.method} ${r.file}`).toEqual({ error: "Perlu login" })
      }
      expect(dbSnapshot()).toBe(before)
    })
  }

  it("kontrol positif: dengan sesi valid tidak ada route yang membalas 401", async () => {
    for (const r of PROTECTED) {
      // Sesi baru per route (logout menghapus sesinya sendiri).
      const { id } = createSession(getSettings().admin!, null)
      const res = await call(r, `pxe_session=${id}`)
      expect(res.status, `${r.method} ${r.file}`).not.toBe(401)
      if (r.file === "./jobs/[id]/logs/route.ts") await res.body?.cancel()
    }
  })
})
